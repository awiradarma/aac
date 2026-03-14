import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { NodeResizer } from '@reactflow/node-resizer';
import '@reactflow/node-resizer/dist/style.css';
import type { NodeData } from '../types';
import * as LucideIcons from 'lucide-react';
import { Box } from 'lucide-react';

const DynamicIcon = ({ name, className }: { name?: string, className?: string }) => {
    if (!name) return <Box className={className} />;
    const Icon = (LucideIcons as any)[name];
    if (!Icon) return <Box className={className} />;
    return <Icon className={className} />;
};

const themedStyles = (color: string) => {
    const themes: Record<string, any> = {
        emerald: {
            bg: 'bg-emerald-100/40',
            bgHeader: 'bg-emerald-400/90',
            border: 'border-emerald-500',
            borderSelected: 'border-emerald-600 ring-emerald-500/30',
            text: 'text-emerald-950',
            textMuted: 'text-emerald-800',
            handle: 'rf-node-resizer-handle resizer-emerald',
            line: 'rf-node-resizer-line resizer-emerald',
            port: 'port-emerald'
        },
        amber: {
            bg: 'bg-amber-100/40',
            bgHeader: 'bg-amber-400/90',
            border: 'border-amber-500',
            borderSelected: 'border-amber-600 ring-amber-500/30',
            text: 'text-amber-950',
            textMuted: 'text-amber-800',
            handle: 'rf-node-resizer-handle resizer-amber',
            line: 'rf-node-resizer-line resizer-amber',
            port: 'port-amber'
        },
        blue: {
            bg: 'bg-blue-100/40',
            bgHeader: 'bg-blue-400/90',
            border: 'border-blue-500',
            borderSelected: 'border-blue-600 ring-blue-500/30',
            text: 'text-blue-950',
            textMuted: 'text-blue-800',
            handle: 'rf-node-resizer-handle resizer-blue',
            line: 'rf-node-resizer-line resizer-blue',
            port: 'port-blue'
        },
        purple: {
            bg: 'bg-purple-100/40',
            bgHeader: 'bg-purple-400/90',
            border: 'border-purple-500',
            borderSelected: 'border-purple-600 ring-purple-500/30',
            text: 'text-purple-950',
            textMuted: 'text-purple-800',
            handle: 'rf-node-resizer-handle resizer-purple',
            line: 'rf-node-resizer-line resizer-purple',
            port: 'port-purple'
        },
        slate: {
            bg: 'bg-slate-100/40',
            bgHeader: 'bg-slate-400/90',
            border: 'border-slate-500',
            borderSelected: 'border-slate-600 ring-slate-500/30',
            text: 'text-slate-950',
            textMuted: 'text-slate-800',
            handle: 'rf-node-resizer-handle resizer-slate',
            line: 'rf-node-resizer-line resizer-slate',
            port: 'port-slate'
        }
    };
    return themes[color] || themes.blue;
};

export const HierarchyNode = ({ data, selected }: NodeProps<NodeData>) => {
    const style = themedStyles(data.color || 'emerald');

    return (
        <div className={`w-full h-full border-2 rounded-2xl ${style.bg} backdrop-blur-sm ${selected ? `${style.borderSelected}` : `${style.border} border-dashed`} transition-all relative`}>
            <NodeResizer
                minWidth={data.min_width || (window.innerWidth < 768 ? 200 : 300)}
                minHeight={data.min_height || (window.innerWidth < 768 ? 200 : 300)}
                isVisible={selected}
                handleClassName={style.handle}
                lineClassName={style.line}
            />
            {/* Header tab, top left */}
            <div className={`absolute top-0 left-0 ${style.bgHeader} px-4 py-2 rounded-tl-xl rounded-br-xl border-b border-r ${style.border} flex items-center gap-2 shadow-sm z-10`}>
                <DynamicIcon name={data.icon} className={`w-5 h-5 ${style.textMuted}`} />
                <div>
                    <div className={`font-bold text-sm ${style.text}`}>{data.label}</div>
                    <div className={`text-xs ${style.textMuted} font-mono mt-0.5`}>{data.pattern_ref}</div>
                </div>
            </div>

            {/* Background Label */}
            <div className={`absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.03] text-[8rem] font-black ${style.text} uppercase tracking-tighter leading-none text-center px-4 overflow-hidden`}>
                {data.label.toUpperCase()}
            </div>

            <Handle type="target" position={Position.Left} className={style.port} data-port-label="INPUT" />
            <Handle type="source" position={Position.Right} className={style.port} data-port-label="OUTPUT" />
        </div>
    );
};

