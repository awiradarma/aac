import { useCallback, useState, useEffect } from 'react';
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

let id = 0;
const getId = () => `node_${id++}`;

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
    activeView?: DiagramView;
    selectedNodeId?: string | null;
}

export const CanvasArea: React.FC<Props> = ({ nodes, edges, setNodes, setEdges, onNodesChange, onEdgesChange, onNodeSelect, onEdgeSelect, patternToAdd, onPatternAdded, selectedNodeId, activeView }) => {
    const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

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
            let isMockTarget = false;

            if (typeof type === 'undefined' || !type || !patternId) {
                return;
            }

            const pattern = version ? getPatternByIdAndVersion(patternId, version) : getPatternById(patternId);
            if (!pattern) return;

            const position = reactFlowInstance.screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });

            // Default properties based on the pattern parameters
            const defaultProps: Record<string, any> = {};
            if (pattern.parameters) {
                Object.entries(pattern.parameters).forEach(([key, p]) => {
                    const param = p as any;
                    defaultProps[key] = param.default || param.const || '';
                });
            }

            const scale = window.innerWidth < 768 ? 0.6 : 1;

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
                    c4Level: pattern.c4Level,
                    layer: pattern.layer,
                    properties: defaultProps,
                    status: 'new',
                    icon: pattern.display_metadata?.icon,
                    color: pattern.display_metadata?.color,
                    min_width: pattern.min_width,
                    min_height: pattern.min_height,
                    memberships: {},
                    logical_parent_id: (activeView?.scope_entity_id && (pattern.c4Level === 'Container' || pattern.c4Level === 'Component')) ? activeView.scope_entity_id : undefined,
                },
            };

            const getAbsolutePosition = (node: Node) => {
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
            };

            // Generic bounding-box hit detection for infinite hierarchy depth
            const possibleParents = nodes.filter(n => {
                // Hierarchies and Hosts are containers. Infrastructure nodes can be drop targets for macro merging.
                if (n.type !== 'deploymentNode' && n.type !== 'deploymentNode' && n.type !== 'infrastructureNode') return false;
                const pos = getAbsolutePosition(n);
                const nPattern = getPatternById(n.data.widget_ref?.split('@')[0]);
                const width = n.width ?? (n.style?.width ? Number(n.style.width) : (nPattern?.default_width || 500));
                const height = n.height ?? (n.style?.height ? Number(n.style.height) : (nPattern?.default_height || 400));

                return position.x >= pos.x && position.x <= pos.x + width &&
                    position.y >= pos.y && position.y <= pos.y + height;
            });

            // The closest parent mathematically is the one with the smallest area (deepest nest)
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
                if (targetNode && (targetNode.type === 'deploymentNode' || targetNode.type === 'deploymentNode' || targetNode.type === 'infrastructureNode')) {
                    closestParent = targetNode;
                    isMockTarget = true;
                }
            }

            // =========================================================================================
            // DYNAMIC MACRO EXPANSION ENGINE
            // =========================================================================================
            // When a governed pattern is dropped onto the canvas, it isn't just one node. It's a "macro" 
            // that expands out into multiple required infrastructure components.
            // This function recursively parses `pattern.composition.nodes` and creates literal Canvas nodes, 
            // correctly sizing, placing, and wiring lines between them.
            if (pattern.composition) {
                const targetNode = closestParent;
                const isHierarchyParent = targetNode && targetNode.type === 'deploymentNode';
                const isHostParent = targetNode && targetNode.type === 'deploymentNode';
                const isInfraParent = targetNode && targetNode.type === 'infrastructureNode';

                // Helper to resolve generic property mappings
                const resolveValue = (path: string, scopeNode: Node<NodeData> | null): any => {
                    if (!path.startsWith('parent.') || !scopeNode || !scopeNode.parentNode) return undefined;
                    const parentNode = nodes.find(n => n.id === scopeNode.parentNode);
                    if (!parentNode) return undefined;

                    const subPath = path.substring(7); // skip 'parent.'
                    if (subPath === 'properties') return parentNode.data.properties;
                    if (subPath.startsWith('properties.')) {
                        return parentNode.data.properties[subPath.substring(11)];
                    }
                    if (subPath.startsWith('parent.')) {
                        return resolveValue(subPath, parentNode);
                    }
                    return undefined;
                };

                // 1. Determine if we are merging the macro anchor with the drop target to correctly set the scope for siblings
                let anchorMatchFound = false;
                if (targetNode && pattern.composition.nodes) {
                    anchorMatchFound = pattern.composition.nodes.some((mNode: any) => {
                        const checkType = (mNode.type === 'deploymentNode' || mNode.type === 'deploymentNode' || mNode.type === 'deploymentNode') ? 'deploymentNode' : mNode.type;
                        return targetNode.data.widget_ref === mNode.widget_ref &&
                            targetNode.data.layer === mNode.layer &&
                            targetNode.type === checkType;
                    });
                }

                // If dropping on a matching anchor (e.g. cluster), use that anchor's parent for all other nodes in the macro
                // If dropping on a container without a match (e.g. datacenter), then it's a child.
                let searchParentId = (anchorMatchFound && targetNode) ? targetNode.parentNode : (isHierarchyParent && targetNode ? targetNode.id : ((isHostParent || isInfraParent) && targetNode ? targetNode.parentNode : undefined));

                // If dropping a container-level macro on a scoped container view, hook it into the system boundary natively
                if (!searchParentId && activeView?.scope_entity_id && (pattern.c4Level === 'Container' || pattern.c4Level === 'Component')) {
                    searchParentId = activeView.scope_entity_id;
                }

                const isParentExtent = !!searchParentId;

                const generatedNodes: Node<NodeData>[] = [];
                const generatedEdges: Edge[] = [];
                const nodeMap: Record<string, string> = {}; // maps suffix to generated id
                const mergedNodeMetadata: Record<string, any> = {}; // Track metadata for existing nodes being 'pAdopted'

                // Base positions relative to parent or canvas
                const baseX = isParentExtent ? (isMockTarget ? 50 * scale : 50) : position.x - 200;
                const baseY = isParentExtent ? (isMockTarget ? 80 * scale : 100) : position.y;
                const expansionId = `exp-${pattern.id}-${Date.now()}`;

                const processNodes = (nodeList: any[], parentId: string | undefined, depth: number, startX: number, startY: number, extent?: 'parent') => {
                    nodeList.forEach((macroNode: any, index: number) => {
                        let existingNode = null;
                        const checkType = (macroNode.type === 'deploymentNode' || macroNode.type === 'deploymentNode' || macroNode.type === 'deploymentNode') ? 'deploymentNode' : macroNode.type;

                        // Priority 1: Direct match with the node we actually dropped on
                        if (depth === 0 && closestParent && macroNode.reuse_existing !== false) {
                            const matchesPattern = closestParent.data.widget_ref === macroNode.widget_ref;
                            const matchesLayer = closestParent.data.layer === macroNode.layer;
                            const matchesType = closestParent.type === checkType;
                            if (matchesPattern && matchesLayer && matchesType) {
                                existingNode = closestParent;
                            }
                        }

                        // Priority 2: Generic search in the parent scope
                        if (!existingNode && macroNode.reuse_existing !== false) {
                            if (parentId) {
                                existingNode = nodes.find(n =>
                                    n.parentNode === parentId &&
                                    n.data.widget_ref === macroNode.widget_ref &&
                                    n.data.layer === macroNode.layer &&
                                    n.type === checkType
                                );
                            } else {
                                existingNode = nodes.find(n =>
                                    !n.parentNode &&
                                    n.data.widget_ref === macroNode.widget_ref &&
                                    n.data.layer === macroNode.layer &&
                                    n.type === checkType
                                );
                            }
                        }

                        let currentNodeId: string;

                        if (existingNode) {
                            // Merge: node already exists in this scope
                            currentNodeId = existingNode.id;
                            nodeMap[macroNode.id_suffix] = currentNodeId;

                            // Track membership for existing node without overwriting primary master
                            const existingMemberships = existingNode.data.memberships || {};
                            mergedNodeMetadata[currentNodeId] = {
                                memberships: {
                                    ...existingMemberships,
                                    [expansionId]: macroNode.id_suffix
                                },
                                status: 'existing'
                            };
                        } else {
                            currentNodeId = getId();
                            nodeMap[macroNode.id_suffix] = currentNodeId;

                            // Use layout hint if provided, else fallback to simple auto-layout
                            let offsetX = (macroNode.layout_hint?.x ?? 0) * scale;
                            let offsetY = (macroNode.layout_hint?.y ?? 0) * scale;

                            if (!macroNode.layout_hint) {
                                if (depth === 0) {
                                    offsetX = index * 450 * scale;
                                } else {
                                    offsetX = (50 + (index * 450)) * scale;
                                    offsetY = 80 * scale;
                                }
                            }

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
                                    label: macroNode.label,
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
                                    memberships: {
                                        [expansionId]: macroNode.id_suffix
                                    },
                                    logical_parent_id: (activeView?.scope_entity_id && (macroNode.c4Level === 'Container' || macroNode.c4Level === 'Component')) ? activeView.scope_entity_id : undefined,
                                }
                            };

                            // Apply generic property mappings from pattern
                            if (macroNode.property_mappings) {
                                Object.entries(macroNode.property_mappings).forEach(([targetProp, sourcePath]) => {
                                    const val = resolveValue(sourcePath as string, gNode);
                                    if (val !== undefined) {
                                        gNode.data.properties[targetProp] = val;
                                    }
                                });
                            }

                            // Deprecated hardcoded mapping (kept for safety until all patterns updated)
                            if (isParentExtent && macroNode.layer === 'Cluster' && targetNode?.data.properties?.dc_id && !macroNode.property_mappings) {
                                gNode.data.properties.datacenter_id = targetNode.data.properties.dc_id;
                                gNode.data.properties.region = '';
                            }

                            generatedNodes.push(gNode);
                        }

                        if (macroNode.children && macroNode.children.length > 0) {
                            processNodes(macroNode.children, currentNodeId, depth + 1, 0, 0, 'parent');
                        }
                    });
                };

                // 1. Generate Nodes recursively
                if (pattern.composition.nodes) {
                    processNodes(pattern.composition.nodes, searchParentId, 0, baseX, baseY, isParentExtent ? 'parent' : undefined);
                }

                // 2. Generate Edges
                if (pattern.composition.edges) {
                    pattern.composition.edges.forEach((macroEdge: any) => {
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

                            let mStart = undefined;
                            let mEnd = undefined;
                            if (direction === 'forward') mEnd = drawMarker;
                            if (direction === 'reverse') mStart = drawMarker;
                            if (direction === 'both') {
                                mStart = drawMarker;
                                mEnd = drawMarker;
                            }

                            let displayLabel = macroEdge.label;
                            if (displayLabel && macroEdge.technology) displayLabel = `${displayLabel}\n[${macroEdge.technology}]`;

                            generatedEdges.push({
                                id: edgeId,
                                source: sourceId,
                                target: targetId,
                                sourceHandle: macroEdge.source_handle,
                                targetHandle: macroEdge.target_handle,
                                animated: isAnimated,
                                type: 'smoothstep',
                                zIndex: 5000,
                                markerStart: mStart,
                                markerEnd: mEnd,
                                data: {
                                    label: macroEdge.label || 'Uses',
                                    technology: macroEdge.technology || '',
                                    direction: direction,
                                    styleVariant: macroEdge.styleVariant || 'solid'
                                },
                                label: displayLabel,
                                labelStyle: { fill: '#475569', fontWeight: 700, fontSize: 11, whiteSpace: 'pre-wrap', textAlign: 'center' as any },
                                labelBgStyle: { fill: '#f8fafc', color: '#f8fafc', fillOpacity: 0.9, stroke: '#e2e8f0', strokeWidth: 1 },
                                style: baseEdgeStyle
                            });
                        }
                    });
                }

                // 3. Attach actual workload (if applicable)
                let shouldAddContainerNode = false;
                newNode.data.composition_id = expansionId; // Ensure the parent node also belongs to the expansion for validation

                if (pattern.composition.workload_target_suffix) {
                    const targetHostId = nodeMap[pattern.composition.workload_target_suffix];
                    if (targetHostId) {
                        newNode.parentNode = targetHostId;
                        newNode.extent = 'parent';
                        newNode.position = { x: 50, y: 80 };
                        newNode.zIndex = 20;
                        shouldAddContainerNode = true;
                    }
                }

                const finalNewNodes = shouldAddContainerNode ? [...generatedNodes, newNode] : generatedNodes;

                setNodes((nds: Node[]) => {
                    const updatedExistingNodes = nds.map(n => {
                        if (mergedNodeMetadata[n.id]) {
                            return {
                                ...n,
                                data: {
                                    ...n.data,
                                    ...mergedNodeMetadata[n.id]
                                }
                            };
                        }
                        return n;
                    });
                    return [...updatedExistingNodes, ...finalNewNodes];
                });

                if (generatedEdges.length > 0) {
                    setEdges((eds: Edge[]) => eds.concat(generatedEdges));
                }
                return;
            }

            // Standard Relationship Resolution based on geometric boundaries
            const scopedParentId = activeView?.scope_entity_id;

            if (pattern.c4Level === 'SoftwareSystem' || pattern.c4Level === 'Person') {
                // Top-level C4 constructs sit directly on the root canvas, never strictly enforced into infrastructure boxes
                newNode.zIndex = 5;
            } else if (scopedParentId && (pattern.c4Level === 'Container' || pattern.c4Level === 'Component')) {
                const systemNodeObj = nodes.find(n => n.id === scopedParentId);
                const parentAbs = systemNodeObj ? getAbsolutePosition(systemNodeObj) : { x: 0, y: 0 };
                newNode.parentNode = scopedParentId;
                newNode.extent = 'parent';
                newNode.zIndex = (systemNodeObj?.zIndex || 5) + 5;
                if (isMockTarget) {
                    newNode.position = { x: 50 * scale, y: 80 * scale };
                } else {
                    newNode.position = {
                        x: position.x - parentAbs.x,
                        y: position.y - parentAbs.y,
                    };
                }
            } else if (closestParent && (closestParent.type === 'deploymentNode' || closestParent.type === 'infrastructureNode')) {
                const parentAbs = getAbsolutePosition(closestParent);
                newNode.parentNode = closestParent.id;
                newNode.extent = 'parent';
                newNode.zIndex = (closestParent.zIndex || 5) + 5; // Stack layer
                if (isMockTarget) {
                    newNode.position = { x: 50 * scale, y: 80 * scale };
                } else {
                    newNode.position = {
                        x: position.x - parentAbs.x,
                        y: position.y - parentAbs.y,
                    };
                }
            } else if (type === 'containerNode') {
                alert(`Governance Violation: A ${pattern.name} must be placed inside a valid Infrastructure Host or System Scope.`);
                return;
            } else if (type === 'deploymentNode') {
                // Placing hierarchy element on root canvas
                newNode.zIndex = 5;
            }

            setNodes((nds: Node[]) => nds.concat(newNode));
        },
        [reactFlowInstance, setNodes, nodes]
    );

    // Effect to programmatically add patterns (useful for mobile touch devices)
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
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onInit={setReactFlowInstance}
                onDrop={onDrop}
                onDragOver={onDragOver}
                nodeTypes={nodeTypes}
                elevateEdgesOnSelect={true}
                connectionMode={ConnectionMode.Loose}
                connectionRadius={40}
                defaultEdgeOptions={{
                    zIndex: 5000,
                    style: { strokeWidth: 3, stroke: '#64748b' }
                }}
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
