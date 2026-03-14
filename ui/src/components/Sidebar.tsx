import React from 'react';
import { getRegistry } from '../lib/registry';
import * as LucideIcons from 'lucide-react';
import { Box, X } from 'lucide-react';

const DynamicIcon = ({ name, className }: { name?: string, className?: string }) => {
    if (!name) return <Box className={className} />;
    const Icon = (LucideIcons as any)[name];
    if (!Icon) return <Box className={className} />;
    return <Icon className={className} />;
};

interface Props {
    onAddPattern?: (nodeType: string, patternId: string, version: string) => void;
    onClose?: () => void;
}

export const Sidebar: React.FC<Props> = ({ onAddPattern, onClose }) => {
    const onDragStart = (event: React.DragEvent, nodeType: string, patternId: string, version: string) => {
        event.dataTransfer.setData('application/reactflow', nodeType);
        event.dataTransfer.setData('application/patternId', patternId);
        event.dataTransfer.setData('application/patternVersion', version);
        event.dataTransfer.effectAllowed = 'move';
    };

    const patterns = getRegistry().patterns;
    const categories: Record<string, any[]> = {};

    patterns.forEach(p => {
        const cat = p.display_metadata?.category || p.c4Level;
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(p);
    });

    // Define preferred order for standard categories
    const order = ['DeploymentNode', 'InfrastructureNode', 'Container', 'Component'];
    const sortedCategories = Object.keys(categories).sort((a, b) => {
        const idxA = order.indexOf(a);
        const idxB = order.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
    });

    return (
        <aside className="w-72 border-r border-slate-200 bg-white flex flex-col h-full shadow-sm">
            <div className="p-5 border-b border-slate-100 shrink-0 relative">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight pr-8">Pattern Registry</h2>
                <div className="text-xs text-slate-400 mt-1 font-medium uppercase tracking-wider">Catalog of Assets</div>
                {onClose && (
                    <button onClick={onClose} className="md:hidden absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-6">
                {sortedCategories.map(level => (
                    <div key={level}>
                        <div className="flex items-center gap-2 mb-3">
                            <div className="h-px bg-slate-100 flex-1"></div>
                            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{level}s</h3>
                            <div className="h-px bg-slate-100 flex-1"></div>
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                            {categories[level].map(pattern => (
                                <div
                                    key={`${pattern.id}-${pattern.version}`}
                                    className="px-3 py-2 bg-white border border-slate-200 rounded-lg cursor-grab hover:border-blue-400 hover:shadow-md hover:-translate-y-0.5 transition-all group active:cursor-grabbing flex items-center gap-3"
                                    onClick={() => {
                                        let flowType = 'workloadNode';
                                        if (pattern.c4Level === 'DeploymentNode') flowType = 'hierarchyNode';
                                        if (pattern.c4Level === 'InfrastructureNode') flowType = 'infrastructureNode';
                                        if (onAddPattern && window.innerWidth < 768) {
                                            onAddPattern(flowType, pattern.id, pattern.version);
                                        }
                                    }}
                                    onDragStart={(e) => {
                                        let flowType = 'workloadNode';
                                        if (pattern.c4Level === 'DeploymentNode') flowType = 'hierarchyNode';
                                        if (pattern.c4Level === 'InfrastructureNode') flowType = 'infrastructureNode';
                                        onDragStart(e, flowType, pattern.id, pattern.version);
                                    }}
                                    draggable
                                >
                                    <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 transition-colors ${pattern.display_metadata?.color === 'emerald' ? 'bg-emerald-50 text-emerald-600' :
                                        pattern.display_metadata?.color === 'amber' ? 'bg-amber-50 text-amber-600' :
                                            pattern.display_metadata?.color === 'purple' ? 'bg-purple-50 text-purple-600' :
                                                pattern.display_metadata?.color === 'slate' ? 'bg-slate-50 text-slate-600' :
                                                    'bg-blue-50 text-blue-600'
                                        }`}>
                                        <DynamicIcon name={pattern.display_metadata?.icon} className="w-4 h-4" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-[11px] font-bold text-slate-700 truncate leading-tight group-hover:text-blue-700 transition-colors">{pattern.name}</div>
                                        <div className="text-[9px] font-mono text-slate-400 mt-0.5 truncate uppercase">v{pattern.version}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 shrink-0">
                <div className="text-[10px] text-slate-400 text-center font-medium">Drag patterns to canvas to expand architecture</div>
            </div>
        </aside>
    );
};