export const HostNode = ({ data, selected }: NodeProps<NodeData>) => {
    const style = themedStyles(data.color || 'slate');

    return (
        <div className={`w-64 md:w-96 min-h-[180px] md:min-h-[300px] border-2 rounded-xl ${style.bg.replace('/30', '/80')} backdrop-blur ${selected ? 'border-primary ring-4 ring-primary/20' : `${style.border} border-dashed`} transition-all relative`}>
            <NodeResizer
                minWidth={data.min_width || (window.innerWidth < 768 ? 150 : 300)}
                minHeight={data.min_height || (window.innerWidth < 768 ? 100 : 200)}
                isVisible={selected}
                handleClassName={style.handle}
                lineClassName={style.line}
            />
            <div className={`${style.bgHeader.replace('/80', '/50')} p-3 rounded-t-xl border-b ${style.border} flex items-center gap-2`}>
                <DynamicIcon name={data.icon || 'Server'} className={`w-5 h-5 ${style.textMuted.replace('700', '600')}`} />
                <div>
                    <div className={`font-bold text-sm ${style.text.replace('900', '800')}`}>{data.label}</div>
                    <div className={`text-xs ${style.textMuted.replace('700', '500')} font-mono mt-0.5`}>{data.pattern_ref}</div>
                </div>
            </div>
            <div className="p-4 flex flex-col gap-2">
                <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Nested Workloads</div>
            </div>
            <Handle type="target" position={Position.Top} className={style.port} data-port-label="INPUT" />
            <Handle type="source" position={Position.Bottom} className={style.port} data-port-label="OUTPUT" />
        </div>
    );
};

export const WorkloadNode = ({ data, selected }: NodeProps<NodeData>) => {
    const style = themedStyles(data.color || 'blue');
    return (
        <div className={`w-40 md:w-64 bg-white border-2 rounded-lg shadow-sm ${selected ? `${style.borderSelected}` : `${style.border.replace('300', '200')}`} transition-all`}>
            <div className={`${style.bg.replace('/30', '')} p-2 border-b ${style.border.replace('300', '100')} flex items-center gap-2 rounded-t-lg`}>
                <DynamicIcon name={data.icon} className={`w-4 h-4 ${style.textMuted.replace('700', '600')}`} />
                <div>
                    <div className="font-semibold text-sm text-slate-800">{data.label}</div>
                    <div className={`text-[10px] ${style.textMuted.replace('700', '500')} font-mono`}>{data.pattern_ref}</div>
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
            <Handle type="target" position={Position.Top} className={style.port} data-port-label="INPUT" />
            <Handle type="source" position={Position.Bottom} className={style.port} data-port-label="OUTPUT" />
        </div>
    );
};

export const InfrastructureNode = ({ data, selected }: NodeProps<NodeData>) => {
    const style = themedStyles(data.color || 'purple');
    return (
        <div className={`w-36 md:w-52 min-h-[60px] md:min-h-[80px] flex flex-col items-center justify-center p-3 border-2 rounded-xl ${style.bg.replace('/30', '/90')} backdrop-blur shadow-sm ${selected ? `${style.borderSelected}` : `${style.border} border-dashed`} transition-all`}>
            <div className="flex items-center gap-2 mb-1">
                <DynamicIcon name={data.icon} className={`w-4 h-4 ${style.textMuted.replace('700', '600')}`} />
                <div className={`font-bold text-sm ${style.text} text-center`}>{data.label}</div>
            </div>
            <div className={`text-[10px] ${style.textMuted.replace('700', '600')} font-mono text-center`}>{data.pattern_ref}</div>
            <Handle type="target" position={Position.Top} className={style.port} data-port-label="INPUT" />
            <Handle type="source" position={Position.Bottom} className={style.port} data-port-label="OUTPUT" />
        </div>
    );
};
