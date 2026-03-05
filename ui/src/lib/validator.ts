import type { Registry } from '../types';

export function validateArchitecture(arch: any, registry: Registry): string[] {
    const errors: string[] = [];
    const patterns = registry.patterns || [];

    const containerMap: Record<string, any> = {};
    const cNodes = arch.model?.containers || [];
    cNodes.forEach((cn: any) => { containerMap[cn.id] = cn; });

    const dNodes = arch.deployment?.nodes || [];

    // Helper to flatten deployment tree into node objects with parent context
    const flatDeployments: any[] = [];

    const parseTree = (nodes: any[], parentLayer: string | null, parentId: string | null, regionId: string | null, datacenterId: string | null) => {
        nodes.forEach(dn => {
            let currentRegion = regionId;
            let currentDc = datacenterId;

            // Lookup logical layer from pattern registry
            const patternId = dn.properties?.pattern_ref?.split('@')[0];
            const pattern = patternId ? patterns.find(p => p.id === patternId) : null;
            const layerType = pattern?.layer || 'Unknown';

            if (layerType === 'Region') { currentRegion = dn.id; }
            else if (layerType === 'Datacenter') { currentDc = dn.id; }

            flatDeployments.push({ ...dn, type: layerType, layer: layerType, parentLayer, parentId, regionId: currentRegion, datacenterId: currentDc });

            // Add container instances as virtual nodes
            if (dn.containerInstances) {
                dn.containerInstances.forEach((ci: any) => {
                    const cn = containerMap[ci.containerId];
                    if (cn) {
                        flatDeployments.push({
                            ...cn,
                            isInstance: true,
                            instanceId: ci.id,
                            type: 'Container',
                            layer: 'Container',
                            parentLayer: layerType,
                            parentId: dn.id,
                            regionId: currentRegion,
                            datacenterId: currentDc
                        });
                    }
                });
            }

            if (dn.nodes && dn.nodes.length > 0) {
                parseTree(dn.nodes, layerType, dn.id, currentRegion, currentDc);
            }
        });
    };

    parseTree(dNodes, null, null, null, null);

    // Validate Explicit Deployment Hierarchies
    if (registry.deployment_hierarchies && registry.deployment_hierarchies.length > 0) {
        // Build all root-to-leaf paths
        const paths: string[][] = [];
        const leafNodes = flatDeployments.filter(n => !flatDeployments.find(child => child.parentId === n.id));

        leafNodes.forEach(leaf => {
            const currentPath: string[] = [];
            let curr: any = leaf;
            while (curr) {
                // Ignore Containers themselves, we only care about the DeploymentNode infrastructure chain
                if (curr.c4Level !== 'Container' && curr.layer !== 'Container' && curr.layer !== 'Unknown') {
                    currentPath.unshift(curr.layer);
                }
                curr = flatDeployments.find(n => n.id === curr.parentId);
            }
            if (currentPath.length > 1) {
                paths.push(currentPath);
            }
        });

        paths.forEach(path => {
            // Check if this path is a contiguous sub-sequence of ANY valid_layer_chain
            let isValid = false;
            for (const template of registry.deployment_hierarchies!) {
                const chain = template.valid_layer_chain;

                // Sub-sequence check
                let matchIndex = 0;
                let pathIdx = 0;
                while (matchIndex < chain.length && pathIdx < path.length) {
                    if (chain[matchIndex] === path[pathIdx]) {
                        pathIdx++;
                    } else if (pathIdx > 0) {
                        // We started matching but hit a gap (e.g. Region -> Cluster missing Datacenter)
                        break;
                    }
                    matchIndex++;
                }
                if (pathIdx === path.length) {
                    isValid = true;
                    break;
                }
            }

            if (!isValid) {
                errors.push(`Hierarchy Violation: The deployment path [${path.join(' -> ')}] does not explicitly conform to any approved deployment hierarchy template.`);
            }
        });
    }

    // Evaluate Allowed Hierarchies for Containers
    const containerNodes = flatDeployments.filter(n => n.c4Level === 'Container' || n.layer === 'Container');

    containerNodes.forEach(container => {
        const props = container.properties || {};
        const patternId = props.pattern_ref?.split('@')[0];
        if (!patternId) return;

        const pattern = patterns.find(p => p.id === patternId);
        if (!pattern) return;

        const allowedHierarchies = pattern.infrastructure_requirements?.allowed_hierarchies;

        if (allowedHierarchies && allowedHierarchies.length > 0 && registry.deployment_hierarchies) {
            const currentPath: string[] = [];
            let curr: any = flatDeployments.find(n => n.id === container.parentId);
            while (curr) {
                if (curr.c4Level !== 'Container' && curr.layer !== 'Container' && curr.layer !== 'Unknown') {
                    currentPath.unshift(curr.layer);
                }
                curr = flatDeployments.find(n => n.id === curr.parentId);
            }

            if (currentPath.length > 0) {
                let pathIsValid = false;
                for (const expectedHId of allowedHierarchies) {
                    const template = registry.deployment_hierarchies.find(h => h.id === expectedHId);
                    if (template) {
                        const chain = template.valid_layer_chain;
                        let matchIndex = 0;
                        let pathIdx = 0;
                        while (matchIndex < chain.length && pathIdx < currentPath.length) {
                            if (chain[matchIndex] === currentPath[pathIdx]) {
                                pathIdx++;
                            } else if (pathIdx > 0) {
                                break;
                            }
                            matchIndex++;
                        }
                        if (pathIdx === currentPath.length) {
                            pathIsValid = true;
                            break;
                        }
                    }
                }
                if (!pathIsValid) {
                    errors.push(`Hierarchy Violation: ${patternId} (${container.name}) failed deployment hierarchy check. Its path [${currentPath.join(' -> ')}] does not conform to its allowed templates: ${allowedHierarchies.join(', ')}.`);
                }
            }
        }
    });

    // Evaluate Rules against all logical nodes
    flatDeployments.forEach(node => {
        const props = node.properties || {};
        const patternId = props.pattern_ref?.split('@')[0];
        if (!patternId) return;

        const pattern = patterns.find(p => p.id === patternId);
        if (!pattern) return;

        pattern.rules?.forEach(rule => {
            // Active-Active DB and Topology Rule
            if (rule.condition?.includes("topology == 'active-active'")) {
                const dbType = props.database_type;

                if (props.topology === 'active-active') {
                    if (dbType && rule.allowed_values?.database_type) {
                        const allowed = rule.allowed_values.database_type;
                        if (!allowed.includes(dbType)) {
                            errors.push(`Violation: ${pattern.id} requires database_type in [${allowed.join(', ')}] for active-active. Found: ${dbType}`);
                        }
                    }

                    if (rule.id === 'multi-region-spanning-rule') {
                        // Find all instances of this exact workload pattern across the entire flattened tree
                        const sisters = flatDeployments.filter(n => n.properties?.pattern_ref === props.pattern_ref);
                        const myRegions = new Set<string>();
                        const datacentersByRegion: Record<string, Set<string>> = {};

                        sisters.forEach(sis => {
                            if (sis.regionId) myRegions.add(sis.regionId);
                            if (sis.regionId && sis.datacenterId) {
                                if (!datacentersByRegion[sis.regionId]) datacentersByRegion[sis.regionId] = new Set();
                                datacentersByRegion[sis.regionId]?.add(sis.datacenterId);
                            }
                        });

                        if (myRegions.size < 2) {
                            errors.push(`Topology Violation: ${pattern.id} with active-active topology requires deployment across at least 2 distinct Regions. Found ${myRegions.size}.`);
                        }

                        Object.entries(datacentersByRegion).forEach(([rId, dcSet]) => {
                            if (dcSet.size < 2) {
                                errors.push(`Topology Violation: ${pattern.id} with active-active topology requires at least 2 Datacenters per Region. Region ${rId} only has ${dcSet.size}.`);
                            }
                        });
                    }
                } else {
                    if (dbType && rule.else_allowed_values?.database_type) {
                        const allowed = rule.else_allowed_values.database_type;
                        if (!allowed.includes(dbType)) {
                            errors.push(`Violation: ${pattern.id} requires database_type in [${allowed.join(', ')}] for non active-active. Found: ${dbType}`);
                        }
                    }
                }
            }

            // Structural Boundary Assertions
            if (rule.structural_assertions) {
                rule.structural_assertions.forEach(assertion => {
                    if (assertion.includes("parent.layer")) {
                        const expectedParent = assertion.split("==")[1]?.replace(/['")]/g, '').trim();

                        if (expectedParent && node.parentLayer?.toLowerCase() !== expectedParent.toLowerCase()) {
                            errors.push(`Boundary Violation: ${pattern.id} (${node.name}) must be placed inside a ${expectedParent} container! Found inside ${node.parentLayer || 'root'}.`);
                        }
                    }
                });
            }
        });
    });

    // Deduplicate errors
    return Array.from(new Set(errors));
}
