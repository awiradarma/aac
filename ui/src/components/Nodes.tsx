import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { NodeResizer } from '@reactflow/node-resizer';
import '@reactflow/node-resizer/dist/style.css';
import type { NodeData } from '../types';
import { Box, Server, Map, Building2 } from 'lucide-react';

export const HierarchyNode = ({ data, selected }: NodeProps<NodeData>) => {
    // Dynamic styling based on hierarchy level
    const isRegion = data.label.includes('Region');
    const Icon = isRegion ? Map : Building2;
    const colorClass = isRegion ? 'amber' : 'emerald';

    return (
        <div className={`w-full h-full border-2 rounded-2xl bg-${colorClass}-50/30 backdrop-blur-sm ${selected ? `border-${colorClass}-500 ring-4 ring-${colorClass}-500/20` : `border-${colorClass}-300 border-dashed`} transition-all relative`}>
            <NodeResizer minWidth={300} minHeight={300} isVisible={selected} />
            {/* Header tab, top left */}
            <div className={`absolute top-0 left-0 bg-${colorClass}-200/80 px-4 py-2 rounded-tl-xl rounded-br-xl border-b border-r border-${colorClass}-300 flex items-center gap-2 shadow-sm z-10`}>
                <Icon className={`w-5 h-5 text-${colorClass}-700`} />
                <div>
                    <div className={`font-bold text-sm text-${colorClass}-900`}>{data.label}</div>
                    <div className={`text-xs text-${colorClass}-700 font-mono mt-0.5`}>{data.pattern_ref}</div>
                </div>
            </div>

            {/* Background Label */}
            <div className={`absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.03] text-[8rem] font-black text-${colorClass}-900 uppercase tracking-tighter leading-none text-center px-4 overflow-hidden`}>
                {data.label.toUpperCase()}
            </div>

            <Handle type="target" position={Position.Left} className="w-3 h-3 !bg-slate-400 border-2 !border-white" />
            <Handle type="source" position={Position.Right} className="w-3 h-3 !bg-slate-400 border-2 !border-white" />
        </div>
    );
};

export const HostNode = ({ data, selected }: NodeProps<NodeData>) => {
    return (
        <div className={`w-96 min-h-[300px] border-2 rounded-xl bg-slate-50/80 backdrop-blur ${selected ? 'border-primary ring-4 ring-primary/20' : 'border-slate-300 border-dashed'} transition-all`}>
            <div className="bg-slate-200/50 p-3 rounded-t-xl border-b border-slate-300 flex items-center gap-2">
                <Server className="w-5 h-5 text-slate-600" />
                <div>
                    <div className="font-bold text-sm text-slate-800">{data.label}</div>
                    <div className="text-xs text-slate-500 font-mono mt-0.5">{data.pattern_ref}</div>
                </div>
            </div>
            <div className="p-4 flex flex-col gap-2">
                <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Nested Workloads</div>
                {/* ReactFlow Child Nodes will be rendered here via z-index and coordinates */}
            </div>
            <Handle type="target" position={Position.Top} className="w-3 h-3 !bg-slate-400 border-2 !border-white" />
            <Handle type="source" position={Position.Bottom} className="w-3 h-3 !bg-slate-400 border-2 !border-white" />
        </div>
    );
};

export const WorkloadNode = ({ data, selected }: NodeProps<NodeData>) => {
    return (
        <div className={`w-64 bg-white border-2 rounded-lg shadow-sm ${selected ? 'border-blue-500 ring-4 ring-blue-500/20' : 'border-blue-200'} transition-all`}>
            <div className="bg-blue-50 p-2 border-b border-blue-100 flex items-center gap-2 rounded-t-lg">
                <Box className="w-4 h-4 text-blue-600" />
                <div>
                    <div className="font-semibold text-sm text-slate-800">{data.label}</div>
                    <div className="text-[10px] text-blue-500 font-mono">{data.pattern_ref}</div>
                </div>
            </div>
            <div className="p-2">
                <div className="flex flex-col gap-1">
                    {Object.entries(data.properties).map(([key, value]) => (
                        <div key={key} className="flex justify-between text-xs">
                            <span className="text-slate-500">{key}:</span>
                            <span className="font-medium text-slate-700">{String(value)}</span>
                        </div>
                    ))}
                </div>
            </div>
            <Handle type="target" position={Position.Top} className="w-3 h-3 !bg-blue-400 border-2 !border-white" />
            <Handle type="source" position={Position.Bottom} className="w-3 h-3 !bg-blue-400 border-2 !border-white" />
        </div>
    );
};

export const InfrastructureNode = ({ data, selected }: NodeProps<NodeData>) => {
    return (
        <div className={`w-52 min-h-[80px] flex flex-col items-center justify-center p-3 border-2 rounded-xl bg-purple-50/90 backdrop-blur shadow-sm ${selected ? 'border-purple-500 ring-4 ring-purple-500/20' : 'border-purple-300 border-dashed'} transition-all`}>
            <div className="flex items-center gap-2 mb-1">
                <Box className="w-4 h-4 text-purple-600" />
                <div className="font-bold text-sm text-purple-900 text-center">{data.label}</div>
            </div>
            <div className="text-[10px] text-purple-600 font-mono text-center">{data.pattern_ref}</div>
            <Handle type="target" position={Position.Top} className="w-3 h-3 !bg-purple-400 border-2 !border-white" />
            <Handle type="source" position={Position.Bottom} className="w-3 h-3 !bg-purple-400 border-2 !border-white" />
        </div>
    );
};
