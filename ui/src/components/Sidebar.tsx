import React from 'react';
import { getRegistry } from '../lib/registry';

export const Sidebar = () => {
    const onDragStart = (event: React.DragEvent, nodeType: string, patternId: string) => {
        event.dataTransfer.setData('application/reactflow', nodeType);
        event.dataTransfer.setData('application/patternId', patternId);
        event.dataTransfer.effectAllowed = 'move';
    };

    return (
        <aside className="w-64 border-r border-slate-200 bg-white p-4 h-full flex flex-col gap-4">
            <h2 className="text-lg font-bold text-slate-800">Pattern Registry</h2>
            <div className="text-sm text-slate-500 mb-2">Drag elements to the canvas</div>

            {(() => {
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

                return sortedCategories.map(level => (
                    <div key={level}>
                        <h3 className="text-sm font-semibold text-slate-700 uppercase mb-2">{level}s</h3>
                        <div className="flex flex-col gap-2">
                            {categories[level].map(pattern => (
                                <div
                                    key={pattern.id}
                                    className="p-3 bg-blue-50 border border-blue-200 rounded cursor-grab hover:bg-blue-100 transition-colors shadow-sm"
                                    onDragStart={(e) => {
                                        let flowType = 'workloadNode';
                                        if (pattern.c4Level === 'DeploymentNode') flowType = 'hierarchyNode';
                                        if (pattern.c4Level === 'InfrastructureNode') flowType = 'infrastructureNode';
                                        onDragStart(e, flowType, pattern.id);
                                    }}
                                    draggable
                                >
                                    <div className="font-medium text-slate-800">{pattern.name}</div>
                                    <div className="text-xs text-slate-500 mt-1">v{pattern.version}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                ));
            })()}
        </aside>
    );
};
