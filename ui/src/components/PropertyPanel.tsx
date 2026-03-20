import React from 'react';
import { getPatternById } from '../lib/registry';
import { useReactFlow } from 'reactflow';
import type { Edge, Node } from 'reactflow';
import type { NodeData } from '../types';
import { Trash2, X, Box } from 'lucide-react';

interface Props {
    selectedNode: Node<NodeData> | null;
    selectedEdge?: Edge | null;
    onUpdateNodeData: (id: string, newData: any) => void;
    onUpdateEdgeData?: (id: string, newData: any) => void;
    onClose?: () => void;
}

/**
 * Renders the context-aware sidebar on the right side of the canvas.
 * This panel dynamically loads parameter schemas (`const`, `options`, `type`) from the respective 
 * YAML registries based on the currently selected node (`widget_ref`). 
 * It manages the local instance state without mutating the global registry template.
 */
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
        const nodes = getNodes();
        const activePatterns = new Map<string, number>();
        const expOrigins = new Map<string, string>(); // expId -> originPattern

        nodes.forEach(n => {
            // Track primary patterns applied
            if (n.data?.origin_pattern && n.data?.composition_id) {
                const originId = n.data.origin_pattern.split('@')[0];
                expOrigins.set(n.data.composition_id, originId);
            }
        });

        // Add applied patterns to the active count
        expOrigins.forEach((macroId) => {
            activePatterns.set(macroId, (activePatterns.get(macroId) || 0) + 1);
        });

        return (
            <div className="w-full h-full border-l border-slate-200 bg-white p-4 overflow-y-auto relative">
                {onClose && (
                    <button onClick={onClose} className="md:hidden absolute top-4 right-4 p-2 text-slate-400 hover:bg-slate-100 rounded-full">
                        <X className="w-5 h-5" />
                    </button>
                )}
                <h2 className="text-lg font-bold text-slate-800 mb-6">Design Overview</h2>
                {activePatterns.size === 0 ? (
                    <div className="flex flex-col items-center justify-center text-slate-400 h-64 text-center px-4">
                        <Box className="w-12 h-12 mb-4 text-slate-200" />
                        <p>Select a node to view its properties,</p>
                        <p className="mt-1">or drag patterns from the sidebar to start designing.</p>
                    </div>
                ) : (
                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Known Patterns in Design</h3>
                            <span className="bg-slate-100 text-slate-600 py-0.5 px-2 rounded-full text-[10px] font-bold">
                                {activePatterns.size} Types
                            </span>
                        </div>
                        <div className="space-y-2">
                            {Array.from(activePatterns.entries()).map(([patId, count]) => {
                                const pattern = getPatternById(patId);
                                return (
                                    <div key={patId} className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-lg shadow-sm">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-md flex items-center justify-center bg-blue-100 text-blue-600">
                                                <Box className="w-4 h-4" />
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-sm font-semibold text-slate-800">{pattern?.name || patId}</span>
                                                <span className="text-[10px] font-mono text-slate-500">{patId}</span>
                                            </div>
                                        </div>
                                        <span className="text-xs font-bold text-slate-600 bg-white px-2.5 py-1 rounded border border-slate-200 shadow-sm">{count}</span>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="mt-8 text-center text-xs text-slate-400">
                            Select a node on the canvas to view or edit its specific properties.
                        </div>
                    </div>
                )}
            </div>
        );
    }

    const { data } = selectedNode;
    const pattern = getPatternById(data.widget_ref.split('@')[0]);

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
                    <div className="text-xs text-slate-500 font-mono p-1.5 bg-slate-200/50 rounded">{data.widget_ref}</div>
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

            {data.memberships && Object.keys(data.memberships).length > 0 && (
                <div className="mb-6 p-4 bg-indigo-50/50 rounded-lg border border-indigo-100 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <label className="block text-xs font-bold text-indigo-800 uppercase tracking-wider">Pattern Memberships</label>
                        {Object.keys(data.memberships).length > 1 && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">Shared Resource</span>
                        )}
                    </div>
                    {Object.entries(data.memberships).map(([expId, alias]) => (
                        <div key={expId} className="flex flex-col text-sm border border-indigo-200 bg-white p-2.5 rounded shadow-sm">
                            <div className="flex items-center justify-between mb-1">
                                <span className="font-semibold text-indigo-900"><span className="text-slate-500 font-normal text-xs mr-1">Alias:</span>{alias as string}</span>
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono mt-0.5 break-all">ID: {expId}</span>
                        </div>
                    ))}
                    {data.origin_pattern && (
                        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-indigo-600 bg-indigo-100/50 p-2 rounded border border-indigo-100 w-fit">
                            <span className="font-semibold">Source Pattern:</span> {data.origin_pattern}
                        </div>
                    )}
                </div>
            )}

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
