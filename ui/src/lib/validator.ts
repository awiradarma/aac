import type { Pattern } from '../types';

export function validateArchitecture(arch: any, patterns: Pattern[]): string[] {
    const errors: string[] = [];

    const containerMap: Record<string, any> = {};
    const cNodes = arch.model?.containers || [];
    cNodes.forEach((cn: any) => { containerMap[cn.id] = cn; });

    const dNodes = arch.deployment?.nodes || [];

    // Helper to flatten deployment tree into node objects with parent context
    const flatDeployments: any[] = [];

    const parseTree = (nodes: any[], parentType: string | null, parentId: string | null, regionId: string | null, datacenterId: string | null) => {
        nodes.forEach(dn => {
            let currentRegion = regionId;
            let currentDc = datacenterId;

            let type = 'Host';
            if (dn.name.toLowerCase().includes('region')) { type = 'Region'; currentRegion = dn.id; }
            else if (dn.name.toLowerCase().includes('datacenter')) { type = 'Datacenter'; currentDc = dn.id; }

            flatDeployments.push({ ...dn, type, parentType, parentId, regionId: currentRegion, datacenterId: currentDc });

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
                            parentType: type,
                            parentId: dn.id,
                            regionId: currentRegion,
                            datacenterId: currentDc
                        });
                    }
                });
            }

            if (dn.nodes && dn.nodes.length > 0) {
                parseTree(dn.nodes, type, dn.id, currentRegion, currentDc);
            }
        });
    };

    parseTree(dNodes, null, null, null, null);

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
                                datacentersByRegion[sis.regionId].add(sis.datacenterId);
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
                    if (assertion.includes("parent.type")) {
                        const expectedParent = assertion.split("==")[1].replace(/['")]/g, '').trim();

                        if (node.parentType?.toLowerCase() !== expectedParent.toLowerCase()) {
                            errors.push(`Boundary Violation: ${pattern.id} (${node.name}) must be placed inside a ${expectedParent} container! Found inside ${node.parentType || 'root'}.`);
                        }
                    }
                });
            }
        });
    });

    // Deduplicate errors
    return Array.from(new Set(errors));
}
