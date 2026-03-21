import type { Registry } from '../types';

export function validateArchitecture(arch: any, registry: Registry): string[] {
    const errors: string[] = [];
    const patterns = registry.patterns || [];

    const containerMap: Record<string, any> = {};
    const cNodes = arch.model?.containers || [];
    cNodes.forEach((cn: any) => { containerMap[cn.id] = cn; });
    (arch.model?.softwareSystems || []).forEach((s: any) => {
        (s.containers || []).forEach((cn: any) => { containerMap[cn.id] = cn; });
    });

    const dNodes = arch.deployment?.nodes || [];
    const flatDeployments: any[] = [];

    const getMemberships = (n: any) => n.properties?.memberships || n.memberships || {};
    // Helper to find what alias a node might have map to in a given expansion instance
    // Important because the same generic node might be 'pAdopted' into multiple patterns (e.g. cluster)
    const getSuffixForExp = (n: any, expId: string) => {
        const memberships = getMemberships(n);
        if (memberships[expId]) return memberships[expId];
        const primaryExpId = n.properties?.composition_id || n.composition_id;
        if (primaryExpId === expId) return n.properties?.composition_alias || n.composition_alias;
        return null;
    };

    const isDescendant = (childId: string, possibleParentId: string): boolean => {
        let curr = flatDeployments.find(n => n.id === childId);
        while (curr && curr.parentId) {
            if (curr.parentId === possibleParentId) return true;
            curr = flatDeployments.find(n => n.id === curr.parentId);
        }
        return false;
    };

    const parseTree = (nodes: any[], parentLayer: string | null, parentId: string | null) => {
        nodes.forEach(dn => {
            const patternId = dn.properties?.widget_ref?.split('@')[0];
            const pattern = patternId ? patterns.find(p => p.id === patternId) : null;
            const layerType = pattern?.layer || 'Unknown';

            flatDeployments.push({ ...dn, type: layerType, layer: layerType, parentLayer, parentId });

            if (dn.containerInstances) {
                dn.containerInstances.forEach((ci: any) => {
                    const cn = containerMap[ci.containerId];
                    if (cn) {
                        flatDeployments.push({
                            ...cn,
                            id: ci.id,
                            logicalId: ci.containerId,
                            isInstance: true,
                            type: 'Container',
                            layer: 'Container',
                            parentLayer: layerType,
                            parentId: dn.id,
                            properties: { ...cn.properties, ...ci.properties }
                        });
                    }
                });
            }
            if (dn.infrastructureNodes) {
                dn.infrastructureNodes.forEach((infra: any) => {
                    flatDeployments.push({
                        ...infra,
                        type: 'InfrastructureNode',
                        layer: 'InfrastructureNode',
                        parentLayer: layerType,
                        parentId: dn.id
                    });
                });
            }
            if (dn.nodes) parseTree(dn.nodes, layerType, dn.id);
        });
    };
    parseTree(dNodes, null, null);

    // Ensure purely logical models not explicitly wrapped in boundary deployments are still fully validated!
    const sNodes = arch.model?.softwareSystems || [];
    const pNodes = arch.model?.people || [];

    sNodes.forEach((s: any) => {
        flatDeployments.push({ ...s, type: 'SoftwareSystem' });
        (s.containers || []).forEach((c: any) => {
            flatDeployments.push({ ...c, type: 'Container', parentId: s.id });
            (c.components || []).forEach((cmp: any) => {
                flatDeployments.push({ ...cmp, type: 'Component', parentId: c.id });
            });
        });
    });

    cNodes.forEach((c: any) => {
        flatDeployments.push({ ...c, type: 'Container' });
        (c.components || []).forEach((cmp: any) => {
            flatDeployments.push({ ...cmp, type: 'Component', parentId: c.id });
        });
    });

    pNodes.forEach((p: any) => flatDeployments.push({ ...p, type: 'Person' }));

    // Securely deduplicate elements while safely preserving dynamic deployment instance aliases
    const uniqueDeployments = Array.from(new Map(flatDeployments.map(item => [item.id, item])).values());
    flatDeployments.length = 0;
    flatDeployments.push(...uniqueDeployments);

    const adjList: Record<string, string[]> = {};
    const rels = arch.model?.relationships || [];
    rels.forEach((rel: any) => {
        if (rel.sourceId && rel.destinationId) {
            if (!adjList[rel.sourceId]) adjList[rel.sourceId] = [];
            adjList[rel.sourceId]!.push(rel.destinationId);
        }
    });

    const getCid = (n: any) => n.logicalId || n.id;

    const findPathsTo = (targetId: string, current: string, visited: Set<string>, path: string[], allPaths: string[][]) => {
        if (current === targetId) {
            allPaths.push([...path, current]);
            return;
        }
        if (visited.has(current)) return;
        visited.add(current);
        (adjList[current] || []).forEach(neighbor => {
            findPathsTo(targetId, neighbor, visited, [...path, current], allPaths);
        });
        visited.delete(current);
    };

    // Group expansions and perform Smart Adoption
    const expansionInstances: Record<string, any[]> = {};
    flatDeployments.forEach(n => {
        const memberships = getMemberships(n);
        const primaryExpId = n.properties?.composition_id || n.composition_id;
        const allIds = new Set(Object.keys(memberships));
        if (primaryExpId) allIds.add(primaryExpId);

        allIds.forEach(id => {
            if (!expansionInstances[id]) expansionInstances[id] = [];
            if (!expansionInstances[id].includes(n)) expansionInstances[id].push(n);
        });
    });

    const getPatternFromOriginVal = (val: string | null | undefined) => {
        if (!val) return null;
        if (val.includes('@')) {
            const [id, ver] = val.split('@', 2);
            return patterns.find(p => p.id === id && p.version === ver);
        }
        return patterns.find(p => p.id === val);
    };

    // -------------------------------------------------------------------------------------------------
    // 1. SMART ADOPTION & COMPLETENESS CHECKING
    // -------------------------------------------------------------------------------------------------
    // Pattern macro expansions require very specific nodes to exist to be considered 'complete' (e.g. cluster AND lb).
    // This evaluates a tracked drop session, checks the registry for what *should* be there, and finds gaps.
    // However, if a user deleted a required component, but manually recreated a generic component of the exact same type/version nearby,
    // this auto-adopts it into the logical grouping so it can be verified for architectural constraints.
    Object.entries(expansionInstances).forEach(([expId, instanceNodes]) => {
        // Find origin pattern (look for MUST HAVE origin_pattern on any node in expansion)
        const master = instanceNodes.find(n => n.properties?.origin_pattern || n.origin_pattern);
        const originVal = master ? (master.properties?.origin_pattern || master.origin_pattern) : null;
        const originPattern = getPatternFromOriginVal(originVal);

        if (!originPattern || !originPattern.composition) return;

        const needed: { suffix: string, widget_ref: string }[] = [];
        const collect = (nodes: any[]) => {
            nodes.forEach(m => {
                needed.push({ suffix: m.id_suffix, widget_ref: m.widget_ref });
                if (m.children) collect(m.children);
            });
        };
        collect(originPattern.composition.nodes);

        needed.forEach(item => {
            const hasIt = instanceNodes.some(n => getSuffixForExp(n, expId) === item.suffix);
            if (!hasIt) {
                // Feature: Smart Adoption search
                // Find ANY free-floating node in the same parent vicinity that matches the required blueprint reference
                const candidate = flatDeployments.find(n =>
                    (n.properties?.widget_ref === item.widget_ref || n.widget_ref === item.widget_ref) &&
                    !getSuffixForExp(n, expId)
                );
                if (candidate) {
                    // Update state to bind the orphan back into this pattern instance. Validated temporarily.
                    if (!candidate.properties) candidate.properties = {};
                    if (!candidate.properties.memberships) candidate.properties.memberships = {};
                    candidate.properties.memberships[expId] = item.suffix;
                    candidate.memberships = { ...getMemberships(candidate), [expId]: item.suffix };
                    instanceNodes.push(candidate);
                } else {
                    errors.push(`Pattern '${originPattern.name}' is incomplete: mandatory component '${item.suffix}' is missing.`);
                }
            }
        });

        // Edge Completeness
        if (originPattern.composition.edges) {
            originPattern.composition.edges.forEach((edgeDef: any) => {
                const sourceNode = instanceNodes.find(n => getSuffixForExp(n, expId) === edgeDef.source_suffix);
                const targetNode = instanceNodes.find(n => getSuffixForExp(n, expId) === edgeDef.target_suffix);

                if (sourceNode && targetNode) {
                    const sCid = getCid(sourceNode);
                    const tCid = getCid(targetNode);

                    const hasEdge = (adjList[sCid] || []).includes(tCid);
                    if (!hasEdge) {
                        errors.push(`Pattern '${originPattern.name}' is incomplete: mandatory connection from '${edgeDef.source_suffix}' to '${edgeDef.target_suffix}' is missing.`);
                    }
                }
            });
        }

        // Rules Evaluation
        if (originPattern.rules) {
            originPattern.rules.forEach(rule => {
                if (rule.connectivity_assertions) {
                    rule.connectivity_assertions.forEach(assertion => {
                        const targetSuffix = assertion.to.replace('id_suffix:', '');
                        const targetNode = instanceNodes.find(n => getSuffixForExp(n, expId) === targetSuffix);
                        if (!targetNode) return;

                        const protectedNodes = flatDeployments.filter(n => n.id === targetNode.id || isDescendant(n.id, targetNode.id));
                        const externalNodes = flatDeployments.filter(n => !getSuffixForExp(n, expId));

                        externalNodes.forEach(entry => {
                            const entryCid = getCid(entry);
                            protectedNodes.forEach(pNode => {
                                const pNodeCid = getCid(pNode);
                                const allPaths: string[][] = [];
                                findPathsTo(pNodeCid, entryCid, new Set(), [], allPaths);

                                allPaths.forEach(path => {
                                    assertion.must_pass_through?.forEach((waySuffix: string) => {
                                        const cleanSuffix = waySuffix.replace('id_suffix:', '');
                                        const wayNode = instanceNodes.find(n => getSuffixForExp(n, expId) === cleanSuffix);
                                        if (wayNode) {
                                            const wayCid = getCid(wayNode);
                                            if (!path.includes(wayCid)) {
                                                errors.push(`Connectivity Violation: entry '${entry.name}' bypassing security Gateway. Traffic to '${pNode.name || pNode.id}' MUST pass through '${cleanSuffix}'.`);
                                            }
                                        }
                                    });
                                });
                            });
                        });
                    });
                }
            });
        }
    });

    // Standardization check
    flatDeployments.forEach(node => {
        const memberships = getMemberships(node);
        const primaryExpId = node.properties?.composition_id || node.composition_id;
        const allExpContexts: { id: string, suffix: string }[] = [];
        if (primaryExpId) allExpContexts.push({ id: primaryExpId, suffix: node.properties?.composition_alias || node.composition_alias });
        Object.entries(memberships).forEach(([id, suffix]) => {
            if (id !== primaryExpId) allExpContexts.push({ id, suffix: suffix as string });
        });

        allExpContexts.forEach(ctx => {
            const expNodes = expansionInstances[ctx.id];
            const master = expNodes?.find(n => n.properties?.origin_pattern || n.origin_pattern);
            const originPattern = getPatternFromOriginVal(master?.properties?.origin_pattern || master?.origin_pattern);

            if (originPattern?.composition) {
                const findMNode = (nodes: any[]): any => {
                    for (const m of nodes) {
                        if (m.id_suffix === ctx.suffix) return m;
                        if (m.children) {
                            const res = findMNode(m.children);
                            if (res) return res;
                        }
                    }
                    return null;
                };
                const mDef = findMNode(originPattern.composition.nodes);
                if (mDef?.properties) {
                    Object.entries(mDef.properties).forEach(([k, v]) => {
                        if (node.properties[k] !== v) {
                            errors.push(`Standardization Violation: ${node.name} must use ${k}=${v} (required by ${originPattern.name}).`);
                        }
                    });
                }
            }
        });
    });

    return Array.from(new Set(errors));
}
