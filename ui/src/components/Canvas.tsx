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
                style: type === 'hierarchyNode' ? { width: pattern.name === 'Cloud Region' ? 1200 : 1000, height: pattern.name === 'Cloud Region' ? 1000 : 800 } : undefined,
                data: {
                    label: `${pattern.name} Instance`,
                    pattern_ref: `${pattern.id}@${pattern.version}`,
                    c4Level: pattern.c4Level,
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

            // Find potential parent nodes using absolute bounds
            const parentHost = nodes.find(n => {
                if (n.type !== 'hostNode') return false;
                const pos = getAbsolutePosition(n);
                return position.x >= pos.x && position.x <= pos.x + 384 &&
                    position.y >= pos.y && position.y <= pos.y + 300;
            });

            const possibleHierarchies = nodes.filter(n => {
                if (n.type !== 'hierarchyNode') return false;
                const pos = getAbsolutePosition(n);
                const width = n.style?.width ? Number(n.style.width) : (n.data.label.includes('Region') ? 1200 : 1000);
                const height = n.style?.height ? Number(n.style.height) : (n.data.label.includes('Region') ? 1000 : 800);
                return position.x >= pos.x && position.x <= pos.x + width &&
                    position.y >= pos.y && position.y <= pos.y + height;
            });
            // Priority to Datacenter -> smaller area -> should be parent
            possibleHierarchies.sort((a, _b) => a.data.label.includes('Datacenter') ? -1 : 1);
            const parentHierarchy = possibleHierarchies[0];

            // Logic matching macro-drop
            if (patternId === 'internal-api-ocp') {
                const isDroppedInDatacenter = parentHierarchy && parentHierarchy.data.label.includes('Datacenter');

                // Generate cluster
                const clusterNode: Node<NodeData> = {
                    id: getId(),
                    type: 'hostNode',
                    position: isDroppedInDatacenter ? { x: 50, y: 100 } : { x: position.x - 200, y: position.y },
                    parentNode: isDroppedInDatacenter ? parentHierarchy.id : undefined,
                    extent: isDroppedInDatacenter ? 'parent' : undefined,
                    zIndex: 10,
                    data: {
                        label: 'Standard OpenShift Cluster Instance',
                        pattern_ref: 'openshift-cluster-v4@4.12.0',
                        c4Level: 'DeploymentNode',
                        properties: { datacenter_id: isDroppedInDatacenter ? parentHierarchy.data.properties.dc_id : '', region: '' },
                        status: 'new'
                    },
                };

                // Gen Load Balancer
                const lbNode: Node<NodeData> = {
                    id: getId(),
                    type: 'infrastructureNode',
                    position: isDroppedInDatacenter ? { x: 500, y: 100 } : { x: position.x + 200, y: position.y },
                    parentNode: isDroppedInDatacenter ? parentHierarchy.id : undefined,
                    extent: isDroppedInDatacenter ? 'parent' : undefined,
                    zIndex: 10,
                    data: {
                        label: 'Local Load Balancer Instance',
                        pattern_ref: 'local-load-balancer@2.0.0',
                        c4Level: 'InfrastructureNode',
                        properties: { provider: 'avi' },
                        status: 'new'
                    },
                };

                // Gen API Gateway
                const gwNode: Node<NodeData> = {
                    id: getId(),
                    type: 'infrastructureNode',
                    position: isDroppedInDatacenter ? { x: 500, y: 250 } : { x: position.x + 200, y: position.y + 150 },
                    parentNode: isDroppedInDatacenter ? parentHierarchy.id : undefined,
                    extent: isDroppedInDatacenter ? 'parent' : undefined,
                    zIndex: 10,
                    data: {
                        label: 'API Gateway Instance',
                        pattern_ref: 'api-gateway@2.0.0',
                        c4Level: 'InfrastructureNode',
                        properties: { provider: 'apigee' },
                        status: 'new'
                    },
                };

                // Actual workload
                newNode.parentNode = clusterNode.id;
                newNode.extent = 'parent';
                newNode.position = { x: 50, y: 80 };
                newNode.zIndex = 20;

                setNodes((nds: Node[]) => nds.concat([clusterNode, lbNode, gwNode, newNode]));

                // Add connections between generated infra
                setEdges((eds: Edge[]) => eds.concat([
                    { id: `e-${lbNode.id}-${clusterNode.id}`, source: lbNode.id, target: clusterNode.id, animated: true, style: { stroke: '#blue' } },
                    { id: `e-${gwNode.id}-${lbNode.id}`, source: gwNode.id, target: lbNode.id, animated: true }
                ]));
                return;
            }

            // Standard Relationship Resolution
            if (parentHost && type === 'workloadNode') {
                const parentAbs = getAbsolutePosition(parentHost);
                newNode.parentNode = parentHost.id;
                newNode.extent = 'parent';
                newNode.zIndex = 20;
                newNode.position = {
                    x: position.x - parentAbs.x,
                    y: position.y - parentAbs.y,
                };
            } else if (parentHierarchy) {
                // E.g Host dropped in Datacenter, Datacenter dropped in Region
                const parentAbs = getAbsolutePosition(parentHierarchy);
                newNode.parentNode = parentHierarchy.id;
                newNode.extent = 'parent';
                newNode.zIndex = parentHierarchy.data.label.includes('Region') ? 5 : 10;
                newNode.position = {
                    x: position.x - parentAbs.x,
                    y: position.y - parentAbs.y,
                };
            } else if (type === 'workloadNode') {
                alert(`Governance Violation: A ${pattern.name} must be placed inside a valid Infrastructure Host.`);
                return;
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
