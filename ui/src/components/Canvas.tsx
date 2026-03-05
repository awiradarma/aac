import { useCallback, useState } from 'react';
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    addEdge,
} from 'reactflow';
import type { Connection, Edge, Node } from 'reactflow';
import 'reactflow/dist/style.css';

import { HostNode, WorkloadNode, HierarchyNode, InfrastructureNode } from './Nodes';
import { getPatternById } from '../lib/registry';
import type { NodeData } from '../types';

const nodeTypes = {
    hostNode: HostNode,
    workloadNode: WorkloadNode,
    hierarchyNode: HierarchyNode,
    infrastructureNode: InfrastructureNode,
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
}

export const CanvasArea: React.FC<Props> = ({ nodes, edges, setNodes, setEdges, onNodesChange, onEdgesChange, onNodeSelect, onEdgeSelect }) => {
    const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

    const onConnect = useCallback((params: Edge | Connection) => {
        const edge = { ...params, id: `e-${params.source}-${params.target}-${Date.now()}`, animated: true, zIndex: 50, data: { label: 'Uses', technology: '' } };
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

            if (typeof type === 'undefined' || !type || !patternId) {
                return;
            }

            const pattern = getPatternById(patternId);
            if (!pattern) return;

            const position = reactFlowInstance.screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });

            // Default properties based on the pattern parameters
            const defaultProps: Record<string, any> = {};
            if (pattern.parameters) {
                Object.entries(pattern.parameters).forEach(([key, param]) => {
                    defaultProps[key] = param.default || param.const || '';
                });
            }

            const newNode: Node<NodeData> = {
                id: getId(),
                type,
                position,
                style: type === 'hierarchyNode' ? { width: pattern.default_width || 800, height: pattern.default_height || 600 } : undefined,
                data: {
                    label: `${pattern.name} Instance`,
                    pattern_ref: `${pattern.id}@${pattern.version}`,
                    c4Level: pattern.c4Level,
                    layer: pattern.layer,
                    properties: defaultProps,
                    status: 'new'
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
                if (n.type !== 'hierarchyNode' && n.type !== 'hostNode') return false;
                const pos = getAbsolutePosition(n);
                const nPattern = getPatternById(n.data.pattern_ref?.split('@')[0]);
                const width = n.style?.width ? Number(n.style.width) : (nPattern?.default_width || 500);
                const height = n.style?.height ? Number(n.style.height) : (nPattern?.default_height || 400);

                return position.x >= pos.x && position.x <= pos.x + width &&
                    position.y >= pos.y && position.y <= pos.y + height;
            });

            // The closest parent mathematically is the one with the smallest area (deepest nest)
            possibleParents.sort((a, b) => {
                const aPattern = getPatternById(a.data.pattern_ref?.split('@')[0]);
                const bPattern = getPatternById(b.data.pattern_ref?.split('@')[0]);
                const aArea = (a.style?.width ? Number(a.style.width) : (aPattern?.default_width || 500)) *
                    (a.style?.height ? Number(a.style.height) : (aPattern?.default_height || 400));
                const bArea = (b.style?.width ? Number(b.style.width) : (bPattern?.default_width || 500)) *
                    (b.style?.height ? Number(b.style.height) : (bPattern?.default_height || 400));
                return aArea - bArea;
            });

            const closestParent = possibleParents.length > 0 ? possibleParents[0] : null;

            // Dynamic Macro Expansion
            if (pattern.macro_expansion) {
                const isDroppedInDatacenter = closestParent && closestParent.data.label.includes('Datacenter');
                const generatedNodes: Node<NodeData>[] = [];
                const generatedEdges: Edge[] = [];
                const nodeMap: Record<string, string> = {}; // maps suffix to generated id

                // Base positions for the primary node (e.g. cluster)
                const baseX = isDroppedInDatacenter ? 50 : position.x - 200;
                const baseY = isDroppedInDatacenter ? 100 : position.y;

                const processNodes = (nodeList: any[], parentId: string | undefined, depth: number, startX: number, startY: number, extent?: 'parent') => {
                    nodeList.forEach((macroNode: any, index: number) => {
                        let existingNode = null;
                        const checkType = macroNode.type === 'deploymentNode' ? 'hierarchyNode' : macroNode.type;

                        if (parentId) {
                            existingNode = nodes.find(n =>
                                n.parentNode === parentId &&
                                n.data.pattern_ref === macroNode.pattern_ref &&
                                n.data.layer === macroNode.layer &&
                                n.type === checkType
                            );
                        } else {
                            existingNode = nodes.find(n =>
                                !n.parentNode &&
                                n.data.pattern_ref === macroNode.pattern_ref &&
                                n.data.layer === macroNode.layer &&
                                n.type === checkType
                            );
                        }

                        let currentNodeId: string;

                        if (existingNode) {
                            // Merge: node already exists in this scope
                            currentNodeId = existingNode.id;
                            nodeMap[macroNode.id_suffix] = currentNodeId;
                        } else {
                            currentNodeId = getId();
                            nodeMap[macroNode.id_suffix] = currentNodeId;

                            // Simple auto-layout
                            let offsetX = 0;
                            let offsetY = 0;
                            if (depth === 0) {
                                offsetX = index * 450;
                            } else {
                                offsetX = 50 + (index * 450);
                                offsetY = 80;
                            }

                            const nPattern = macroNode.pattern_ref ? getPatternById(macroNode.pattern_ref.split('@')[0]) : null;

                            const gNode: Node<NodeData> = {
                                id: currentNodeId,
                                type: checkType,
                                position: { x: startX + offsetX, y: startY + offsetY },
                                style: (checkType === 'hierarchyNode') ? { width: nPattern?.default_width || 500, height: nPattern?.default_height || 400 } : undefined,
                                parentNode: parentId,
                                extent: extent,
                                zIndex: 10 + depth,
                                data: {
                                    label: macroNode.label,
                                    pattern_ref: macroNode.pattern_ref,
                                    c4Level: macroNode.c4Level,
                                    layer: macroNode.layer,
                                    properties: macroNode.properties ? { ...macroNode.properties } : {},
                                    status: 'new'
                                }
                            };

                            if (isDroppedInDatacenter && macroNode.layer === 'Cluster') {
                                gNode.data.properties.datacenter_id = closestParent?.data.properties.dc_id;
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
                if (pattern.macro_expansion.nodes) {
                    processNodes(pattern.macro_expansion.nodes, isDroppedInDatacenter && closestParent ? closestParent.id : undefined, 0, baseX, baseY, isDroppedInDatacenter ? 'parent' : undefined);
                }

                // 2. Generate Edges
                if (pattern.macro_expansion.edges) {
                    pattern.macro_expansion.edges.forEach((macroEdge: any) => {
                        const sourceId = nodeMap[macroEdge.source_suffix];
                        const targetId = nodeMap[macroEdge.target_suffix];
                        if (sourceId && targetId) {
                            generatedEdges.push({
                                id: `e-${sourceId}-${targetId}`,
                                source: sourceId,
                                target: targetId,
                                animated: true,
                                style: macroEdge.style
                            });
                        }
                    });
                }

                // 3. Attach actual workload (if applicable)
                let shouldAddWorkloadNode = false;
                if (pattern.macro_expansion.workload_target_suffix) {
                    const targetHostId = nodeMap[pattern.macro_expansion.workload_target_suffix];
                    if (targetHostId) {
                        newNode.parentNode = targetHostId;
                        newNode.extent = 'parent';
                        newNode.position = { x: 50, y: 80 };
                        newNode.zIndex = 20;
                        shouldAddWorkloadNode = true;
                    }
                }

                if (shouldAddWorkloadNode) {
                    setNodes((nds: Node[]) => nds.concat([...generatedNodes, newNode]));
                } else {
                    setNodes((nds: Node[]) => nds.concat([...generatedNodes]));
                }

                if (generatedEdges.length > 0) {
                    setEdges((eds: Edge[]) => eds.concat(generatedEdges));
                }
                return;
            }

            // Standard Relationship Resolution based on geometric boundaries
            if (closestParent) {
                const parentAbs = getAbsolutePosition(closestParent);
                newNode.parentNode = closestParent.id;
                newNode.extent = 'parent';
                newNode.zIndex = (closestParent.zIndex || 5) + 5; // Stack layer
                newNode.position = {
                    x: position.x - parentAbs.x,
                    y: position.y - parentAbs.y,
                };
            } else if (type === 'workloadNode') {
                alert(`Governance Violation: A ${pattern.name} must be placed inside a valid Infrastructure Host.`);
                return;
            } else if (type === 'hierarchyNode') {
                // Placing hierarchy element on root canvas
                newNode.zIndex = 5;
            }

            setNodes((nds: Node[]) => nds.concat(newNode));
        },
        [reactFlowInstance, setNodes, nodes]
    );

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
                onNodeClick={(_, node) => onNodeSelect(node)}
                onEdgeClick={(_, edge) => onEdgeSelect(edge)}
                onPaneClick={() => { onNodeSelect(null); onEdgeSelect(null); }}
                fitView
                className="bg-slate-50"
            >
                <Background color="#cbd5e1" gap={16} />
                <Controls />
                <MiniMap />
            </ReactFlow>
        </div>
    );
};
