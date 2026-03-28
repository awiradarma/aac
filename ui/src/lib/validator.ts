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
        const originVal = n.properties?.origin_pattern || n.origin_pattern;
        const originId = originVal ? originVal.split('@')[0] : null;

        // MATCH: Check qualified memberships first (most specific)
        if (memberships[expId]) return memberships[expId];

        // MATCH: If expId matches the pattern origin (base or versioned), return the logical suffix
        if (primaryExpId === expId || originVal === expId || originId === expId) {
            return n.properties?.id_suffix || n.properties?.composition_alias || n.composition_alias || n.properties?.logical_identity || n.logical_identity;
        }
        return null;
        return null;
    };

    const nodeMatchesSelector = (n: any, selector: string, expId: string) => {
        const targetSuffix = selector.replace('id_suffix:', '');
        const actualSuffix = getSuffixForExp(n, expId);
        if (targetSuffix === 'api' && (actualSuffix === 'api' || (actualSuffix && actualSuffix.startsWith('api-')))) {
             return true;
        }
        if (targetSuffix === 'gw' && (actualSuffix === 'gw' || (actualSuffix && actualSuffix.startsWith('gw-')))) {
             return true;
        }
        
        const matchesSuffix = (actualSuffix === targetSuffix) || 
               (actualSuffix && actualSuffix.startsWith(targetSuffix + '-'));

        const matchesLogicalMaster = n.logicalId === targetSuffix || (n.properties?.containerId === targetSuffix);
        
        if (matchesSuffix || matchesLogicalMaster) return true;
        
        let logicalTemplateMatches = false;
        if (n.logicalId && containerMap[n.logicalId]) {
            const template = containerMap[n.logicalId];
            const templateSuffix = template.properties?.composition_alias || template.composition_alias;
            if (templateSuffix === targetSuffix || (templateSuffix && templateSuffix.startsWith(targetSuffix + '-'))) {
                logicalTemplateMatches = true;
            }
        }

        const matchesLabel = n.name && (n.name.toLowerCase().includes(targetSuffix.toLowerCase()) || n.label?.toLowerCase().includes(targetSuffix.toLowerCase()));
        const matchesType = (n.properties?.widget_ref || n.widget_ref || n.data?.widget_ref)?.split('@')[0]?.toLowerCase() === targetSuffix.toLowerCase();
        
        const matchesLogical = (n.logicalId && (n.logicalId.toLowerCase() === targetSuffix.toLowerCase() || 
                                              n.logicalId.toLowerCase().startsWith(targetSuffix.toLowerCase() + '-') ||
                                              targetSuffix.toLowerCase().startsWith(n.logicalId.toLowerCase())));
        
        // Final fallback: check internal properties directly (useful for Strays)
        const matchesInternalSuffix = n.properties && (
            n.properties.id_suffix === targetSuffix || 
            (n.properties.id_suffix && n.properties.id_suffix.startsWith(targetSuffix + '-')) ||
            n.properties.logical_identity === targetSuffix ||
            (n.properties.logical_identity && n.properties.logical_identity.startsWith(targetSuffix + '-'))
        );

        // Absolute fallback: check if the GUID/ID itself contains the marker
        const matchesId = n.id && n.id.toLowerCase().includes(targetSuffix.toLowerCase());

        return matchesSuffix || logicalTemplateMatches || matchesLabel || matchesType || matchesLogical || !!matchesInternalSuffix || !!matchesId;
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
            const layerType = pattern?.layer || dn.layer || 'Unknown';

            const entry = { ...dn, type: layerType, layer: layerType, parentLayer, parentId, isInstance: true };
            flatDeployments.push(entry);

            if (dn.containerInstances) {
                dn.containerInstances.forEach((ci: any) => {
                    let cn = containerMap[ci.containerId];
                    // Healing logic: if GUID lookup fails (state loss), try finding the template by logical identity
                    if (!cn && ci.properties?.logical_identity) {
                        cn = Object.values(containerMap).find(v => (v.properties?.logical_identity === ci.properties.logical_identity) || (v.logical_identity === ci.properties.logical_identity));
                    }
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
                            properties: { ...cn.properties, ...ci.properties, ...(ci.properties?.properties || {}) }
                        });
                    } else {
                        // Diagnostic for missing template - PRESERVE PROPERTIES
                        flatDeployments.push({
                            id: ci.id,
                            name: `STRAY-${ci.id.slice(-4)}`,
                            containerId: ci.containerId,
                            isInstance: true,
                            type: 'StrayContainer',
                            layer: 'StrayContainer',
                            parentLayer: layerType,
                            parentId: dn.id,
                            properties: { ...ci.properties, _error: `Template ${ci.containerId} not found in containerMap` }
                        });
                    }
                });
            }
            if (dn.infrastructureNodes) {
                dn.infrastructureNodes.forEach((infra: any) => {
                    flatDeployments.push({
                        ...infra,
                        isInstance: true,
                        type: 'InfrastructureNode',
                        layer: 'InfrastructureNode',
                        parentLayer: layerType,
                        parentId: dn.id,
                        properties: { ...(infra.properties || {}), ...(infra.properties?.properties || {}) }
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
        const originVal = n.properties?.origin_pattern || n.origin_pattern;
        const originId = originVal ? originVal.split('@')[0] : null;

        const allIds = new Set(Object.keys(memberships));
        if (primaryExpId) allIds.add(primaryExpId);
        if (originVal) allIds.add(originVal);
        if (originId) allIds.add(originId);

        allIds.forEach(id => {
            let validForThisId = false;
            // A node is valid for a census ID if:
            // 1. It carries that ID in its memberships (explicit role)
            // 2. It IS an instance and its origin pattern (base or versioned) matches the ID
            // 3. It is a logical template for that pattern
            
            const originVal = n.properties?.origin_pattern || n.origin_pattern;
            const originId = originVal ? originVal.split('@')[0] : null;

            if (memberships[id] || primaryExpId === id || originVal === id || originId === id) {
                validForThisId = true;
            } else if (n.isInstance) {
                let currentP = flatDeployments.find(p => p.id === n.parentId);
                while (currentP) {
                    const pMem = getMemberships(currentP);
                    const pPrime = currentP.properties?.composition_id || currentP.composition_id;
                    const pOrigin = currentP.properties?.origin_pattern || currentP.origin_pattern;
                    const pOriginId = pOrigin ? pOrigin.split('@')[0] : null;

                    if (pMem[id] || pPrime === id || pOrigin === id || pOriginId === id) {
                        validForThisId = true;
                        break;
                    }
                    currentP = flatDeployments.find(p => p.id === currentP.parentId);
                }
            }

            if (validForThisId) {
                if (!expansionInstances[id]) expansionInstances[id] = [];
                if (!expansionInstances[id].includes(n)) expansionInstances[id].push(n);
            }
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

    const instances = Object.entries(expansionInstances);
    instances.forEach(([expId, instanceNodes]) => {
        // GHOST CENSUS SUPPRESSION: If this census ID is a pattern-id (not a GUID) 
        // and it has no nodes that are explicitly part of this specific census (memberships or composition_id), 
        // then it is a "ghost" census generated by the pattern-detector/registry lookup.
        // We skip it to avoid false-positive "Found 0" errors.
        if (!expId.startsWith('exp-')) {
            const hasPrimaryNodes = instanceNodes.some(n => {
                const memberships = getMemberships(n);
                return memberships[expId] || n.properties?.composition_id === expId || n.composition_id === expId;
            });
            if (!hasPrimaryNodes) return;
        }

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
                    } as any);
                    if (m.properties) {
                        Object.entries(m.properties).forEach(([k, v]) => {
                            normalizedRules.push({
                                id: `legacy-prop-${m.id_suffix}-${k}`,
                                scope: 'all', severity: 'mandatory', type: 'property_constraint', node: `id_suffix:${m.id_suffix}`, property: k, allowed_values: [v]
                            } as any);
                        });
                    }
                });
            }
            if (comp.edges) {
                comp.edges.forEach((e: any, i: number) => {
                    normalizedRules.push({
                        id: `legacy-edge-${i}`,
                        scope: 'all', severity: 'mandatory', type: 'edge_existence', source: `id_suffix:${e.source_suffix}`, target: `id_suffix:${e.target_suffix}`
                    } as any);
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
        const applicableRules = normalizedRules.filter(r => !scope || !r.scope || r.scope === scope || r.scope === 'all');

        applicableRules.forEach(rule => {
            const severityVal: 'error' | 'warning' | 'info' = rule.severity === 'mandatory' ? 'error' : (rule.severity === 'recommended' ? 'warning' : 'info');
            
            if (rule.type === 'node_existence') {
                const hasIt = instanceNodes.some(n => nodeMatchesSelector(n, rule.node, expId));
                if (!hasIt) {
                    if (rule.severity === 'optional') return;
                    results.push({
                        severity: severityVal,
                        message: rule.description || `Pattern '${originPattern.name}' is missing ${severityVal === 'error' ? 'mandatory' : 'recommended'} component '${rule.node}'${scope === 'container' ? '. Switch to Deployment view to add it.' : '.'}`,
                        ruleId: rule.id,
                        patternName: originPattern.name,
                        patternId: originPattern.id
                    });
                }
            } else if (rule.type === 'edge_existence') {
                const sourceNode = instanceNodes.find(n => nodeMatchesSelector(n, rule.source, expId));
                const targetNode = instanceNodes.find(n => nodeMatchesSelector(n, rule.target, expId));

                if (sourceNode && targetNode) {
                    const sCid = getCid(sourceNode);
                    const tCid = getCid(targetNode);
                    const hasEdge = (adjList[sCid] || []).includes(tCid);
                    if (!hasEdge && rule.severity !== 'optional') {
                        results.push({
                            severity: severityVal,
                            message: rule.description || `Pattern '${originPattern.name}' is missing ${severityVal === 'error' ? 'mandatory' : 'recommended'} connection from '${rule.source}' to '${rule.target}'.`,
                            ruleId: rule.id,
                            patternName: originPattern.name,
                            patternId: originPattern.id
                        });
                    }
                }
            } else if (rule.type === 'property_constraint') {
                const targetNode = instanceNodes.find(n => nodeMatchesSelector(n, rule.node, expId));
                if (targetNode) {
                    const propVal = targetNode.properties ? targetNode.properties[rule.property] : undefined;
                    console.log(`[VALIDATOR DEBUG] Validating property_constraint for ${rule.node}`);
                    console.log(`Target Node Props:`, targetNode.properties);
                    console.log(`Expected Property [${rule.property}]:`, rule.allowed_values);
                    console.log(`Actual Property Value:`, propVal);

                    // Strict match check
                    const resolvedAllowed = Array.isArray(rule.allowed_values) ? rule.allowed_values : [];
                    if (!resolvedAllowed.includes(propVal) && rule.severity !== 'optional') {
                        results.push({
                            severity: severityVal,
                            message: rule.description || `Standardization Violation: ${targetNode.name || rule.node} must use ${rule.property}=${resolvedAllowed.join(' or ')} (required by ${originPattern.name}).`,
                            ruleId: rule.id,
                            patternName: originPattern.name,
                            patternId: originPattern.id
                        });
                    }
                }
            } else if (rule.type === 'placement_redundancy') {
                const targetNodes = instanceNodes.filter(n => n.isInstance && nodeMatchesSelector(n, rule.node, expId));
                
                if (rule.constraints) {
                    rule.constraints.forEach((constraint: any) => {
                        const groups = new Map<string, any[]>();
                        const groupLayer = constraint.groupBy.replace('layer:', '');

                        targetNodes.forEach(tn => {
                            let parent = uniqueDeployments.find(p => p.id === tn.parentId);
                            while (parent) {
                                if (parent.type?.toLowerCase() === groupLayer.toLowerCase() || parent.layer?.toLowerCase() === groupLayer.toLowerCase()) {
                                    if (!groups.has(parent.id)) groups.set(parent.id, []);
                                    groups.get(parent.id)!.push(tn);
                                    break;
                                }
                                parent = uniqueDeployments.find(p => p.id === parent.parentId);
                            }
                        });

                        const actualCount = groups.size;
                        const min = constraint.total_count || constraint.min_count;
                        const max = constraint.max_count;

                        if (min && actualCount < min) {
                            if (actualCount === 0 && !expId.startsWith('exp-')) {
                                // Skip: if we found zero nodes of this suffix for a generic pattern-id census, 
                                // it's likely just a census ghost. GUID-specific censuses will catch real errors.
                                return;
                            }
                            
                            const matchedNodesInfo = targetNodes.map(tn => {
                                const p = uniqueDeployments.find(p => p.id === tn.parentId);
                                return `${tn.name}(rawParentId:${tn.parentId}, foundParent:${p?.name || 'none'}, layer:${p?.layer || p?.type || 'none'})`;
                            }).join(', ');
                            
                            const structureSummary = uniqueDeployments.map(n => 
                                `ID:${n.id}(Name:${n.name}, Layer:${n.layer}, Parent:${n.parentId})`
                            ).slice(0, 10).join(' | '); // Limit to first 10 for space
                            
                            const foundLabels = Array.from(groups.keys()).map(gid => uniqueDeployments.find(n => n.id === gid)?.name || gid).join(', ');
                            const diag = (targetNodes.length === 0) ? " (Zero target nodes matched selector)" : 
                                         ` (Matches: ${matchedNodesInfo} | Groups: ${foundLabels || 'None'})`;
                            
                            console.log(`[VALIDATOR] Redundancy Violation for ${rule.node}: Found ${actualCount}/${min}. TargetNodes:`, targetNodes);
                            const cleanNodeSelector = rule.node.replace('id_suffix:', '');
                            results.push({
                                severity: severityVal,
                                message: constraint.description || `Redundancy Violation: ${originPattern.name} requires ${cleanNodeSelector} across at least ${min} ${constraint.groupBy.replace('layer:', '')}s. Found ${actualCount}.${diag}`,
                                ruleId: rule.id,
                                patternName: originPattern.name,
                                patternId: originPattern.id
                            });
                        }
                        if (max && actualCount > max) {
                            results.push({
                                severity: severityVal,
                                message: constraint.description || `Redundancy Violation: ${originPattern.name} requires ${rule.node} across at most ${max} ${constraint.groupBy.replace('layer:', '')}s. Found ${actualCount}.`,
                                ruleId: rule.id,
                                patternName: originPattern.name,
                                patternId: originPattern.id
                            });
                        }

                        if (constraint.within) {
                            const parentLayer = constraint.within.replace('layer:', '');
                            const candidateParents = instanceNodes.filter(n => n.type === parentLayer || n.layer === parentLayer);
                            
                            candidateParents.forEach(pNode => {
                                const childrenOfThisParent = Array.from(groups.keys()).filter(groupId => {
                                    return groupId === pNode.id || isDescendant(groupId, pNode.id);
                                });

                                if (constraint.min_count && childrenOfThisParent.length < constraint.min_count) {
                                    results.push({
                                        severity: severityVal,
                                        message: constraint.description || `Redundancy Violation: ${pNode.name || pNode.id} must contain at least ${constraint.min_count} ${constraint.groupBy.replace('layer:', '')}s hosting ${rule.node}. Found ${childrenOfThisParent.length}.`,
                                        ruleId: rule.id,
                                        patternName: originPattern.name,
                                        patternId: originPattern.id
                                    });
                                }
                            });
                        }
                    });
                }
            } else if (rule.type === 'edge_property_constraint') {
                const sourceNodes = instanceNodes.filter(n => nodeMatchesSelector(n, rule.source, expId));
                const targetNodes = instanceNodes.filter(n => nodeMatchesSelector(n, rule.target, expId));

                const getEdges = (src: any, tgt: any) => {
                    const sCid = getCid(src);
                    const tCid = getCid(tgt);
                    return rels.filter((r: any) => r.sourceId === sCid && r.destinationId === tCid);
                };

                const allEdges: any[] = [];
                sourceNodes.forEach(s => {
                    targetNodes.forEach(t => {
                        allEdges.push(...getEdges(s, t).map((e: any) => ({ edge: e, source: s, target: t })));
                    });
                });

                if (rule.groupBy) {
                    const layer = rule.groupBy.replace('layer:', '');
                    const groups = new Map<string, { nodes: any[], edges: any[] }>();

                    targetNodes.forEach(tn => {
                        let p = flatDeployments.find(n => n.id === tn.parentId || n.logicalId === tn.parentId);
                        while (p) {
                            if (p.type === layer || p.layer === layer) {
                                if (!groups.has(p.id)) groups.set(p.id, { nodes: [], edges: [] });
                                groups.get(p.id)!.nodes.push(tn);
                                break;
                            }
                            p = flatDeployments.find(n => n.id === p.parentId || n.logicalId === p.parentId);
                        }
                    });

                    allEdges.forEach(ae => {
                        const targetGroup = Array.from(groups.entries()).find(([_, g]) => g.nodes.some(n => n.id === ae.target.id));
                        if (targetGroup) {
                            targetGroup[1].edges.push(ae.edge);
                        }
                    });

                    if (rule.enforce_group_cohesion) {
                        groups.forEach((g, gid) => {
                            if (g.edges.length > 0) {
                                const firstEdge = g.edges[0];
                                const mismatch = g.edges.some((e: any) => e.style !== firstEdge.style || e.label !== firstEdge.label);
                                if (mismatch) {
                                    const gNode = flatDeployments.find(n => n.id === gid);
                                    results.push({
                                        severity: severityVal,
                                        message: `Topology Violation: ${layer} ${gNode?.name || gid} has mixed active/passive paths. All paths to a single ${layer} must be identical.`,
                                        ruleId: rule.id,
                                        patternName: originPattern.name,
                                        patternId: originPattern.id
                                    });
                                }
                            }
                        });
                    }

                    if (rule.group_distribution) {
                        const roleCounts = new Map<string, number>();
                        groups.forEach((g, _gid) => {
                            rule.group_distribution!.forEach((dist: any) => {
                                const matchesEdge = g.edges.length > 0 && (!dist.edge_property || Object.entries(dist.edge_property).every(([k, v]) => {
                                    return g.edges.some(e => {
                                        const actual = e.properties?.[k] || e[k] || (k === 'style' ? (e.properties?.styleVariant || e.styleVariant) : null);
                                        return actual === v;
                                    });
                                }));
                                
                                const matchesNode = g.nodes.length > 0 && (!dist.target_node_property || Object.entries(dist.target_node_property).every(([k, v]) => {
                                    return g.nodes.some(tn => {
                                        // Check node itself
                                        if (tn.properties?.[k] === v || tn[k] === v) return true;
                                        // Check parents (inheritance)
                                        let p = uniqueDeployments.find(parent => parent.id === tn.parentId);
                                        while (p) {
                                            if (p.properties?.[k] === v || p[k] === v) return true;
                                            p = uniqueDeployments.find(parent => parent.id === p.parentId);
                                        }
                                        return false;
                                    });
                                }));
                                
                                if (matchesEdge && matchesNode) {
                                    roleCounts.set(dist.role, (roleCounts.get(dist.role) || 0) + 1);
                                }
                            });
                        });

                        rule.group_distribution.forEach((dist: any) => {
                            const count = roleCounts.get(dist.role) || 0;
                            if (dist.min_groups !== undefined && count < dist.min_groups) {
                                const diag = ` (Actually matched ${groups.size} groups, but only ${count} satisfied criteria for role ${dist.role})`;
                                results.push({
                                    severity: severityVal,
                                    message: dist.description || `Topology Violation: Expected at least ${dist.min_groups} ${dist.role} groups, found ${count}.${diag}`,
                                    ruleId: rule.id,
                                    patternName: originPattern.name,
                                    patternId: originPattern.id
                                });
                            }
                            if (dist.max_groups !== undefined && count > dist.max_groups) {
                                results.push({
                                    severity: severityVal,
                                    message: dist.description || `Topology Violation: Expected at most ${dist.max_groups} ${dist.role} groups, found ${count}.`,
                                    ruleId: rule.id,
                                    patternName: originPattern.name,
                                    patternId: originPattern.id
                                });
                            }
                        });
                    }
                }
            } else if (rule.type === 'connectivity') {
                const targetNode = instanceNodes.find(n => nodeMatchesSelector(n, rule.to, expId));
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
                            return rule.must_pass_through?.every((waySelector: string) => {
                                const wayNode = instanceNodes.find(n => nodeMatchesSelector(n, waySelector, expId));
                                if (!wayNode) return true; // Waypoint missing from model, can't reliably validate path
                                return path.includes(getCid(wayNode));
                            });
                        });

                        if (!hasCompliantPath) {
                            results.push({
                                severity: severityVal,
                                message: rule.description || `Connectivity Violation: entry '${entry.name}' bypassing security. Traffic to '${pNode.name || pNode.id}' MUST pass through '${rule.must_pass_through?.map((w: string) => w).join("' and '")}'.`,
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
                        const tgtNode = instanceNodes.find(n => nodeMatchesSelector(n, assertion.to, expId));
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
                                    assertion.must_pass_through?.forEach((waySelector: string) => {
                                        const wayNode = instanceNodes.find(n => nodeMatchesSelector(n, waySelector, expId));
                                        if (wayNode && !path.includes(getCid(wayNode))) {
                                            results.push({
                                                severity: 'error',
                                                message: `Connectivity Violation: entry '${entry.id}' bypassing security '${waySelector}'.`
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
