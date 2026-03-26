import type { Registry } from '../types';

// DiscoveryResult tracks what pattern the algorithm discovered and which nodes map to its required aliases
export interface DiscoveryResult {
    detectorId: string;
    detectorName: string;
    targetPattern: string;    // The pattern this discovery maps to (e.g. batch-workload-ocp@1.0.0)
    matchedNodes: Record<string, any>; // How the detected nodes map to the pattern's node aliases
}

/**
 * Core Pattern Auto-Detection Engine
 * This engine takes the flat canvas/diagram representation (arch) and evaluates it against
 * a set of 'detector' rules (from detectors.yaml). 
 * If a detector's node and relationship conditions are met by free-floating or generic elements
 * on the canvas, it returns a DiscoveryResult allowing those nodes to be governed by the standard pattern.
 */
export function detectPatterns(arch: any, registry: Registry): DiscoveryResult[] {
    const detectors = registry.detectors || [];
    if (!detectors.length) return [];

    const flatDeployments: any[] = [];
    const containerMap: Record<string, any> = {};
    const cNodes = arch.model?.containers || [];

    // 1. Build a quick lookup map of containers
    cNodes.forEach((cn: any) => { containerMap[cn.id] = cn; });
    (arch.model?.softwareSystems || []).forEach((s: any) => {
        (s.containers || []).forEach((cn: any) => { containerMap[cn.id] = cn; });
    });

    // 2. Parse the hierarchical Deployment Nodes into a flat Abstract Syntax Tree (AST)
    // This makes it easy to traverse parent-child relationships via `parentId`
    const parseTree = (nodes: any[], parentId: string | null) => {
        nodes.forEach(dn => {
            // Push the deployment node itself (Cluster, Datacenter, Region, etc)
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
            if (dn.infrastructureNodes) {
                dn.infrastructureNodes.forEach((infra: any) => {
                    flatDeployments.push({
                        ...infra,
                        type: 'InfrastructureNode',
                        c4Level: 'InfrastructureNode',
                        parentId: dn.id
                    });
                });
            }
            if (dn.nodes) parseTree(dn.nodes, dn.id);
        });
    };
    parseTree(arch.deployment?.nodes || [], null);

    // 2.5 Ensure purely logical models not explicitly wrapped in boundary deployments are still fully detectable!
    const sNodes = arch.model?.softwareSystems || [];
    const pNodes = arch.model?.people || [];

    sNodes.forEach((s: any) => {
        flatDeployments.push({ ...s, type: 'SoftwareSystem', c4Level: 'SoftwareSystem' });
        (s.containers || []).forEach((c: any) => {
            flatDeployments.push({ ...c, type: 'Container', c4Level: 'Container', parentId: s.id });
            (c.components || []).forEach((cmp: any) => {
                flatDeployments.push({ ...cmp, type: 'Component', c4Level: 'Component', parentId: c.id });
            });
        });
    });

    cNodes.forEach((c: any) => {
        flatDeployments.push({ ...c, type: 'Container', c4Level: 'Container' });
        (c.components || []).forEach((cmp: any) => {
            flatDeployments.push({ ...cmp, type: 'Component', c4Level: 'Component', parentId: c.id });
        });
    });

    pNodes.forEach((p: any) => flatDeployments.push({ ...p, type: 'Person', c4Level: 'Person' }));

    // Deduplicate structurally
    const uniqueDeployments = Array.from(new Map(flatDeployments.map(item => [item.id, item])).values());
    flatDeployments.length = 0;
    flatDeployments.push(...uniqueDeployments);

    // 3. Build Adjacency List for 'connects_to' generic relationship searches
    // Enables O(1) lookups for line connections between nodes
    const adjList: Record<string, string[]> = {};
    const rels = arch.model?.relationships || [];
    rels.forEach((rel: any) => {
        if (rel.sourceId && rel.destinationId) {
            if (!adjList[rel.sourceId]) adjList[rel.sourceId] = [];
            adjList[rel.sourceId].push(rel.destinationId);
        }
    });

    // Helper to determine if a node is geometrically placed inside another node
    const isDescendant = (childId: string, possibleParentId: string): boolean => {
        let curr = flatDeployments.find(n => n.id === childId);
        while (curr && curr.parentId) {
            if (curr.parentId === possibleParentId) return true;
            curr = flatDeployments.find(n => n.id === curr.parentId || n.logicalId === curr.parentId);
        }
        return false;
    };

    const results: DiscoveryResult[] = [];

    // 4. Run the Engine! Evaluate each detector rule against the canvas.
    detectors.forEach(detector => {
        const nodeMatchConds = detector.conditions.filter((c: any) => c.node_match);
        const relConds = detector.conditions.filter((c: any) => c.relationship);

        // a. Candidate Selection
        // For each required alias (e.g. 'workload', 'cluster'), find ALL nodes on the canvas that fit the rule.
        const aliasCandidates: Record<string, any[]> = {};
        for (const cond of nodeMatchConds) {
            const rules = cond.node_match;
            const alias = rules.alias;
            aliasCandidates[alias] = flatDeployments.filter(n => {
                // If this node is physically governed by THIS specific pattern officially in its current topological location, don't re-detect it.
                // We only want to detect loosely deployed replica components or ungoverned instances sitting outside of their declared macro-boundaries!
                if (n.properties?.origin_pattern === detector.target_pattern) {
                    if (n.isInstance) {
                        const getMemberships = (n: any) => n.properties?.memberships || n.memberships || {};

                        // First check: for purely logical patterns (e.g. point-to-point messaging)
                        // that don't have deployment hierarchy representation, check if the node's own
                        // memberships link it to an expansion that's purely logical (no deployment node owns it).
                        const nMem = getMemberships(n);
                        const nExpIds = Object.keys(nMem);
                        const nPrime = n.properties?.composition_id || n.composition_id;
                        if (nPrime) nExpIds.push(nPrime);

                        const logicallyGoverned = nExpIds.some(expId => {
                            // Check if this expansion ID exists on ANY deployment/infrastructure node
                            const hasDeploymentPresence = flatDeployments.some(d =>
                                (d.type === 'DeploymentNode' || d.type === 'InfrastructureNode' ||
                                    d.c4Level === 'DeploymentNode' || d.c4Level === 'InfrastructureNode') &&
                                (d.properties?.composition_id === expId || d.composition_id === expId ||
                                    (getMemberships(d))[expId])
                            );
                            // Only use logical governance for expansions with NO deployment presence
                            if (hasDeploymentPresence) return false;

                            // Check if any other node shares this expansion and has matching origin_pattern
                            return flatDeployments.some(other =>
                                other.id !== n.id &&
                                (other.properties?.origin_pattern === detector.target_pattern) &&
                                (other.properties?.composition_id === expId || other.composition_id === expId ||
                                    (getMemberships(other))[expId])
                            );
                        });
                        if (logicallyGoverned) return false;

                        // Second check: walk deployment hierarchy for infrastructure-level pattern governance
                        let currentP = flatDeployments.find(p => p.id === n.parentId);
                        let physicallyGoverned = false;
                        while (currentP) {
                            const pMem = getMemberships(currentP);
                            const pPrime = currentP.properties?.composition_id || currentP.composition_id;

                            // Check if the current parent container structurally participates in ANY of this node's declared composition instances
                            const nMemInner = getMemberships(n);
                            const nPrimeInner = n.properties?.composition_id || n.composition_id;
                            const nIds = new Set(Object.keys(nMemInner));
                            if (nPrimeInner) nIds.add(nPrimeInner);

                            if (nIds.has(pPrime) || Array.from(nIds).some(id => pMem[id])) {
                                physicallyGoverned = true;
                                break;
                            }
                            currentP = flatDeployments.find(p => p.id === currentP.parentId);
                        }

                        if (physicallyGoverned) return false;
                    } else {
                        // For logical containers natively placed directly on the root canvas (no bounded deployment) we assume default governance block
                        return false;
                    }
                }

                // Match C4 Level if specified
                if (rules.c4Level && n.c4Level !== rules.c4Level && n.type !== rules.c4Level) return false;

                // Match specific blueprint reference if requested (e.g. 'batch-container' widget)
                if (rules.widget_ref) {
                    const id = n.properties?.widget_ref?.split('@')[0] || n.widget_ref?.split('@')[0];
                    if (id !== rules.widget_ref) {
                        // Traverse structural polymorphism mapping (class hierarchy extensions) recursively unlimited hops natively
                        let isMatch = false;
                        let currId = id;
                        while (currId) {
                            const pNode = registry.patterns.find(p => p.id === currId);
                            if (!pNode) break;
                            if (pNode.id === rules.widget_ref || pNode.base_type === rules.widget_ref) {
                                isMatch = true;
                                break;
                            }
                            currId = pNode.base_type;
                        }
                        if (!isMatch) return false;
                    }
                }

                // Flexible regex matching for wild-west brownfield discovery
                if (rules.name_regex) {
                    const rx = new RegExp(rules.name_regex, 'i');
                    if (!rx.test(n.name || '')) return false;
                }
                return true;
            });
            if (aliasCandidates[alias].length === 0) {
                console.error('Detector completely missing alias:', detector.id, alias);
                return;
            }
        }

        const aliases = Object.keys(aliasCandidates);

        // b. Combinatorial Backtracking Algorithm (Subgraph Isomorphism Search)
        // Since there might be multiple 'clusters' and multiple 'workloads', we have to
        // test every combination to see if they specifically connect in the way the pattern demands.
        const backtrack = (idx: number, currentCombo: Record<string, any>) => {
            if (idx === aliases.length) {
                // We have a full candidate set (e.g. 1 gw, 1 lb, 1 api, 1 cluster).
                // Now test relationships!
                let valid = true;
                for (const cond of relConds) {
                    const r = cond.relationship;
                    const src = currentCombo[r.source];
                    const tgt = currentCombo[r.target];
                    if (!src || !tgt) { valid = false; break; }

                    if (r.type === 'hosted_on') {
                        // Is the source physically inside the target container?
                        if (!isDescendant(src.id, tgt.id)) valid = false;
                    } else if (r.type === 'connects_to') {
                        // Is there a line drawn from source to target?
                        const sId = src.logicalId || src.id;
                        const tId = tgt.logicalId || tgt.id;
                        if (!adjList[sId] || !adjList[sId].includes(tId)) valid = false;
                    }
                }
                if (valid) {
                    // Success! Check if identical combo already pushed (deduplication)
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
