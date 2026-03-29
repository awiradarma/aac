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
    const sNodesMain = arch.model?.softwareSystems || [];
    const cNodesMain = arch.model?.containers || [];
    const pNodesMain = arch.model?.people || [];
    
    sNodesMain.forEach((s: any) => {
        (s.containers || []).forEach((cn: any) => { containerMap[cn.id] = cn; });
    });
    cNodesMain.forEach((cn: any) => { containerMap[cn.id] = cn; });

    const flatDeployments: any[] = [];
    const getMemberships = (n: any) => n.properties?.memberships || n.memberships || {};
    
    const getSuffixForExp = (n: any, expId: string) => {
        const m = getMemberships(n);
        if (m[expId]) return m[expId];
        
        const pExp = n.properties?.composition_id || n.composition_id;
        const oVal = n.properties?.origin_pattern || n.origin_pattern;
        const oId = oVal ? oVal.split('@')[0] : null;
        if (pExp === expId || oVal === expId || oId === expId) {
            return n.properties?.id_suffix || n.properties?.composition_alias || n.composition_alias || n.properties?.logical_identity || n.logical_identity;
        }
        return null;
    };

    const nodeMatchesSelector = (n: any, selector: string, expId: string) => {
        const target = selector.replace('id_suffix:', '');
        const actual = getSuffixForExp(n, expId);
        if (!actual) return false;
        
        if (target === 'api' && (actual === 'api' || actual?.startsWith('api-'))) return true;
        if (target === 'gw' && (actual === 'gw' || actual?.startsWith('gw-'))) return true;
        if (target === 'lb' && (actual === 'lb' || actual?.startsWith('lb-'))) return true;
        
        // Bidirectional matching for lenient suffix handling (e.g. 'datacenter' vs 'datacenter-1')
        if (actual === target || actual.startsWith(target + '-') || target.startsWith(actual + '-')) return true;
        
        if (n.id === target || n.logicalId === target || n.properties?.containerId === target || n.properties?.logical_identity === target) return true;
        if (n.name?.toLowerCase().includes(target.toLowerCase())) return true;
        return false;
    };

    const isDescendant = (childId: string, possibleParentId: string): boolean => {
        let curr = flatDeployments.find(n => n.id === childId);
        let depth = 0;
        while (curr && curr.parentId && depth++ < 20) {
            if (curr.parentId === possibleParentId) return true;
            curr = flatDeployments.find(n => n.id === curr.parentId);
        }
        return false;
    };

    const getAncestors = (id: string): string[] => {
        const list: string[] = [];
        let curr = flatDeployments.find(n => n.id === id);
        let depth = 0;
        while (curr && curr.parentId && depth++ < 20) {
            list.push(curr.parentId);
            curr = flatDeployments.find(n => n.id === curr.parentId);
        }
        return list;
    };

    const parseTree = (nodes: any[], parentLayer: string | null, parentId: string | null) => {
        nodes.forEach(dn => {
            const props = dn.properties || dn.data || {};
            let layer = dn.layer || props.layer;
            if (!layer) {
                const nameContent = (dn.name || props.label || '').toLowerCase();
                if (nameContent.includes('region')) layer = 'Region';
                else if (nameContent.includes('datacenter') || nameContent.includes('dc')) layer = 'Datacenter';
                else if (nameContent.includes('cluster')) layer = 'Cluster';
                else layer = (parentLayer === 'Region' ? 'Datacenter' : (parentLayer === 'Datacenter' ? 'Container' : 'Region'));
            }
            const entry = { ...dn, properties: props, type: layer, layer, parentLayer, parentId, isInstance: true };
            flatDeployments.push(entry);
            if (dn.containerInstances) {
                dn.containerInstances.forEach((ci: any) => {
                    const cn = containerMap[ci.containerId] || {};
                    flatDeployments.push({
                        ...cn, ...ci, id: ci.id || ci.containerId, logicalId: ci.containerId, isInstance: true,
                        type: 'Container', layer: 'Container', parentLayer: layer, parentId: dn.id,
                        properties: { ...cn.properties, ...ci.properties }
                    });
                });
            }
            if (dn.infrastructureNodes) {
                dn.infrastructureNodes.forEach((inNode: any) => {
                    flatDeployments.push({ ...inNode, id: inNode.id, isInstance: true, type: 'InfrastructureNode', layer: 'InfrastructureNode', parentLayer: layer, parentId: dn.id });
                });
            }
            if (dn.nodes) parseTree(dn.nodes, layer, dn.id);
        });
    };
    parseTree(arch.deployment?.nodes || [], null, null);
    sNodesMain.forEach(s => {
        flatDeployments.push({ ...s, type: 'SoftwareSystem', layer: 'SoftwareSystem' });
        (s.containers || []).forEach((c: any) => {
            flatDeployments.push({ ...c, type: 'Container', layer: 'Container', parentId: s.id });
            (c.components || []).forEach((m: any) => flatDeployments.push({ ...m, type: 'Component', layer: 'Component', parentId: c.id }));
        });
    });
    cNodesMain.forEach((c: any) => {
        if (!flatDeployments.some(x => x.id === c.id)) {
            flatDeployments.push({ ...c, type: 'Container', layer: 'Container' });
            (c.components || []).forEach((m: any) => flatDeployments.push({ ...m, type: 'Component', layer: 'Component', parentId: c.id }));
        }
    });
    pNodesMain.forEach(p => flatDeployments.push({ ...p, type: 'Person', layer: 'Person' }));

    const uniqueMap = new Map();
    [...flatDeployments].sort((a, b) => a.isInstance === b.isInstance ? 0 : (a.isInstance ? 1 : -1)).forEach(n => { if (n.id) uniqueMap.set(n.id, n); });
    flatDeployments.length = 0; flatDeployments.push(...uniqueMap.values());

    const adjList: Record<string, string[]> = {};
    const rawAdjList: Record<string, string[]> = {};
    const rels = arch.model?.relationships || arch.relationships || [];
    rels.forEach((rel: any) => {
        if (rel.sourceId && rel.destinationId) {
            // adjList remains rolled-up for general pattern rules (existence, cohesion etc)
            const sources = [rel.sourceId, ...getAncestors(rel.sourceId)];
            const targets = [rel.destinationId, ...getAncestors(rel.destinationId)];
            sources.forEach(s => targets.forEach(t => {
                if (s !== t) { if (!adjList[s]) adjList[s] = []; if (!adjList[s].includes(t)) adjList[s].push(t); }
            }));
            
            // rawAdjList for strict connectivity pathfinding to avoid containment shortcuts
            if (!rawAdjList[rel.sourceId]) rawAdjList[rel.sourceId] = [];
            if (!rawAdjList[rel.sourceId].includes(rel.destinationId)) rawAdjList[rel.sourceId].push(rel.destinationId);
        }
    });

    const findPathsTo = (tgt: string, cur: string, seen: Set<string>, path: string[], all: string[][], useRaw = false) => {
        if (cur === tgt) { all.push([...path, cur]); return; }
        if (seen.has(cur) || path.length > 20) return;
        seen.add(cur);
        const list = useRaw ? rawAdjList : adjList;
        (list[cur] || []).forEach(n => findPathsTo(tgt, n, seen, [...path, cur], all, useRaw));
        seen.delete(cur);
    };

    const rootNodes = flatDeployments.filter(n => n.properties?.origin_pattern || n.origin_pattern);
    const expansions = new Map<string, { root: any, pattern: any, members: Set<any>, expId: string }>();

    rootNodes.forEach(root => {
        const pExp = root.properties?.composition_id || root.composition_id;
        const oVal = root.properties?.origin_pattern || root.origin_pattern;
        const expId = pExp || oVal.split('@')[0];
        const pattern = oVal.includes('@') ? patterns.find(p => p.id === oVal.split('@')[0] && p.version === oVal.split('@')[1]) : patterns.find(p => p.id === oVal);
        if (!pattern) return;

        if (!expansions.has(expId)) expansions.set(expId, { root, pattern, members: new Set(), expId });
        const ex = expansions.get(expId)!;
        flatDeployments.forEach(n => {
            const m = getMemberships(n);
            const nExp = n.properties?.composition_id || n.composition_id;
            if (nExp === expId || m[expId] || m[pattern.id] || oVal === n.properties?.origin_pattern) {
                ex.members.add(n);
                getAncestors(n.id).forEach(aid => { const a = flatDeployments.find(x => x.id === aid); if (a) ex.members.add(a); });
            }
        });
        ex.members.add(root);
        getAncestors(root.id).forEach(aid => { const a = flatDeployments.find(x => x.id === aid); if (a) ex.members.add(a); });
    });

    patterns.forEach(p => {
        flatDeployments.forEach(n => {
            const m = getMemberships(n);
            if (m[p.id] && !Array.from(expansions.values()).some(ex => ex.pattern.id === p.id && ex.members.has(n))) {
                const expId = `adopt-${p.id}`;
                if (!expansions.has(expId)) expansions.set(expId, { root: n, pattern: p, members: new Set(), expId });
                const ex = expansions.get(expId)!;
                ex.members.add(n);
                getAncestors(n.id).forEach(aid => { const a = flatDeployments.find(x => x.id === aid); if (a) ex.members.add(a); });
            }
        });
    });

    expansions.forEach((ex, anchor) => {
        const { pattern, members, expId } = ex;
        const instanceNodes = Array.from(members);
        (pattern.rules || []).forEach(rule => {
            const severity = rule.severity === 'mandatory' ? 'error' : 'warning';
            const cleanNode = rule.node?.replace('id_suffix:', '');
            
            if (rule.type === 'node_existence') {
                if (!instanceNodes.some(n => nodeMatchesSelector(n, rule.node, expId))) {
                    results.push({ severity, message: rule.description || `Pattern '${pattern.name}' is missing mandatory component '${rule.node}'`, ruleId: rule.id, patternId: pattern.id });
                }
            } else if (rule.type === 'edge_existence') {
                const s = instanceNodes.find(n => nodeMatchesSelector(n, rule.source, expId));
                const t = instanceNodes.find(n => nodeMatchesSelector(n, rule.target, expId));
                if (s && t && !(adjList[s.id] || []).includes(t.id)) {
                    results.push({ severity, message: rule.description || `Pattern '${pattern.name}' is missing mandatory connection from '${rule.source}' to '${rule.target}'`, ruleId: rule.id, patternId: pattern.id });
                }
            } else if (rule.type === 'property_constraint') {
                const t = instanceNodes.find(n => nodeMatchesSelector(n, rule.node, expId));
                if (t) {
                    const val = t.properties?.[rule.property];
                    const allowed = rule.allowed_values || [];
                    if (!allowed.includes(val)) results.push({ severity, message: rule.description || `Standardization Violation: ${t.name || rule.node} must use ${rule.property}=${allowed.join(' or ')}`, ruleId: rule.id, patternId: pattern.id });
                }
            } else if (rule.type === 'placement_redundancy') {
                (rule.constraints || []).forEach((c: any) => {
                    const targets = instanceNodes.filter(n => nodeMatchesSelector(n, rule.node, expId));
                    const groups = new Map();
                    const groupLayer = c.groupBy.split(':')[1];
                    targets.forEach(tn => {
                        let p = flatDeployments.find(x => x.id === tn.parentId);
                        while (p) { if (p.layer === groupLayer) { if (!groups.has(p.id)) groups.set(p.id, []); groups.get(p.id).push(tn); break; } p = flatDeployments.find(x => x.id === p.parentId); }
                    });
                    const count = groups.size;
                    const min = c.total_count || c.min_count;
                    if (min && count < min) {
                         results.push({ severity, message: c.description || `Redundancy Violation: ${pattern.name} requires ${cleanNode} across at least ${min} ${groupLayer}s. Found ${count}.`, ruleId: rule.id, patternId: pattern.id });
                    }
                    if (c.within) {
                        const withinL = c.within.split(':')[1];
                        const ancestorsOfTargets = new Set(targets.flatMap(t => getAncestors(t.id)));
                        flatDeployments.filter(n => n.layer === withinL && ancestorsOfTargets.has(n.id)).forEach(pNode => {
                            const kids = Array.from(groups.keys()).filter(id => id === pNode.id || isDescendant(id, pNode.id));
                            if (c.min_count && kids.length < c.min_count) {
                                results.push({ severity, message: c.description || `${pNode.name || pNode.id} must contain at least ${c.min_count} ${groupLayer}s hosting ${rule.node}. Found ${kids.length}.`, ruleId: rule.id, patternId: pattern.id });
                            }
                        });
                    }
                });
            } else if (rule.type === 'edge_property_constraint') {
                const groupL = rule.groupBy?.split(':')[1] || 'Region';
                const groups = new Map();
                instanceNodes.filter(n => nodeMatchesSelector(n, rule.target, expId)).forEach(tn => {
                    let p = flatDeployments.find(x => x.id === tn.parentId);
                    while (p) { if (p.layer === groupL) { if (!groups.has(p.id)) groups.set(p.id, { nodes: [], edges: [] }); groups.get(p.id).nodes.push(tn); break; } p = flatDeployments.find(x => x.id === p.parentId); }
                });

                if (rule.enforce_group_cohesion) {
                    groups.forEach((g, gid) => {
                        const sNodes = instanceNodes.filter(n => nodeMatchesSelector(n, rule.source, expId));
                        const allRels = rels.filter(r => sNodes.some(s => s.id === r.sourceId) && g.nodes.some(tn => tn.id === r.destinationId));
                        if (allRels.length > 1) {
                            const f = allRels[0];
                            const getS = (r: any) => r.properties?.styleVariant || r.styleVariant || r.properties?.style || r.style;
                            if (allRels.some(r => getS(r) !== getS(f))) {
                                results.push({ severity, message: `Topology Violation: Region ${flatDeployments.find(x=>x.id===gid)?.name || gid} has mixed active/passive paths.`, ruleId: rule.id, patternId: pattern.id });
                            }
                        }
                    });
                }

                (rule.group_distribution || []).forEach((dist: any) => {
                    let matchCount = 0;
                    groups.forEach((g, gid) => {
                        const sNodes = instanceNodes.filter(n => nodeMatchesSelector(n, rule.source, expId));
                        const mRels = rels.filter(r => sNodes.some(s => s.id === r.sourceId) && g.nodes.some(tn => tn.id === r.destinationId));
                        const edgeOk = !dist.edge_property || Object.entries(dist.edge_property).every(([k, v]) => {
                             const e = mRels.find(r => (r.properties?.[k] || r[k] || (k === 'style' ? (r.properties?.styleVariant || r.styleVariant || r.properties?.style || r.style) : null)) === v);
                             return !!e;
                        });
                        const nodePk = !dist.target_node_property || Object.entries(dist.target_node_property).every(([k, v]) => {
                            return g.nodes.some(tn => tn.properties?.[k] === v) || flatDeployments.find(x => x.id === gid)?.properties?.[k] === v;
                        });
                        if (edgeOk && nodePk) matchCount++;
                    });
                    if (dist.min_groups !== undefined && matchCount < dist.min_groups) {
                        results.push({ severity, message: dist.description || `expected at least ${dist.min_groups} ${dist.role} groups, found ${matchCount}.`, ruleId: rule.id, patternId: pattern.id });
                    }
                });
            } else if (rule.type === 'connectivity') {
                 const tNodes = instanceNodes.filter(n => nodeMatchesSelector(n, rule.to, expId));
                 const ways = (rule.must_pass_through || []).map((w: string) => instanceNodes.find(n => nodeMatchesSelector(n, w, expId))?.id).filter(Boolean);
                 const ancestors = tNodes.flatMap(t => getAncestors(t.id));
                 
                 tNodes.forEach(t => {
                     const prot = [t.id, ...flatDeployments.filter(n => isDescendant(n.id, t.id)).map(n => n.id)];
                     // Connectivity entries must NOT be pattern members, NOT descendants, and NOT parent containers (which inherently have paths)
                     flatDeployments.filter(n => !getSuffixForExp(n, expId) && !prot.includes(n.id) && !ancestors.includes(n.id)).forEach(entry => {
                         const paths: string[][] = []; findPathsTo(t.id, entry.id, new Set(), [], paths, true);
                         if (paths.length > 0 && !paths.some(p => ways.every(w => p.includes(w)))) {
                             results.push({ severity, message: rule.description || `Connectivity Violation: entry '${entry.name || entry.id}' bypassing security. Traffic to '${t.name || t.id}' MUST pass through '${rule.must_pass_through?.join("' and '")}'.`, ruleId: rule.id, patternId: pattern.id });
                         }
                     });
                 });
            }
        });
    });

    return Array.from(new Map(results.map(r => [r.message, r])).values());
}
