import type { Registry } from '../types';

export function validateArchitecture(arch: any, registry: Registry): string[] {
    const errors: string[] = [];
    const patterns = registry.patterns || [];

    const containerMap: Record<string, any> = {};
    const cNodes = arch.model?.containers || [];
    cNodes.forEach((cn: any) => { containerMap[cn.id] = cn; });

    const dNodes = arch.deployment?.nodes || [];
    const flatDeployments: any[] = [];

    const getMemberships = (n: any) => n.properties?.memberships || n.memberships || {};
    const getSuffixForExp = (n: any, expId: string) => {
        const memberships = getMemberships(n);
        if (memberships[expId]) return memberships[expId];
        const primaryExpId = n.properties?.macro_expansion_id || n.macro_expansion_id;
        if (primaryExpId === expId) return n.properties?.macro_id_suffix || n.macro_id_suffix;
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
            const patternId = dn.properties?.pattern_ref?.split('@')[0];
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
            if (dn.nodes) parseTree(dn.nodes, layerType, dn.id);
        });
    };
    parseTree(dNodes, null, null);

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
        const primaryExpId = n.properties?.macro_expansion_id || n.macro_expansion_id;
        const allIds = new Set(Object.keys(memberships));
        if (primaryExpId) allIds.add(primaryExpId);

        allIds.forEach(id => {
            if (!expansionInstances[id]) expansionInstances[id] = [];
            if (!expansionInstances[id].includes(n)) expansionInstances[id].push(n);
        });
    });

    // Smart Adoption & Completeness
    Object.entries(expansionInstances).forEach(([expId, instanceNodes]) => {
        // Find origin pattern (look for MUST HAVE origin_pattern on any node in expansion)
        const master = instanceNodes.find(n => n.properties?.origin_pattern || n.origin_pattern);
        const originId = master ? (master.properties?.origin_pattern || master.origin_pattern) : null;
        const originPattern = patterns.find(p => p.id === originId);

        if (!originPattern || !originPattern.macro_expansion) return;

        const needed: { suffix: string, pattern_ref: string }[] = [];
        const collect = (nodes: any[]) => {
            nodes.forEach(m => {
                needed.push({ suffix: m.id_suffix, pattern_ref: m.pattern_ref });
                if (m.children) collect(m.children);
            });
        };
        collect(originPattern.macro_expansion.nodes);

        needed.forEach(item => {
            const hasIt = instanceNodes.some(n => getSuffixForExp(n, expId) === item.suffix);
            if (!hasIt) {
                // Adoption search
                const parentIds = Array.from(new Set(instanceNodes.map(n => n.parentId)));
                const candidate = flatDeployments.find(n =>
                    parentIds.includes(n.parentId) &&
                    n.properties?.pattern_ref === item.pattern_ref &&
                    !getSuffixForExp(n, expId)
                );
                if (candidate) {
                    candidate.memberships = { ...getMemberships(candidate), [expId]: item.suffix };
                    instanceNodes.push(candidate);
                } else {
                    errors.push(`Pattern '${originPattern.name}' is incomplete: mandatory component '${item.suffix}' is missing.`);
                }
            }
        });

        // Edge Completeness
        if (originPattern.macro_expansion.edges) {
            originPattern.macro_expansion.edges.forEach((edgeDef: any) => {
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
        const primaryExpId = node.properties?.macro_expansion_id || node.macro_expansion_id;
        const allExpContexts: { id: string, suffix: string }[] = [];
        if (primaryExpId) allExpContexts.push({ id: primaryExpId, suffix: node.properties?.macro_id_suffix || node.macro_id_suffix });
        Object.entries(memberships).forEach(([id, suffix]) => {
            if (id !== primaryExpId) allExpContexts.push({ id, suffix: suffix as string });
        });

        allExpContexts.forEach(ctx => {
            const expNodes = expansionInstances[ctx.id];
            const master = expNodes?.find(n => n.properties?.origin_pattern || n.origin_pattern);
            const originPattern = patterns.find(p => p.id === (master?.properties?.origin_pattern || master?.origin_pattern));

            if (originPattern?.macro_expansion) {
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
                const mDef = findMNode(originPattern.macro_expansion.nodes);
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
