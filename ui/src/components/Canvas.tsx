import { useCallback, useState, useEffect, useRef } from 'react';
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    addEdge,
    BackgroundVariant,
    ConnectionMode,
    MarkerType
} from 'reactflow';
import type { Connection, Edge, Node } from 'reactflow';
import 'reactflow/dist/style.css';

import { DeploymentNode, ContainerNode, InfrastructureNode, PersonNode, SystemNode, ComponentNode } from './Nodes';
import { getPatternById, getPatternByIdAndVersion } from '../lib/registry';
import type { NodeData, DiagramView } from '../types';

const nodeTypes = {
    deploymentNode: DeploymentNode,
    containerNode: ContainerNode,
    infrastructureNode: InfrastructureNode,
    personNode: PersonNode,
    systemNode: SystemNode,
    componentNode: ComponentNode,
};

const getId = () => `node_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

interface Props {
    onNodeSelect: (node: Node<NodeData> | null) => void;
    onEdgeSelect: (edge: Edge | null) => void;
    nodes: Node<NodeData>[];
    edges: Edge[];
    setNodes: any;
    setEdges: any;
    onNodesChange: any;
    onEdgesChange: any;
    patternToAdd?: { type: string, patternId: string, version: string } | null;
    onPatternAdded?: () => void;
    onRevealNode?: (id: string) => void;
    onShowRoleAssignment?: (data: any) => void;
    activeView?: DiagramView;
    selectedNodeId?: string | null;
}

export const CanvasArea: React.FC<Props> = ({ nodes, edges, setNodes, setEdges, onNodesChange, onEdgesChange, onNodeSelect, onEdgeSelect, patternToAdd, onPatternAdded, onRevealNode, selectedNodeId, activeView, onShowRoleAssignment }) => {
    const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
    const draggingEdgeId = useRef<string | null>(null);

    const getAbsolutePosition = useCallback((node: Node) => {
        let x = node.position.x;
        let y = node.position.y;
        let currentParentId = node.parentNode;
        while (currentParentId) {
            const parent = nodes.find(n => n.id === currentParentId);
            if (parent) {
                x += parent.position.x;
                y += parent.position.y;
                currentParentId = parent.parentNode;
            } else {
                break;
            }
        }
        return { x, y };
    }, [nodes]);

    const handleEdgesChange = useCallback((changes: any[]) => {
        let hasInterceptedRemove = false;
        const safeChanges = changes.filter(c => {
            if (c.type === 'remove' && draggingEdgeId.current === c.id) {
                hasInterceptedRemove = true;
                draggingEdgeId.current = null;
                return false;
            }
            return true;
        });
        if (safeChanges.length > 0) onEdgesChange(safeChanges);
        if (hasInterceptedRemove) setEdges((eds: any[]) => [...eds]);
    }, [onEdgesChange, setEdges]);

    const onConnect = useCallback((params: Edge | Connection) => {
        const edge = {
            ...params,
            id: `e-${params.source}-${params.target}-${Date.now()}`,
            animated: false,
            type: 'smoothstep',
            zIndex: 5000,
            markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20, color: '#64748b' },
            style: { strokeWidth: 3, stroke: '#64748b' },
            label: 'Uses',
            labelStyle: { fill: '#475569', fontWeight: 700, fontSize: 11, whiteSpace: 'pre-wrap', textAlign: 'center' as any },
            labelBgStyle: { fill: '#f8fafc', color: '#f8fafc', fillOpacity: 0.9, stroke: '#e2e8f0', strokeWidth: 1 },
            data: { label: 'Uses', technology: '' }
        };
        setEdges((eds: Edge[]) => addEdge(edge, eds));
    }, [setEdges]);

    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const onDrop = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();

            const type = event.dataTransfer.getData('application/reactflow');
            const patternId = event.dataTransfer.getData('application/patternId');
            const version = event.dataTransfer.getData('application/patternVersion');
            const mockTargetId = event.dataTransfer.getData('application/mockTargetId');
            const existingNodeId = event.dataTransfer.getData('application/existingNodeId');
            let isMockTarget = false;

            const scale = window.innerWidth < 768 ? 0.6 : 1;
            const position = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });

            if (existingNodeId) {
                const possibleParents = nodes.filter(n => {
                    if ((n as any).hidden) return false;
                    if (n.type !== 'deploymentNode' && n.type !== 'infrastructureNode') return false;
                    const pos = getAbsolutePosition(n);
                    const width = n.width || (n.style?.width ? Number(n.style.width) : 500);
                    const height = n.height || (n.style?.height ? Number(n.style.height) : 400);
                    return position.x >= pos.x && position.x <= pos.x + width && position.y >= pos.y && position.y <= pos.y + height;
                });
                possibleParents.sort((a, b) => ((a.width || 500) * (a.height || 400)) - ((b.width || 500) * (b.height || 400)));
                const closestParent = possibleParents.length > 0 ? possibleParents[0] : null;

                let cloned = false;
                setNodes((nds: Node[]) => {
                    const srcNode = nds.find(n => n.id === existingNodeId);
                    if (!srcNode) return nds;

                    const isScopedView = !!activeView?.scope_entity_id && (activeView.type === 'Container' || activeView.type === 'Component');
                    const srcIsPhysicalInstance = !!(srcNode.data as any)?.container_id;
                    const shouldForceScopeParent = isScopedView && !srcIsPhysicalInstance && (
                        (activeView?.type === 'Container' && srcNode.data?.c4Level === 'Container') ||
                        (activeView?.type === 'Component' && srcNode.data?.c4Level === 'Component')
                    );

                    const forcedParent = shouldForceScopeParent ? nds.find(n => n.id === activeView!.scope_entity_id) : null;
                    const effectiveParent = forcedParent || closestParent;

                    const parentAbs = effectiveParent ? getAbsolutePosition(effectiveParent) : { x: 0, y: 0 };
                    const newPosition = effectiveParent ? { x: Math.max(20, position.x - parentAbs.x), y: Math.max(20, position.y - parentAbs.y) } : position;

                    if (activeView?.type === 'Deployment' && srcNode.type === 'containerNode') {
                        cloned = true;
                        const instanceNode: Node = {
                            ...srcNode,
                            id: `${srcNode.id}_inst_${getId()}`,
                            position: newPosition,
                            parentNode: effectiveParent ? effectiveParent.id : undefined,
                            extent: effectiveParent ? 'parent' : undefined,
                            zIndex: effectiveParent ? (effectiveParent.zIndex || 0) + 5 : 15,
                            data: {
                                ...srcNode.data,
                                logical_parent_id: srcNode.id
                            }
                        };
                        return [...nds, instanceNode];
                    }

                    let updatedNode: Node | null = null;
                    const remaining = nds.filter(n => {
                        if (n.id === existingNodeId) {
                            updatedNode = {
                                ...n,
                                position: newPosition,
                                parentNode: effectiveParent ? effectiveParent.id : undefined,
                                extent: effectiveParent ? 'parent' : undefined,
                                zIndex: effectiveParent ? (effectiveParent.zIndex || 0) + 5 : 15,
                            };
                            return false;
                        }
                        return true;
                    });
                    return updatedNode ? [...remaining, updatedNode] : remaining;
                });
                if (!cloned && onRevealNode) onRevealNode(existingNodeId);
                return;
            }

            if (typeof type === 'undefined' || !type || !patternId) {
                return;
            }

            const pattern = version ? getPatternByIdAndVersion(patternId, version) : getPatternById(patternId);
            if (!pattern) return;

            const defaultProps: Record<string, any> = {};
            if (pattern.parameters) {
                Object.entries(pattern.parameters).forEach(([key, p]) => {
                    const param = p as any;
                    defaultProps[key] = param.default || param.const || '';
                });
            }

            let nodeType = type;
            if (pattern.c4Level === 'SoftwareSystem') nodeType = 'systemNode';
            if (pattern.c4Level === 'Person') nodeType = 'personNode';
            if (pattern.c4Level === 'Component') nodeType = 'componentNode';

            const newNode: Node<NodeData> = {
                id: getId(),
                type: nodeType,
                position,
                style: nodeType === 'deploymentNode' ? { width: (pattern.default_width || 800) * scale, height: (pattern.default_height || 600) * scale } : undefined,
                data: {
                    label: `${pattern.name} Instance`,
                    widget_ref: `${pattern.id}@${pattern.version}`,
                    c4Level: pattern.c4Level || 'Container',
                    layer: pattern.layer,
                    properties: defaultProps,
                    status: 'new',
                    icon: pattern.display_metadata?.icon,
                    color: pattern.display_metadata?.color,
                    min_width: pattern.min_width,
                    min_height: pattern.min_height,
                    memberships: {},
                    logical_parent_id: (activeView?.scope_entity_id && (pattern.c4Level === 'Container' || pattern.c4Level === 'Component')) ? activeView.scope_entity_id : ((pattern.c4Level === 'Container' || pattern.c4Level === 'Component') ? nodes.find(n => n.type === 'systemNode')?.id : undefined),
                    origin_pattern: pattern.composition ? `${pattern.id}@${pattern.version}` : undefined,
                },
            };

            const possibleParents = nodes.filter(n => {
                if ((n as any).hidden) return false;
                if (n.type !== 'deploymentNode' && n.type !== 'infrastructureNode') return false;
                const pos = getAbsolutePosition(n);
                const nPattern = getPatternById(n.data.widget_ref?.split('@')[0]);
                const width = n.width ?? (n.style?.width ? Number(n.style.width) : (nPattern?.default_width || 500));
                const height = n.height ?? (n.style?.height ? Number(n.style.height) : (nPattern?.default_height || 400));
                return position.x >= pos.x && position.x <= pos.x + width && position.y >= pos.y && position.y <= pos.y + height;
            });

            possibleParents.sort((a, b) => {
                const aPattern = getPatternById(a.data.widget_ref?.split('@')[0]);
                const bPattern = getPatternById(b.data.widget_ref?.split('@')[0]);
                const aArea = (a.width ?? (a.style?.width ? Number(a.style.width) : (aPattern?.default_width || 500))) *
                    (a.height ?? (a.style?.height ? Number(a.style.height) : (aPattern?.default_height || 400)));
                const bArea = (b.width ?? (b.style?.width ? Number(b.style.width) : (bPattern?.default_width || 500))) *
                    (b.height ?? (b.style?.height ? Number(b.style.height) : (bPattern?.default_height || 400)));
                return aArea - bArea;
            });

            let closestParent = possibleParents.length > 0 ? possibleParents[0] : null;
            if (mockTargetId) {
                const targetNode = nodes.find(n => n.id === mockTargetId);
                if (targetNode && (targetNode.type === 'deploymentNode' || targetNode.type === 'infrastructureNode')) {
                    closestParent = targetNode;
                    isMockTarget = true;
                }
            }

            if (pattern.composition) {
                const targetNode = closestParent;
                const isHierarchyParent = targetNode && targetNode.type === 'deploymentNode';
                const isInfraParent = targetNode && targetNode.type === 'infrastructureNode';
                const isContainerView = activeView?.type === 'Container' || activeView?.type === 'Component' || activeView?.type === 'SystemContext';
                const scopedComp = isContainerView ? pattern.composition.container : pattern.composition.deployment;
                const rawMacroNodes = scopedComp?.nodes || (pattern.composition as any).nodes || [];
                const macroEdges = scopedComp?.edges || (pattern.composition as any).edges || [];

                const startExpansion = (role?: string) => {
                    const chosenRole = role;
                    const resolveValue = (path: string, scopeNode: Node<NodeData> | null): any => {
                        if (!path.startsWith('parent.') || !scopeNode || !scopeNode.parentNode) return undefined;
                        const parentNode = nodes.find(n => n.id === scopeNode.parentNode);
                        if (!parentNode) return undefined;
                        const subPath = path.substring(7);
                        if (subPath === 'properties') return parentNode.data.properties;
                        if (subPath.startsWith('properties.')) return parentNode.data.properties[subPath.substring(11)];
                        return undefined;
                    };

                    let anchorMatchFound = false;
                    if (targetNode && rawMacroNodes.length > 0) {
                        anchorMatchFound = rawMacroNodes.some((mNode: any) => {
                            const checkType = (mNode.type === 'deploymentNode') ? 'deploymentNode' : mNode.type;
                            return targetNode.data.widget_ref === mNode.widget_ref &&
                                targetNode.data.layer === mNode.layer &&
                                targetNode.type === checkType;
                        });
                    }

                    let searchParentId = (anchorMatchFound && targetNode) ? targetNode.parentNode : (isHierarchyParent && targetNode ? targetNode.id : ((isInfraParent) && targetNode ? targetNode.parentNode : undefined));
                    if (!searchParentId && activeView?.scope_entity_id && (pattern.c4Level === 'Container' || pattern.c4Level === 'Component')) {
                        searchParentId = activeView.scope_entity_id;
                    }

                    const isParentExtent = !!searchParentId;
                    const generatedNodes: Node<NodeData>[] = [];
                    const generatedEdges: Edge[] = [];
                    const nodeMap: Record<string, string> = {};
                    const mergedNodeMetadata: Record<string, any> = {};
                    const baseX = isParentExtent ? (isMockTarget ? 50 * scale : 50) : position.x - 200;
                    const baseY = isParentExtent ? (isMockTarget ? 80 * scale : 100) : position.y;
                    const expansionId = `exp-${pattern.id}-${Date.now()}`;

                    const processNodesHelper = (nodeList: any[], parentId: string | undefined, depth: number, startX: number, startY: number, extent?: 'parent') => {
                        nodeList.forEach((macroNode: any, index: number) => {
                            let existingNode = null;
                            const checkType = (macroNode.type === 'deploymentNode') ? 'deploymentNode' : macroNode.type;

                            if (depth === 0 && closestParent && macroNode.reuse_existing !== false) {
                                const matchesPattern = closestParent.data.widget_ref === macroNode.widget_ref;
                                const matchesLayer = closestParent.data.layer === macroNode.layer;
                                const matchesType = closestParent.type === checkType;
                                const roleMatch = chosenRole ? macroNode.id_suffix === chosenRole : true;
                                if (matchesPattern && matchesLayer && matchesType && roleMatch) {
                                    existingNode = closestParent;
                                }
                            }

                            if (!existingNode && macroNode.reuse_existing !== false) {
                                existingNode = nodes.find(n =>
                                    n.parentNode === parentId &&
                                    n.data.widget_ref === macroNode.widget_ref &&
                                    n.data.layer === macroNode.layer &&
                                    n.type === checkType
                                );
                            }

                            let currentNodeId: string;
                            if (existingNode) {
                                currentNodeId = existingNode.id;
                                nodeMap[macroNode.id_suffix] = currentNodeId;
                                const existingMemberships = existingNode.data.memberships || {};
                                mergedNodeMetadata[currentNodeId] = {
                                    memberships: { ...existingMemberships, [expansionId]: macroNode.id_suffix },
                                    origin_pattern: `${pattern.id}@${pattern.version}`,
                                    composition_alias: macroNode.id_suffix,
                                    composition_id: expansionId,
                                    status: 'existing'
                                };
                                const logicalRootId = (existingNode.data as any)?.logical_parent_id;
                                if (activeView?.type === 'Deployment' && logicalRootId && logicalRootId !== currentNodeId) {
                                    const logicalRoot = nodes.find(n => n.id === logicalRootId);
                                    if (logicalRoot && logicalRoot.type === 'containerNode') {
                                        const logicalExistingMemberships = (logicalRoot.data as any)?.memberships || {};
                                        const previouslyQueued = mergedNodeMetadata[logicalRootId]?.memberships || {};
                                        mergedNodeMetadata[logicalRootId] = {
                                            ...mergedNodeMetadata[logicalRootId],
                                            memberships: { ...logicalExistingMemberships, ...previouslyQueued, [expansionId]: macroNode.id_suffix }
                                        };
                                    }
                                }
                            } else {
                                currentNodeId = getId();
                                nodeMap[macroNode.id_suffix] = currentNodeId;
                                let offsetX = (macroNode.layout_hint?.x ?? (index * 220)) * scale;
                                let offsetY = (macroNode.layout_hint?.y ?? (depth * 150)) * scale;
                                const nPattern = macroNode.widget_ref ? getPatternById(macroNode.widget_ref.split('@')[0]) : null;

                                const gNode: Node<NodeData> = {
                                    id: currentNodeId,
                                    type: checkType,
                                    position: { x: startX + offsetX, y: startY + offsetY },
                                    style: (checkType === 'deploymentNode') ? { width: (nPattern?.default_width || 500) * scale, height: (nPattern?.default_height || 400) * scale } : undefined,
                                    parentNode: parentId,
                                    extent: extent,
                                    zIndex: 10 + depth,
                                    data: {
                                        label: macroNode.label || macroNode.id_suffix,
                                        widget_ref: macroNode.widget_ref,
                                        c4Level: macroNode.c4Level,
                                        layer: macroNode.layer,
                                        properties: macroNode.properties ? { ...macroNode.properties } : {},
                                        status: 'new',
                                        icon: nPattern?.display_metadata?.icon,
                                        color: nPattern?.display_metadata?.color,
                                        min_width: nPattern?.min_width,
                                        min_height: nPattern?.min_height,
                                        origin_pattern: `${pattern.id}@${pattern.version}`,
                                        composition_alias: macroNode.id_suffix,
                                        composition_id: expansionId,
                                        memberships: { [expansionId]: macroNode.id_suffix },
                                        logical_parent_id: (activeView?.scope_entity_id && (macroNode.c4Level === 'Container' || macroNode.c4Level === 'Component')) ? activeView.scope_entity_id : ((macroNode.c4Level === 'Container' || macroNode.c4Level === 'Component') ? nodes.find(n => n.type === 'systemNode')?.id : undefined),
                                    }
                                };
                                if (macroNode.property_mappings) {
                                    Object.entries(macroNode.property_mappings).forEach(([targetProp, sourcePath]) => {
                                        const val = resolveValue(sourcePath as string, gNode);
                                        if (val !== undefined) gNode.data.properties[targetProp] = val;
                                    });
                                }
                                generatedNodes.push(gNode);
                            }

                            if (macroNode.children && macroNode.children.length > 0) {
                                processNodesHelper(macroNode.children, currentNodeId, depth + 1, 0, 0, 'parent');
                            }
                        });
                    };

                    processNodesHelper(rawMacroNodes, searchParentId, 0, baseX, baseY, isParentExtent ? 'parent' : undefined);

                    macroEdges.forEach((macroEdge: any) => {
                        const sourceId = nodeMap[macroEdge.source_suffix];
                        const targetId = nodeMap[macroEdge.target_suffix];
                        const edgeId = `e-${sourceId}-${targetId}`;
                        if (sourceId && targetId && !edges.some(e => e.id === edgeId)) {
                            const isAnimated = macroEdge.styleVariant === 'animated';
                            const baseEdgeStyle: any = { strokeWidth: 3, stroke: '#64748b', ...macroEdge.style };
                            if (macroEdge.styleVariant === 'dashed') {
                                baseEdgeStyle.strokeDasharray = '5, 5';
                                baseEdgeStyle.strokeLinecap = 'square';
                            } else if (macroEdge.styleVariant === 'dotted') {
                                baseEdgeStyle.strokeDasharray = '2, 5';
                                baseEdgeStyle.strokeLinecap = 'round';
                            }
                            const direction = macroEdge.direction || 'forward';
                            const drawMarker = { type: MarkerType.ArrowClosed, width: 20, height: 20, color: baseEdgeStyle.stroke || '#64748b' };
                            let mStart = undefined; let mEnd = undefined;
                            if (direction === 'forward') mEnd = drawMarker;
                            if (direction === 'reverse') mStart = drawMarker;
                            if (direction === 'both') { mStart = drawMarker; mEnd = drawMarker; }
                            let displayLabel = macroEdge.label;
                            if (displayLabel && macroEdge.technology) displayLabel = `${displayLabel}\n[${macroEdge.technology}]`;

                            generatedEdges.push({
                                id: edgeId, source: sourceId, target: targetId,
                                sourceHandle: macroEdge.source_handle || 'source-right',
                                targetHandle: macroEdge.target_handle || 'target-left',
                                animated: isAnimated, type: 'smoothstep', zIndex: 5000,
                                markerStart: mStart, markerEnd: mEnd,
                                data: { label: macroEdge.label || 'Uses', technology: macroEdge.technology || '', direction: direction, styleVariant: macroEdge.styleVariant || 'solid' },
                                label: displayLabel,
                                labelStyle: { fill: '#475569', fontWeight: 700, fontSize: 11, whiteSpace: 'pre-wrap', textAlign: 'center' as any },
                                labelBgStyle: { fill: '#f8fafc', color: '#f8fafc', fillOpacity: 0.9, stroke: '#e2e8f0', strokeWidth: 1 },
                                style: baseEdgeStyle
                            });
                        }
                    });

                    newNode.data.composition_id = expansionId;
                    if (pattern.composition?.workload_target_suffix) {
                        const targetHostId = nodeMap[pattern.composition.workload_target_suffix];
                        if (targetHostId) {
                            newNode.parentNode = targetHostId; newNode.extent = 'parent'; newNode.position = { x: 50, y: 80 }; newNode.zIndex = 20;
                            generatedNodes.push(newNode);
                        }
                    }

                    setNodes((nds: Node[]) => {
                        const updated = nds.map(n => mergedNodeMetadata[n.id] ? { ...n, data: { ...n.data, ...mergedNodeMetadata[n.id] } } : n);
                        return [...updated, ...generatedNodes];
                    });
                    if (generatedEdges.length > 0) setEdges((eds: Edge[]) => eds.concat(generatedEdges));
                };

                if (targetNode && targetNode.type === 'containerNode') {
                    const matches = rawMacroNodes.filter((m: any) => m.widget_ref === targetNode.data.widget_ref && m.type === 'containerNode');
                    if (matches.length > 1) {
                        const roles = matches.map((m: any) => m.id_suffix);
                        if (onShowRoleAssignment) {
                            onShowRoleAssignment({
                                isOpen: true, roles, patternName: pattern.name,
                                onCancel: () => onShowRoleAssignment(null),
                                onSelect: (role: string) => { startExpansion(role); onShowRoleAssignment(null); }
                            });
                            return;
                        } else {
                            const roleNames = roles.join(', ');
                            const chosenRole = window.prompt(`This container matches multiple roles in the pattern (${roleNames}). Which role should it assume?`, matches[0].id_suffix);
                            if (chosenRole) startExpansion(chosenRole);
                            return;
                        }
                    } else if (matches.length === 1) {
                        startExpansion(matches[0].id_suffix);
                    } else {
                        startExpansion();
                    }
                } else {
                    startExpansion();
                }
                return;
            }

            const scopedParentId = activeView?.scope_entity_id;
            const c4 = pattern.c4Level as string;
            if (c4 === 'SoftwareSystem' || c4 === 'Person') {
                newNode.zIndex = 5;
            } else if (scopedParentId && (c4 === 'Container' || c4 === 'Component')) {
                const systemNodeObj = nodes.find(n => n.id === scopedParentId);
                const parentAbs = systemNodeObj ? getAbsolutePosition(systemNodeObj) : { x: 0, y: 0 };
                newNode.parentNode = scopedParentId; newNode.extent = 'parent'; newNode.zIndex = (systemNodeObj?.zIndex || 5) + 5;
                if (isMockTarget) { newNode.position = { x: 50 * scale, y: 80 * scale }; }
                else { newNode.position = { x: position.x - parentAbs.x, y: position.y - parentAbs.y }; }
            } else if (closestParent && (closestParent.type === 'deploymentNode' || closestParent.type === 'infrastructureNode')) {
                const parentAbs = getAbsolutePosition(closestParent);
                newNode.parentNode = closestParent.id; newNode.extent = 'parent'; newNode.zIndex = (closestParent.zIndex || 5) + 5;
                if (isMockTarget) { newNode.position = { x: 50 * scale, y: 80 * scale }; }
                else { newNode.position = { x: position.x - parentAbs.x, y: position.y - parentAbs.y }; }
            } else if (type === 'containerNode') {
                alert(`Governance Violation: A ${pattern.name} must be placed inside a valid Infrastructure Host or System Scope.`);
                return;
            } else if (type === 'deploymentNode') {
                newNode.zIndex = 5;
            }

            setNodes((nds: Node[]) => nds.concat(newNode));
        },
        [reactFlowInstance, setNodes, nodes, activeView, onRevealNode, onShowRoleAssignment, getAbsolutePosition]
    );

    useEffect(() => {
        if (patternToAdd && reactFlowInstance) {
            const mockEvent: any = {
                preventDefault: () => { },
                clientX: window.innerWidth / 2,
                clientY: window.innerHeight / 2,
                dataTransfer: {
                    dropEffect: 'move',
                    getData: (key: string) => {
                        if (key === 'application/reactflow') return patternToAdd.type;
                        if (key === 'application/patternId') return patternToAdd.patternId;
                        if (key === 'application/patternVersion') return patternToAdd.version;
                        if (key === 'application/mockTargetId') return selectedNodeId || '';
                        return '';
                    }
                }
            };
            onDrop(mockEvent);
            onPatternAdded?.();
        }
    }, [patternToAdd, reactFlowInstance, onDrop, onPatternAdded, selectedNodeId]);

    return (
        <div className="flex-1 h-full relative">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onNodeDragStop={(event, node) => {
                    if (node.type === 'deploymentNode' || node.type === 'infrastructureNode') return;
                    const isComponentScopeBoundary = activeView?.type === 'Component' && activeView.scope_entity_id === node.id;
                    const flowPos = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
                    const isScoped = !!activeView?.scope_entity_id && (activeView.type === 'Container' || activeView.type === 'Component');
                    const allowScopedParent = isScoped && !(node.data as any)?.container_id && (
                        (activeView?.type === 'Container' && node.data?.c4Level === 'Container') ||
                        (activeView?.type === 'Component' && node.data?.c4Level === 'Component')
                    );

                    const possibleParents = nodes.filter(n => {
                        if ((n as any).hidden) return false;
                        if (n.id === node.id) return false;
                        if (allowScopedParent && n.id === activeView!.scope_entity_id) {
                            const pos = getAbsolutePosition(n);
                            const width = n.width || (n.style?.width ? Number(n.style.width) : 1000);
                            const height = n.height || (n.style?.height ? Number(n.style.height) : 800);
                            return flowPos.x >= pos.x && flowPos.x <= pos.x + width && flowPos.y >= pos.y && flowPos.y <= pos.y + height;
                        }
                        if (n.type !== 'deploymentNode' && n.type !== 'infrastructureNode') return false;
                        const pos = getAbsolutePosition(n);
                        const width = n.width || (n.style?.width ? Number(n.style.width) : 500);
                        const height = n.height || (n.style?.height ? Number(n.style.height) : 400);
                        return flowPos.x >= pos.x && flowPos.x <= pos.x + width && flowPos.y >= pos.y && flowPos.y <= pos.y + height;
                    });
                    possibleParents.sort((a, b) => ((a.width || 500) * (a.height || 400)) - ((b.width || 500) * (b.height || 400)));
                    const closestParent = possibleParents.length > 0 ? possibleParents[0] : null;

                    if (isComponentScopeBoundary) return;

                    if (closestParent && closestParent.id !== node.parentNode) {
                        setNodes((nds: Node[]) => {
                            let updatedNode: Node | null = null;
                            const remaining = nds.filter(n => {
                                if (n.id === node.id) {
                                    updatedNode = {
                                        ...n,
                                        position: { x: Math.max(20, flowPos.x - getAbsolutePosition(closestParent).x), y: Math.max(20, flowPos.y - getAbsolutePosition(closestParent).y) },
                                        parentNode: closestParent.id,
                                        extent: 'parent',
                                        zIndex: (closestParent.zIndex || 0) + 5,
                                    };
                                    return false;
                                }
                                return true;
                            });
                            return updatedNode ? [...remaining, updatedNode] : remaining;
                        });
                    } else if (!closestParent && node.parentNode) {
                        if (allowScopedParent) {
                            const scopeNode = nodes.find(n => n.id === activeView!.scope_entity_id);
                            if (scopeNode) {
                                setNodes((nds: Node[]) => {
                                    let updatedNode: Node | null = null;
                                    const remaining = nds.filter(n => {
                                        if (n.id === node.id) {
                                            updatedNode = {
                                                ...n,
                                                position: { x: Math.max(20, flowPos.x - getAbsolutePosition(scopeNode).x), y: Math.max(20, flowPos.y - getAbsolutePosition(scopeNode).y) },
                                                parentNode: scopeNode.id,
                                                extent: 'parent',
                                                zIndex: (scopeNode.zIndex || 0) + 5,
                                            };
                                            return false;
                                        }
                                        return true;
                                    });
                                    return updatedNode ? [...remaining, updatedNode] : remaining;
                                });
                                return;
                            }
                        }
                        setNodes((nds: Node[]) => {
                            let updatedNode: Node | null = null;
                            const remaining = nds.filter(n => {
                                if (n.id === node.id) {
                                    updatedNode = { ...n, position: flowPos, parentNode: undefined, extent: undefined, zIndex: 15 };
                                    return false;
                                }
                                return true;
                            });
                            return updatedNode ? [...remaining, updatedNode] : remaining;
                        });
                    }
                }}
                onEdgesChange={handleEdgesChange}
                onEdgeUpdateStart={(_, e) => { draggingEdgeId.current = e.id; }}
                onEdgeUpdateEnd={() => { setTimeout(() => { draggingEdgeId.current = null; }, 500); }}
                onEdgeUpdate={(oldEdge, newConnection) => {
                    draggingEdgeId.current = null;
                    setEdges((prevEdges: any[]) => prevEdges.map(edge => {
                        const targetIds = oldEdge.id.startsWith('rollup-') ? (oldEdge.data?._underlyingEdgeIds || []) : [oldEdge.id];
                        if (targetIds.includes(edge.id)) {
                            const updated = { ...edge };
                            if (oldEdge.source !== newConnection.source || oldEdge.sourceHandle !== newConnection.sourceHandle) {
                                updated.source = newConnection.source;
                                updated.sourceHandle = newConnection.sourceHandle || undefined;
                            }
                            if (oldEdge.target !== newConnection.target || oldEdge.targetHandle !== newConnection.targetHandle) {
                                updated.target = newConnection.target;
                                updated.targetHandle = newConnection.targetHandle || undefined;
                            }
                            return updated;
                        }
                        return edge;
                    }));
                }}
                onConnect={onConnect}
                onInit={setReactFlowInstance}
                onDrop={onDrop}
                onDragOver={onDragOver}
                nodeTypes={nodeTypes}
                elevateNodesOnSelect={false}
                elevateEdgesOnSelect={true}
                connectionMode={ConnectionMode.Loose}
                connectionRadius={80}
                defaultEdgeOptions={{ zIndex: 5000, style: { strokeWidth: 3, stroke: '#64748b' } }}
                onNodeClick={(_, node) => onNodeSelect(node)}
                onEdgeClick={(_, edge) => onEdgeSelect(edge)}
                onPaneClick={() => { onNodeSelect(null); onEdgeSelect(null); }}
                fitView
                className="bg-slate-50"
            >
                <Background variant={BackgroundVariant.Lines} color="#e2e8f0" gap={24} />
                <Controls />
                <MiniMap className="hidden md:block" />
            </ReactFlow>
        </div>
    );
};
