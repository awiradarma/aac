import type { Registry, PatternRule } from '../types';

export type ValidationResult = {
    severity: 'error' | 'warning' | 'info';
    message: string;
    ruleId?: string;
    patternName?: string;
    patternId?: string;
};

export function validateArchitecture(arch: any, registry: Registry, scope?: 'container' | 'deployment'): ValidationResult[] {
    const results: ValidationResult[] = [];
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
            curr = flatDeployments.find(n => n.id === curr.parentId || n.logicalId === curr.parentId);
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

    const expansionInstances: Record<string, any[]> = {};
    flatDeployments.forEach(n => {
        const memberships = getMemberships(n);
        const primaryExpId = n.properties?.composition_id || n.composition_id;
        const allIds = new Set(Object.keys(memberships));
        if (primaryExpId) allIds.add(primaryExpId);

        allIds.forEach(id => {
            if (n.isInstance) {
                let currentP = flatDeployments.find(p => p.id === n.parentId);
                let validForThisId = false;
                while (currentP) {
                    const pMem = getMemberships(currentP);
                    const pPrime = currentP.properties?.composition_id || currentP.composition_id;
                    if (pPrime === id || pMem[id]) {
                        validForThisId = true;
                        break;
                    }
                    currentP = flatDeployments.find(p => p.id === currentP.parentId);
                }

                if (!validForThisId) {
                    const logicalPeer = flatDeployments.find(other =>
                        !other.isInstance &&
                        other.id !== n.id &&
                        (other.properties?.composition_id === id || other.composition_id === id ||
                            (getMemberships(other))[id])
                    );
                    if (logicalPeer) validForThisId = true;
                }

                if (!validForThisId) return;
            }

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

    Object.entries(expansionInstances).forEach(([expId, instanceNodes]) => {
        let master = instanceNodes.find(n => {
            const pExp = n.properties?.composition_id || n.composition_id;
            return pExp === expId && (n.properties?.origin_pattern || n.origin_pattern);
        });
        if (!master) master = instanceNodes.find(n => n.properties?.origin_pattern || n.origin_pattern);
        const originVal = master ? (master.properties?.origin_pattern || master.origin_pattern) : null;
        const originPattern = getPatternFromOriginVal(originVal);

        if (!originPattern || (!originPattern.rules && !originPattern.composition)) return;

        // Legacy compatibility: synthesize rules if they don't exist
        let normalizedRules: PatternRule[] = originPattern.rules || [];
        if (!originPattern.rules && originPattern.composition) {
            const comp = originPattern.composition as any;
            if (comp.nodes) {
                comp.nodes.forEach((m: any) => {
                    normalizedRules.push({
                        id: `legacy-${m.id_suffix}`,
                        scope: 'all', severity: 'mandatory', type: 'node_existence', node: `id_suffix:${m.id_suffix}`
                    });
                    if (m.properties) {
                        Object.entries(m.properties).forEach(([k, v]) => {
                            normalizedRules.push({
                                id: `legacy-prop-${m.id_suffix}-${k}`,
                                scope: 'all', severity: 'mandatory', type: 'property_constraint', node: `id_suffix:${m.id_suffix}`, property: k, allowed_values: [v]
                            });
                        });
                    }
                });
            }
            if (comp.edges) {
                comp.edges.forEach((e: any, i: number) => {
                    normalizedRules.push({
                        id: `legacy-edge-${i}`,
                        scope: 'all', severity: 'mandatory', type: 'edge_existence', source: `id_suffix:${e.source_suffix}`, target: `id_suffix:${e.target_suffix}`
                    });
                });
            }
        }

        // Gather all blueprint nodes across scopes for Smart Adoption
        const neededNodes: any[] = [];
        const processCompNodes = (nList: any[]) => {
            nList.forEach(m => {
                neededNodes.push({ suffix: m.id_suffix, widget_ref: m.widget_ref });
                if (m.children) processCompNodes(m.children);
            });
        };
        const anyComp = originPattern.composition as any;
        if (anyComp) {
            if (anyComp.nodes) processCompNodes(anyComp.nodes);
            if (anyComp.container?.nodes) processCompNodes(anyComp.container.nodes);
            if (anyComp.deployment?.nodes) processCompNodes(anyComp.deployment.nodes);
        }

        // 1. SMART ADOPTION
        neededNodes.forEach(item => {
            const hasIt = instanceNodes.some(n => getSuffixForExp(n, expId) === item.suffix);
            if (!hasIt) {
                const candidate = flatDeployments.find(n => {
                    const mMem = getMemberships(n);
                    const isUnowned = !n.properties?.composition_id && !n.composition_id && Object.keys(mMem).length === 0;
                    const nRef = n.properties?.widget_ref || n.widget_ref || '';
                    const iRef = item.widget_ref || '';
                    const wMatch = !!iRef && !!nRef && (nRef === iRef || nRef.split('@')[0] === iRef.split('@')[0]);

                    return wMatch && isUnowned && !getSuffixForExp(n, expId);
                });
                if (candidate) {
                    if (!candidate.properties) candidate.properties = {};
                    if (!candidate.properties.memberships) candidate.properties.memberships = {};
                    candidate.properties.memberships[expId] = item.suffix;
                    candidate.memberships = { ...getMemberships(candidate), [expId]: item.suffix };
                    instanceNodes.push(candidate);
                }
            }
        });

        // 2. RULES EVALUATION
        const applicableRules = normalizedRules.filter(r => !scope || r.scope === scope || r.scope === 'all');

        applicableRules.forEach(rule => {
            const severityVal: 'error' | 'warning' | 'info' = rule.severity === 'mandatory' ? 'error' : (rule.severity === 'recommended' ? 'warning' : 'info');
            
            if (rule.type === 'node_existence') {
                const requiredSuffix = rule.node.replace('id_suffix:', '');
                const hasIt = instanceNodes.some(n => getSuffixForExp(n, expId) === requiredSuffix);
                if (!hasIt) {
                    if (rule.severity === 'optional') return;
                    results.push({
                        severity: severityVal,
                        message: rule.description || `Pattern '${originPattern.name}' is missing ${severityVal === 'error' ? 'mandatory' : 'recommended'} component '${requiredSuffix}'${scope === 'container' ? '. Switch to Deployment view to add it.' : '.'}`,
                        ruleId: rule.id,
                        patternName: originPattern.name,
                        patternId: originPattern.id
                    });
                }
            } else if (rule.type === 'edge_existence') {
                const sourceSuffix = rule.source.replace('id_suffix:', '');
                const targetSuffix = rule.target.replace('id_suffix:', '');
                const sourceNode = instanceNodes.find(n => getSuffixForExp(n, expId) === sourceSuffix);
                const targetNode = instanceNodes.find(n => getSuffixForExp(n, expId) === targetSuffix);

                if (sourceNode && targetNode) {
                    const sCid = getCid(sourceNode);
                    const tCid = getCid(targetNode);
                    const hasEdge = (adjList[sCid] || []).includes(tCid);
                    if (!hasEdge && rule.severity !== 'optional') {
                        results.push({
                            severity: severityVal,
                            message: rule.description || `Pattern '${originPattern.name}' is missing ${severityVal === 'error' ? 'mandatory' : 'recommended'} connection from '${sourceSuffix}' to '${targetSuffix}'.`,
                            ruleId: rule.id,
                            patternName: originPattern.name,
                            patternId: originPattern.id
                        });
                    }
                }
            } else if (rule.type === 'property_constraint') {
                const nodeSuffix = rule.node.replace('id_suffix:', '');
                const targetNode = instanceNodes.find(n => getSuffixForExp(n, expId) === nodeSuffix);
                if (targetNode) {
                    const propVal = targetNode.properties ? targetNode.properties[rule.property] : undefined;
                    console.log(`[VALIDATOR DEBUG] Validating property_constraint for ${nodeSuffix}`);
                    console.log(`Target Node Props:`, targetNode.properties);
                    console.log(`Expected Property [${rule.property}]:`, rule.allowed_values);
                    console.log(`Actual Property Value:`, propVal);

                    // Strict match check
                    const resolvedAllowed = Array.isArray(rule.allowed_values) ? rule.allowed_values : [];
                    if (!resolvedAllowed.includes(propVal) && rule.severity !== 'optional') {
                        results.push({
                            severity: severityVal,
                            message: rule.description || `Standardization Violation: ${targetNode.name || nodeSuffix} must use ${rule.property}=${resolvedAllowed.join(' or ')} (required by ${originPattern.name}).`,
                            ruleId: rule.id,
                            patternName: originPattern.name,
                            patternId: originPattern.id
                        });
                    }
                }
            } else if (rule.type === 'connectivity') {
                const targetSuffix = rule.to.replace('id_suffix:', '');
                const targetNode = instanceNodes.find(n => getSuffixForExp(n, expId) === targetSuffix);
                if (!targetNode) return;

                const protectedNodes = flatDeployments.filter(n => n.id === targetNode.id || isDescendant(n.id, targetNode.id));
                const externalNodes = flatDeployments.filter(n => {
                    if (getSuffixForExp(n, expId)) return false; 
                    if (protectedNodes.some(p => p.id === n.id)) return false;

                    // If evaluating deployment scope, ONLY care about nodes that are actually deployed
                    if (scope === 'deployment') {
                        const isDeployedInstance = !!n.isInstance || n.c4Level === 'DeploymentNode' || n.type === 'DeploymentNode' || n.type === 'InfrastructureNode' || n.parentLayer === 'DeploymentNode';
                        if (!isDeployedInstance) return false;
                    }

                    const nMem = getMemberships(n);
                    const nPrime = n.properties?.composition_id || n.composition_id;
                    const nExpIds = [...Object.keys(nMem), nPrime].filter(Boolean);

                    for (const otherExpId of nExpIds) {
                        if (otherExpId !== expId && expansionInstances[otherExpId]) {
                            const hasTwin = expansionInstances[otherExpId].some(peer => getCid(peer) === getCid(targetNode));
                            if (hasTwin) return false; 
                        }
                    }
                    return true;
                });

                externalNodes.forEach(entry => {
                    const entryCid = getCid(entry);
                    protectedNodes.forEach(pNode => {
                        const pNodeCid = getCid(pNode);
                        const allPaths: string[][] = [];
                        findPathsTo(pNodeCid, entryCid, new Set(), [], allPaths);

                        if (allPaths.length === 0) return;

                        // Check if AT LEAST ONE valid path fully routes through the required waypoints
                        const hasCompliantPath = allPaths.some(path => {
                            return rule.must_pass_through?.every((waySuffix: string) => {
                                const cleanSuffix = waySuffix.replace('id_suffix:', '');
                                const wayNode = instanceNodes.find(n => getSuffixForExp(n, expId) === cleanSuffix);
                                if (!wayNode) return true; // Waypoint missing from model, can't reliably validate path
                                return path.includes(getCid(wayNode));
                            });
                        });

                        if (!hasCompliantPath) {
                            results.push({
                                severity: severityVal,
                                message: rule.description || `Connectivity Violation: entry '${entry.name}' bypassing security. Traffic to '${pNode.name || pNode.id}' MUST pass through '${rule.must_pass_through?.map((w: string) => w.replace('id_suffix:', '')).join("' and '")}'.`,
                                ruleId: rule.id,
                                patternName: originPattern.name,
                                patternId: originPattern.id
                            });
                        }
                    });
                });
            } else {
                // Support legacy connectivity_assertions object structure if someone missed migration
                const oldRule = rule as any;
                if (oldRule.connectivity_assertions) {
                    oldRule.connectivity_assertions.forEach((assertion: any) => {
                        // Very similar logic to connectivity type above... Simplified for legacy test compat 
                        const tgtSuffix = assertion.to.replace('id_suffix:', '');
                        const tgtNode = instanceNodes.find(n => getSuffixForExp(n, expId) === tgtSuffix);
                        if (!tgtNode) return;
                        const protNodes = flatDeployments.filter(n => n.id === tgtNode.id || isDescendant(n.id, tgtNode.id));
                        const extNodes = flatDeployments.filter(n => !getSuffixForExp(n, expId) && !protNodes.some(p => p.id === n.id));
                        extNodes.forEach(entry => {
                            const entryCid = getCid(entry);
                            protNodes.forEach(pNode => {
                                const pNodeCid = getCid(pNode);
                                const allPaths: string[][] = [];
                                findPathsTo(pNodeCid, entryCid, new Set(), [], allPaths);
                                allPaths.forEach(path => {
                                    assertion.must_pass_through?.forEach((waySuffix: string) => {
                                        const cleanSuffix = waySuffix.replace('id_suffix:', '');
                                        const wayNode = instanceNodes.find(n => getSuffixForExp(n, expId) === cleanSuffix);
                                        if (wayNode && !path.includes(getCid(wayNode))) {
                                            results.push({
                                                severity: 'error',
                                                message: `Connectivity Violation: entry '${entry.id}' bypassing security '${cleanSuffix}'.`
                                            });
                                        }
                                    });
                                });
                            });
                        });
                    });
                }
            }
        });
    });

    // Deduplicate results
    const uniqueResults = Array.from(new Map(results.map(r => [r.message, r])).values());
    return uniqueResults;
}
