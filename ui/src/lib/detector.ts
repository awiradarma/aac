import type { Registry } from '../types';

export interface DiscoveryResult {
    detectorId: string;
    detectorName: string;
    targetPattern: string;
    matchedNodes: Record<string, any>;
}

export function detectPatterns(arch: any, registry: Registry): DiscoveryResult[] {
    const detectors = registry.detectors || [];
    if (!detectors.length) return [];

    const flatDeployments: any[] = [];
    const containerMap: Record<string, any> = {};
    const cNodes = arch.model?.containers || [];
    cNodes.forEach((cn: any) => { containerMap[cn.id] = cn; });

    const parseTree = (nodes: any[], parentId: string | null) => {
        nodes.forEach(dn => {
            flatDeployments.push({ ...dn, type: 'DeploymentNode', c4Level: 'DeploymentNode', parentId });
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
                            c4Level: 'Container',
                            parentId: dn.id,
                            properties: { ...cn.properties, ...ci.properties }
                        });
                    }
                });
            }
            if (dn.nodes) parseTree(dn.nodes, dn.id);
        });
    };
    parseTree(arch.deployment?.nodes || [], null);

    const adjList: Record<string, string[]> = {};
    const rels = arch.model?.relationships || [];
    rels.forEach((rel: any) => {
        if (rel.sourceId && rel.destinationId) {
            if (!adjList[rel.sourceId]) adjList[rel.sourceId] = [];
            adjList[rel.sourceId].push(rel.destinationId);
        }
    });

    const isDescendant = (childId: string, possibleParentId: string): boolean => {
        let curr = flatDeployments.find(n => n.id === childId);
        while (curr && curr.parentId) {
            if (curr.parentId === possibleParentId) return true;
            curr = flatDeployments.find(n => n.id === curr.parentId);
        }
        return false;
    };

    const results: DiscoveryResult[] = [];

    detectors.forEach(detector => {
        const nodeMatchConds = detector.conditions.filter((c: any) => c.node_match);
        const relConds = detector.conditions.filter((c: any) => c.relationship);

        const aliasCandidates: Record<string, any[]> = {};
        for (const cond of nodeMatchConds) {
            const rules = cond.node_match;
            const alias = rules.alias;
            aliasCandidates[alias] = flatDeployments.filter(n => {
                if (n.properties?.origin_pattern === detector.target_pattern) return false;

                if (rules.c4Level && n.c4Level !== rules.c4Level && n.type !== rules.c4Level) return false;
                if (rules.pattern_ref) {
                    const id = n.properties?.pattern_ref?.split('@')[0] || n.pattern_ref?.split('@')[0];
                    if (id !== rules.pattern_ref) return false;
                }
                if (rules.name_regex) {
                    const rx = new RegExp(rules.name_regex, 'i');
                    if (!rx.test(n.name || '')) return false;
                }
                return true;
            });
            if (aliasCandidates[alias].length === 0) return; // No matches for this
        }

        const aliases = Object.keys(aliasCandidates);

        const backtrack = (idx: number, currentCombo: Record<string, any>) => {
            if (idx === aliases.length) {
                let valid = true;
                for (const cond of relConds) {
                    const r = cond.relationship;
                    const src = currentCombo[r.source];
                    const tgt = currentCombo[r.target];
                    if (!src || !tgt) { valid = false; break; }

                    if (r.type === 'hosted_on') {
                        if (!isDescendant(src.id, tgt.id)) valid = false;
                    } else if (r.type === 'connects_to') {
                        const sId = src.logicalId || src.id;
                        const tId = tgt.logicalId || tgt.id;
                        if (!adjList[sId] || !adjList[sId].includes(tId)) valid = false;
                    }
                }
                if (valid) {
                    // Check if identical combo already pushed (could happen if generic nodes)
                    const isDup = results.some(r => r.detectorId === detector.id && Object.keys(currentCombo).every(k => r.matchedNodes[k].id === currentCombo[k].id));
                    if (!isDup) {
                        results.push({
                            detectorId: detector.id,
                            detectorName: detector.name,
                            targetPattern: detector.target_pattern,
                            matchedNodes: { ...currentCombo }
                        });
                    }
                }
                return;
            }

            const alias = aliases[idx];
            for (const candidate of aliasCandidates[alias]) {
                const alreadyUsed = Object.values(currentCombo).some(n => n.id === candidate.id);
                if (!alreadyUsed) {
                    currentCombo[alias] = candidate;
                    backtrack(idx + 1, currentCombo);
                    delete currentCombo[alias];
                }
            }
        };

        backtrack(0, {});
    });

    return results;
}
