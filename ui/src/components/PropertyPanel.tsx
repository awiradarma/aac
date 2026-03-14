import React from 'react';
import { getPatternById } from '../lib/registry';
import { useReactFlow } from 'reactflow';
import type { Edge, Node } from 'reactflow';
import type { NodeData } from '../types';
import { Trash2, X } from 'lucide-react';

interface Props {
    selectedNode: Node<NodeData> | null;
    selectedEdge?: Edge | null;
    onUpdateNodeData: (id: string, newData: any) => void;
    onUpdateEdgeData?: (id: string, newData: any) => void;
    onClose?: () => void;
}

export const PropertyPanel: React.FC<Props> = ({ selectedNode, selectedEdge, onUpdateNodeData, onUpdateEdgeData, onClose }) => {
    const { deleteElements, getNodes } = useReactFlow();

    if (selectedEdge) {
        return (
            <div className="w-full h-full border-l border-slate-200 bg-white p-4 overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-slate-800">Edge Properties</h2>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => deleteElements({ edges: [{ id: selectedEdge.id }] })}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded-md transition-colors flex items-center gap-1"
                            title="Delete Edge"
                        >
                            <Trash2 className="w-5 h-5" />
                        </button>
                        {onClose && (
                            <button onClick={onClose} className="md:hidden p-1.5 text-slate-400 hover:bg-slate-100 rounded-md transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        )}
                    </div>
                </div>
                <div className="mb-6 p-3 bg-slate-50 rounded border border-slate-100 flex flex-col gap-3">
                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Relationship / description</label>
                        <input
                            type="text"
                            value={selectedEdge.data?.label || ''}
                            onChange={(e) => onUpdateEdgeData?.(selectedEdge.id, { label: e.target.value })}
                            className="w-full border border-slate-200 rounded p-1.5 text-sm font-semibold focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Technology</label>
                        <input
                            type="text"
                            value={selectedEdge.data?.technology || ''}
                            onChange={(e) => onUpdateEdgeData?.(selectedEdge.id, { technology: e.target.value })}
                            className="w-full border border-slate-200 rounded p-1.5 text-sm font-semibold focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            placeholder="e.g. HTTPS, gRPC, TCP"
                        />
                    </div>
                </div>
            </div>
        );
    }

    if (!selectedNode) {
        return (
            <div className="w-full h-full border-l border-slate-200 bg-white p-4 flex flex-col items-center justify-center text-slate-400 relative">
                {onClose && (
                    <button onClick={onClose} className="md:hidden absolute top-4 right-4 p-2 text-slate-400 hover:bg-slate-100 rounded-full">
                        <X className="w-5 h-5" />
                    </button>
                )}
                Select a node to view properties
            </div>
        );
    }

    const { data } = selectedNode;
    const pattern = getPatternById(data.pattern_ref.split('@')[0]);

    if (!pattern) return null;

    const handlePropChange = (key: string, value: any) => {
        onUpdateNodeData(selectedNode.id, {
            properties: {
                ...data.properties,
                [key]: value
            }
        });
    };

    const handleLabelChange = (value: string) => {
        onUpdateNodeData(selectedNode.id, { label: value });
    };

    const handleDescriptionChange = (value: string) => {
        onUpdateNodeData(selectedNode.id, { description: value });
    };

    const handleDelete = () => {
        const nodesToDelete = [{ id: selectedNode.id }];

        // Find all immediate children to delete as well
        const childNodes = getNodes().filter(n => n.parentNode === selectedNode.id);
        nodesToDelete.push(...childNodes.map(n => ({ id: n.id })));

        // Find children of children (e.g. Workloads inside Clusters inside Datacenters)
        const subChildNodes = getNodes().filter(n => childNodes.some(cn => cn.id === n.parentNode));
        nodesToDelete.push(...subChildNodes.map(n => ({ id: n.id })));

        deleteElements({ nodes: nodesToDelete });
    };

    return (
        <div className="w-full h-full border-l border-slate-200 bg-white p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-slate-800">Properties</h2>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleDelete}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-md transition-colors flex items-center gap-1"
                        title="Delete Node"
                    >
                        <Trash2 className="w-5 h-5" />
                    </button>
                    {onClose && (
                        <button onClick={onClose} className="md:hidden p-1.5 text-slate-400 hover:bg-slate-100 rounded-md transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                    )}
                </div>
            </div>

            <div className="mb-6 p-3 bg-slate-50 rounded border border-slate-100 flex flex-col gap-3">
                <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Name / ID</label>
                    <input
                        type="text"
                        value={data.label}
                        onChange={(e) => handleLabelChange(e.target.value)}
                        className="w-full border border-slate-200 rounded p-1.5 text-sm font-semibold focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Pattern Ref</label>
                    <div className="text-xs text-slate-500 font-mono p-1.5 bg-slate-200/50 rounded">{data.pattern_ref}</div>
                </div>
                <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Description</label>
                    <textarea
                        value={data.description || ''}
                        onChange={(e) => handleDescriptionChange(e.target.value)}
                        rows={3}
                        className="w-full border border-slate-200 rounded p-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                        placeholder="Optional description..."
                    />
                </div>
            </div>

            <div className="space-y-4">
                {pattern.parameters && Object.entries(pattern.parameters).map(([key, param]) => (
                    <div key={key}>
                        <label className="block text-sm font-medium text-slate-700 mb-1 capitalize">
                            {key.replace('_', ' ')}
                        </label>
                        {param.options ? (
                            <select
                                className="w-full border border-slate-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                value={data.properties[key] || param.default || ''}
                                onChange={(e) => handlePropChange(key, e.target.value)}
                            >
                                {param.default ? null : <option value="">Select option...</option>}
                                {param.options.map((opt: string) => (
                                    <option key={opt} value={opt}>{opt}</option>
                                ))}
                            </select>
                        ) : param.const ? (
                            <input
                                type="text"
                                disabled
                                className="w-full border border-slate-200 bg-slate-50 rounded p-2 text-sm text-slate-500"
                                value={param.const}
                            />
                        ) : (
                            <input
                                type="text"
                                className="w-full border border-slate-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                value={data.properties[key] || param.default || ''}
                                onChange={(e) => handlePropChange(key, e.target.value)}
                            />
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};
