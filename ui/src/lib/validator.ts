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
                            id: ci.id, // Use instance ID for relationship matching
                            isInstance: true,
                            instanceId: ci.id,
                            type: 'Container',
                            layer: 'Container',
                            parentLayer: layerType,
                            parentId: dn.id,
                            regionId: currentRegion,
                            datacenterId: currentDc,
                            properties: { ...cn.properties, ...ci.properties } // Merge properties for validation
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

    // Build Connectivity Graph for Path Analysis
    const adjList: Record<string, string[]> = {};
    const rels = arch.model?.relationships || [];
    rels.forEach((rel: any) => {
        if (!adjList[rel.sourceId]) adjList[rel.sourceId] = [];
        adjList[rel.sourceId].push(rel.destinationId);
    });

    const findPathsTo = (targetId: string, current: string, visited: Set<string>, path: string[], allPaths: string[][]) => {
        if (current === targetId) {
            allPaths.push([...path, current]);
            return;
        }
        if (visited.has(current)) return;

        visited.add(current);
        const neighbors = adjList[current] || [];
        neighbors.forEach(neighbor => {
            findPathsTo(targetId, neighbor, visited, [...path, current], allPaths);
        });
        visited.delete(current);
    };

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

    // 0. Validate Pattern Completeness (Existence Requirements)
    const expansionInstances: Record<string, any[]> = {};
    flatDeployments.forEach(n => {
        const expId = n.properties?.macro_expansion_id || n.macro_expansion_id;
        if (expId) {
            if (!expansionInstances[expId]) expansionInstances[expId] = [];
            expansionInstances[expId].push(n);
        }
    });

    Object.entries(expansionInstances).forEach(([_expId, instanceNodes]) => {
        const originPatternId = instanceNodes[0].properties?.origin_pattern || instanceNodes[0].origin_pattern;
        const originPattern = patterns.find(p => p.id === originPatternId);

        if (originPattern && originPattern.macro_expansion) {
            const requiredItems: { suffix: string; pattern_ref: string }[] = [];
            const collectItems = (nodes: any[]) => {
                nodes.forEach(mNode => {
                    requiredItems.push({ suffix: mNode.id_suffix, pattern_ref: mNode.pattern_ref });
                    if (mNode.children) collectItems(mNode.children);
                });
            };
            collectItems(originPattern.macro_expansion.nodes);

            const currentSuffixes = new Set(instanceNodes.map(n => n.properties?.macro_id_suffix || n.macro_id_suffix));
            const firstNode = instanceNodes[0];
            const pId = firstNode.parentId;

            requiredItems.forEach(item => {
                const suffix = item.suffix;
                if (!currentSuffixes.has(suffix)) {
                    // Smart Adoption: Search for a matching 'unbound' node in the same parent scope
                    const candidate = flatDeployments.find(n =>
                        n.parentId === pId &&
                        n.properties?.pattern_ref === item.pattern_ref &&
                        !(n.properties?.macro_expansion_id || n.macro_expansion_id)
                    );

                    if (candidate) {
                        // Smart Adoption: Mutate candidate in place so the property check loop below can see it
                        candidate.properties = {
                            ...candidate.properties,
                            macro_id_suffix: suffix,
                            origin_pattern: originPatternId,
                            _adopted: true
                        };
                        currentSuffixes.add(suffix);
                    } else {
                        errors.push(`Architecture Gap: The '${originPattern.name}' stack is incomplete. A mandatory component '${suffix}' of type '${item.pattern_ref.split('@')[0]}' is missing from its container. Drag a new instance into the container to repair it.`);
                    }
                }
            });
        }
    });

    // Evaluate Rules against all logical nodes
    flatDeployments.forEach(node => {
        const props = node.properties || {};
        const patternId = props.pattern_ref?.split('@')[0];
        if (!patternId) return;

        const pattern = patterns.find(p => p.id === patternId);
        if (!pattern) return;

        // 1. Validate Parameter Constraints (const and options)
        if (pattern.parameters) {
            Object.entries(pattern.parameters).forEach(([paramId, paramDef]) => {
                const val = props[paramId];
                if (val !== undefined) {
                    // Check 'const'
                    if (paramDef.const !== undefined && val !== paramDef.const) {
                        errors.push(`Constraint Violation: ${pattern.id} property '${paramId}' must be exactly '${paramDef.const}'. Found: '${val}'`);
                    }
                    // Check 'options'
                    if (paramDef.options && paramDef.options.length > 0) {
                        if (!paramDef.options.includes(val)) {
                            errors.push(`Constraint Violation: ${pattern.id} property '${paramId}' must be one of [${paramDef.options.join(', ')}]. Found: '${val}'`);
                        }
                    }
                    // Type checking could be added here in the future
                }
            });
        }

        // 2. Validate Pattern Blueprints (Overriding Macro Properties)
        if (props.origin_pattern && props.macro_id_suffix) {
            const originPattern = patterns.find(p => p.id === props.origin_pattern);
            if (originPattern && originPattern.macro_expansion) {
                const findInTree = (nodes: any[]): any | null => {
                    for (const mNode of nodes) {
                        if (mNode.id_suffix === props.macro_id_suffix) return mNode;
                        if (mNode.children) {
                            const res = findInTree(mNode.children);
                            if (res) return res;
                        }
                    }
                    return null;
                };

                const macroNodeDefinition = findInTree(originPattern.macro_expansion.nodes);
                if (macroNodeDefinition && macroNodeDefinition.properties) {
                    Object.entries(macroNodeDefinition.properties).forEach(([pId, fixedVal]) => {
                        const actualVal = props[pId];
                        if (actualVal !== fixedVal) {
                            errors.push(`Standardization Violation: ${node.name} (from pattern '${originPattern.name}') must use ${pId}='${fixedVal}'. Found: '${actualVal}'`);
                        }
                    });
                }
            }
        }

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

            // 4. Connectivity Assertions (Golden Paths)
            if (rule.connectivity_assertions) {
                // Helper to check if a node is contained within another
                const isDescendant = (childId: string, possibleParentId: string): boolean => {
                    let curr = flatDeployments.find(n => n.id === childId);
                    while (curr && curr.parentId) {
                        if (curr.parentId === possibleParentId) return true;
                        curr = flatDeployments.find(n => n.id === curr.parentId);
                    }
                    return false;
                };

                // Helpers to consistently read architectural metadata
                const getExpId = (n: any) => n.properties?.macro_expansion_id || n.macro_expansion_id;
                const getSuffix = (n: any) => n.properties?.macro_id_suffix || n.macro_id_suffix;

                rule.connectivity_assertions.forEach(assertion => {
                    if (assertion.to && assertion.must_pass_through) {
                        const targetSuffix = assertion.to.replace('id_suffix:', '');
                        const targetRootNode = flatDeployments.find(n => {
                            const nSuffix = getSuffix(n);
                            const nExpId = getExpId(n);
                            const nodeExpId = getExpId(node);
                            return nSuffix === targetSuffix && nExpId === nodeExpId;
                        });

                        if (targetRootNode) {
                            const myExpId = getExpId(targetRootNode);
                            // Collect the target itself and all its nested children/containers
                            const protectedNodes = flatDeployments.filter(n => n.id === targetRootNode.id || isDescendant(n.id, targetRootNode.id));

                            // Find all nodes outside this specific expansion instance
                            const externalNodes = flatDeployments.filter(n => getExpId(n) !== myExpId);

                            externalNodes.forEach(entry => {
                                protectedNodes.forEach(pNode => {
                                    const allPaths: string[][] = [];
                                    findPathsTo(pNode.id, entry.id, new Set(), [], allPaths);

                                    allPaths.forEach(path => {
                                        assertion.must_pass_through.forEach((waypointSuffix: string) => {
                                            const cleanSuffix = waypointSuffix.replace('id_suffix:', '');
                                            const waypointNode = flatDeployments.find(n => {
                                                const wSuffix = getSuffix(n);
                                                const wExpId = getExpId(n);
                                                return wSuffix === cleanSuffix && wExpId === myExpId;
                                            });

                                            if (waypointNode && !path.includes(waypointNode.id)) {
                                                errors.push(`Connectivity Violation: Entry point '${entry.name}' reaching protected component '${pNode.name || pNode.id}' violates Golden Path. Traffic must pass through '${cleanSuffix}'.`);
                                            }
                                        });
                                    });
                                });
                            });
                        }
                    }
                });
            }
        });
    });

    // Deduplicate errors
    return Array.from(new Set(errors));
}
