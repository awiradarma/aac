import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { NodeResizer } from '@reactflow/node-resizer';
import '@reactflow/node-resizer/dist/style.css';
import type { NodeData } from '../types';
import * as LucideIcons from 'lucide-react';
import { Box } from 'lucide-react';

/** Dynamically resolves Lucide React icons by string name provided flexibly by yaml definition */
const DynamicIcon = ({ name, className }: { name?: string, className?: string }) => {
    if (!name) return <Box className={className} />;
    const Icon = (LucideIcons as any)[name];
    if (!Icon) return <Box className={className} />;
    return <Icon className={className} />;
};

/** Shared Tailwind tokens for translating YAML pattern colors into gorgeous glassmorphism UI */
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

export const DeploymentNode = ({ data, selected }: NodeProps<NodeData>) => {
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
                    <div className={`text-xs ${style.textMuted} font-mono mt-0.5`}>{data.widget_ref}</div>
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

export const ContainerNode = ({ data, selected }: NodeProps<NodeData>) => {
    const style = themedStyles(data.color || 'blue');
    return (
        <div className={`w-40 md:w-64 bg-white border-2 rounded-lg shadow-sm ${selected ? `${style.borderSelected}` : `${style.border.replace('300', '200')}`} transition-all`}>
            <div className={`${style.bg.replace('/30', '')} p-2 border-b ${style.border.replace('300', '100')} flex items-center gap-2 rounded-t-lg`}>
                <DynamicIcon name={data.icon} className={`w-4 h-4 ${style.textMuted.replace('700', '600')}`} />
                <div>
                    <div className="font-semibold text-sm text-slate-800">{data.label}</div>
                    <div className={`text-[10px] ${style.textMuted.replace('700', '500')} font-mono`}>{data.widget_ref}</div>
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
            <Handle type="target" position={Position.Left} className={style.port} data-port-label="INPUT" />
            <Handle type="source" position={Position.Right} className={style.port} data-port-label="OUTPUT" />
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
            <div className={`text-[10px] ${style.textMuted.replace('700', '600')} font-mono text-center`}>{data.widget_ref}</div>
            <Handle type="target" position={Position.Top} className={style.port} data-port-label="INPUT" />
            <Handle type="source" position={Position.Bottom} className={style.port} data-port-label="OUTPUT" />
        </div>
    );
};

export const PersonNode = ({ data, selected }: NodeProps<NodeData>) => {
    const style = themedStyles(data.color || 'amber');
    return (
        <div className="flex flex-col items-center relative transition-all">
            {/* Person Head (Circle) */}
            <div className={`w-14 h-14 md:w-16 md:h-16 flex items-center justify-center bg-slate-50 border-2 rounded-full shadow-sm z-10 ${selected ? `${style.borderSelected}` : `${style.border.replace('300', '200')} border-slate-300`}`}>
                <DynamicIcon name={data.icon || 'User'} className={`w-7 h-7 md:w-8 md:h-8 ${style.textMuted.replace('700', '600')}`} />
            </div>

            {/* Person Body (Rectangle) */}
            <div className={`w-36 md:w-48 flex flex-col items-center justify-center bg-white border-2 rounded-2xl shadow-md p-4 pt-6 -mt-5 ${selected ? `${style.borderSelected}` : `${style.border.replace('300', '200')} border-slate-300`} relative`}>
                <div className={`font-bold text-xs md:text-sm text-center px-1 ${style.text} leading-tight`}>{data.label}</div>
                <div className={`text-[9px] md:text-[10px] text-slate-500 font-mono tracking-wider mt-1`}>[Person]</div>
            </div>

            <Handle type="target" position={Position.Left} className={style.port} />
            <Handle type="source" position={Position.Right} className={style.port} />
        </div>
    );
};

export const SystemNode = ({ data, selected }: NodeProps<NodeData>) => {
    const style = themedStyles(data.color || 'slate');
    return (
        <div className={`w-48 md:w-64 bg-slate-50 border-2 rounded-xl shadow-md ${selected ? `${style.borderSelected}` : `${style.border.replace('300', '300')}`} transition-all overflow-hidden flex flex-col`}>
            <div className={`${style.bg} p-4 flex flex-col items-center justify-center text-center gap-1.5`}>
                <DynamicIcon name={data.icon} className={`w-7 h-7 ${style.textMuted}`} />
                <div className="font-bold text-[14px] md:text-base text-slate-800 leading-tight">{data.label}</div>
                <div className="text-[10px] text-slate-500 font-mono tracking-wider">[Software System]</div>
            </div>
            {Object.keys(data.properties).length > 0 && (
                <div className="p-3 bg-white border-t border-slate-200 flex flex-col gap-1 items-center justify-center text-center">
                    {Object.entries(data.properties).map(([key, value]) => (
                        <div key={key} className="text-[11px] text-slate-600 font-medium whitespace-nowrap overflow-hidden text-ellipsis w-full">
                            {String(value)}
                        </div>
                    ))}
                </div>
            )}
            <Handle type="target" position={Position.Left} className={style.port} />
            <Handle type="source" position={Position.Right} className={style.port} />
        </div>
    );
};
