import { useState, useCallback, useEffect } from 'react';
import { ReactFlowProvider, useNodesState, useEdgesState } from 'reactflow';
import { Sidebar } from './components/Sidebar';
import { CanvasArea } from './components/Canvas';
import { PropertyPanel } from './components/PropertyPanel';
import type { NodeData } from './types';
import yaml from 'js-yaml';
import { initRegistry, getPatternById, getRegistry } from './lib/registry';
import { validateArchitecture } from './lib/validator';
import type { Node } from 'reactflow';

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [isRegistryLoaded, setIsRegistryLoaded] = useState(false);

  useEffect(() => {
    initRegistry('').then(() => {
      setIsRegistryLoaded(true);
    }).catch(err => {
      console.error("Failed to load registry:", err);
    });
  }, []);

  const selectedNode = nodes.find(n => n.id === selectedNodeId) || null;
  const selectedEdge = edges.find(e => e.id === selectedEdgeId) || null;

  const handleUpdateNodeData = useCallback((id: string, newData: any) => {
    setNodes(nds =>
      nds.map(n => {
        if (n.id === id) {
          return { ...n, data: { ...n.data, ...newData } };
        }
        return n;
      })
    );
  }, [setNodes]);

  const handleUpdateEdgeData = useCallback((id: string, newData: any) => {
    setEdges(eds =>
      eds.map(e => {
        if (e.id === id) {
          return { ...e, data: { ...e.data, ...newData } };
        }
        return e;
      })
    );
  }, [setEdges]);

  const generateYamlObj = () => {
    const structurizr: any = {
      model: {
        containers: [],
        relationships: []
      },
      deployment: {
        nodes: []
      }
    };

    const allNodes = nodes.filter(n => n.type === 'hierarchyNode' || n.type === 'hostNode' || n.type === 'infrastructureNode');
    const workloadNodes = nodes.filter(n => n.type === 'workloadNode');

    const uniqueContainers = new Map<string, any>();

    // Group workloads into unique Model Containers based on pattern_ref and label
    workloadNodes.forEach(w => {
      const patternId = w.data.pattern_ref?.split('@')[0] || 'unknown';
      const logicalId = `${patternId}-${w.data.label.replace(/\s+/g, '-')}`.toLowerCase();

      if (!uniqueContainers.has(logicalId)) {
        uniqueContainers.set(logicalId, {
          name: w.data.label.replace(/\s+/g, '-'),
          id: logicalId,
          properties: {
            pattern_ref: w.data.pattern_ref,
            origin_pattern: (w.data as any).origin_pattern,
            macro_id_suffix: (w.data as any).macro_id_suffix,
            macro_expansion_id: (w.data as any).macro_expansion_id,
            status: 'new',
            ...w.data.properties
          }
        });
      }

      // Store logical ID reference for deployment mapping
      (w as any)._logicalContainerId = logicalId;
    });

    structurizr.model.containers = Array.from(uniqueContainers.values());

    // Generate Relationships
    const relationships: any[] = [];
    const relTracker = new Set<string>();

    edges.forEach(e => {
      // Find source and target containers logically
      const sourceNode = allNodes.find(n => n.id === e.source) || workloadNodes.find(n => n.id === e.source);
      const targetNode = allNodes.find(n => n.id === e.target) || workloadNodes.find(n => n.id === e.target);

      if (sourceNode && targetNode) {
        // Use logical container ID if workload, else fallback to visual id for infrastructure nodes
        const sourceLogicId = sourceNode.type === 'workloadNode' ? (sourceNode as any)._logicalContainerId : sourceNode.id;
        const targetLogicId = targetNode.type === 'workloadNode' ? (targetNode as any)._logicalContainerId : targetNode.id;

        const relId = `${sourceLogicId}-${targetLogicId}`;
        if (!relTracker.has(relId)) {
          relTracker.add(relId);
          relationships.push({
            sourceId: sourceLogicId,
            destinationId: targetLogicId,
            description: e.data?.label || 'Uses',
            technology: e.data?.technology || ''
          });
        }
      }
    });

    structurizr.model.relationships = relationships;

    const buildTree = (parentId?: string): any[] => {
      const children = allNodes.filter(n => n.parentNode === parentId);
      return children.map(child => {
        const dNode: any = {
          name: child.data.label.replace(/\s+/g, '-'),
          id: child.id,
          properties: {
            pattern_ref: child.data.pattern_ref,
            origin_pattern: (child.data as any).origin_pattern,
            macro_id_suffix: (child.data as any).macro_id_suffix,
            macro_expansion_id: (child.data as any).macro_expansion_id,
            status: 'new',
            ...child.data.properties
          }
        };
        const nestedNodes = buildTree(child.id);
        if (nestedNodes.length > 0) dNode.nodes = nestedNodes;

        // Find containers linked to this deployment node
        const containers = workloadNodes.filter(w => w.parentNode === child.id);
        if (containers.length > 0) {
          dNode.containerInstances = containers.map(w => ({
            id: w.id + '_instance',
            containerId: (w as any)._logicalContainerId,
            properties: {
              pattern_ref: w.data.pattern_ref,
              origin_pattern: (w.data as any).origin_pattern,
              macro_id_suffix: (w.data as any).macro_id_suffix,
              macro_expansion_id: (w.data as any).macro_expansion_id,
              ...w.data.properties
            }
          }));
        }
        return dNode;
      });
    };

    structurizr.deployment.nodes = buildTree(undefined);
    return structurizr;
  };

  const handleExportYaml = () => {
    const structurizr = generateYamlObj();
    const yamlStr = yaml.dump(structurizr);

    const blob = new Blob([yamlStr], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'architecture.yaml';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportYaml = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const arch = yaml.load(content) as any;

        const newNodes: Node<NodeData>[] = [];

        const containerMap: Record<string, any> = {};
        const cNodes = arch.model?.containers || [];
        cNodes.forEach((cn: any) => { containerMap[cn.id] = cn; });

        const dNodes = arch.deployment?.nodes || [];

        // Layout algorithm
        let yOffset = 50;

        const parseHierarchy = (nodeList: any[], parentId?: string, depth = 0) => {
          let internalOffsetX = 50;
          let internalOffsetY = depth === 0 ? yOffset : 80;

          nodeList.forEach((dn: any) => {
            const props = dn.properties || {};
            const patternId = props.pattern_ref?.split('@')[0];
            const pattern = patternId ? getPatternById(patternId) : null;

            let nodeType = 'hostNode';
            if (pattern?.c4Level === 'DeploymentNode' && (pattern?.layer === 'Region' || pattern?.layer === 'Datacenter' || pattern?.id?.includes('hierarchy'))) nodeType = 'hierarchyNode';
            if (pattern?.c4Level === 'InfrastructureNode') nodeType = 'infrastructureNode';
            if (pattern?.c4Level === 'Container' || pattern?.c4Level === 'Component') nodeType = 'workloadNode';

            // Static sizing and offsets based on tier
            let width, height, nodeZIndex = 15;
            if (nodeType === 'hierarchyNode') {
              width = pattern?.default_width || 1000;
              height = pattern?.default_height || 800;
              nodeZIndex = (depth * 5) + 5;
            }

            const newProps = { ...props };
            delete newProps.pattern_ref;
            delete newProps.status;
            delete newProps.origin_pattern;
            delete newProps.macro_id_suffix;
            delete newProps.macro_expansion_id;

            newNodes.push({
              id: dn.id,
              type: nodeType,
              position: { x: internalOffsetX, y: internalOffsetY },
              style: width && height ? { width, height } : undefined,
              parentNode: parentId,
              extent: parentId ? 'parent' : undefined,
              zIndex: nodeZIndex,
              data: {
                label: dn.name.replace(/-/g, ' '),
                pattern_ref: props.pattern_ref || '',
                c4Level: pattern ? pattern.c4Level : 'DeploymentNode',
                layer: pattern?.layer,
                properties: newProps,
                status: props.status || 'existing',
                icon: pattern?.display_metadata?.icon,
                color: pattern?.display_metadata?.color,
                min_width: pattern?.min_width,
                min_height: pattern?.min_height,
                origin_pattern: props.origin_pattern,
                macro_id_suffix: props.macro_id_suffix,
                macro_expansion_id: props.macro_expansion_id
              }
            });

            // Recurse children deployment nodes
            if (dn.nodes && dn.nodes.length > 0) {
              parseHierarchy(dn.nodes, dn.id, depth + 1);
            }

            // Parse container instances
            if (dn.containerInstances && dn.containerInstances.length > 0) {
              let containerY = 80;
              dn.containerInstances.forEach((ci: any) => {
                const cn = containerMap[ci.containerId];
                if (!cn) return;

                const cProps = cn.properties || {};
                const cPattern = cProps.pattern_ref ? getPatternById(cProps.pattern_ref.split('@')[0]) : null;
                const cleanCProps = { ...cProps };
                delete cleanCProps.pattern_ref;
                delete cleanCProps.origin_pattern;
                delete cleanCProps.macro_id_suffix;
                delete cleanCProps.macro_expansion_id;

                // Generate a unique node ID for the React Flow canvas to prevent collisions
                const instanceNodeId = `workload-${ci.containerId}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

                newNodes.push({
                  id: instanceNodeId,
                  type: 'workloadNode',
                  position: { x: 50, y: containerY },
                  parentNode: dn.id,
                  extent: 'parent',
                  zIndex: 20,
                  data: {
                    label: cn.name.replace(/-/g, ' '),
                    pattern_ref: cProps.pattern_ref || '',
                    c4Level: cPattern ? cPattern.c4Level : 'Container',
                    layer: cPattern?.layer,
                    properties: cleanCProps,
                    status: cProps.status || 'existing',
                    icon: cPattern?.display_metadata?.icon,
                    color: cPattern?.display_metadata?.color,
                    min_width: cPattern?.min_width,
                    min_height: cPattern?.min_height,
                    origin_pattern: cProps.origin_pattern,
                    macro_id_suffix: cProps.macro_id_suffix,
                    macro_expansion_id: cProps.macro_expansion_id
                  }
                });
                containerY += 150;
              });
            }

            internalOffsetX += 450;
          });
          yOffset += 400; // Shift down for next root level item if any
        };

        parseHierarchy(dNodes);

        const newEdges: any[] = [];
        const rels = arch.model?.relationships || [];

        rels.forEach((r: any) => {
          const sourceTarget = newNodes.find(n => n.type === 'workloadNode' && n.data.label.replace(/\s+/g, '-').toLowerCase() === (r.sourceId?.split('-').slice(1).join('-') || '')) || newNodes.find(n => n.id === r.sourceId);
          const destTarget = newNodes.find(n => n.type === 'workloadNode' && n.data.label.replace(/\s+/g, '-').toLowerCase() === (r.destinationId?.split('-').slice(1).join('-') || '')) || newNodes.find(n => n.id === r.destinationId);

          if (sourceTarget && destTarget) {
            newEdges.push({
              id: `e-${sourceTarget.id}-${destTarget.id}-${Date.now()}`,
              source: sourceTarget.id,
              target: destTarget.id,
              animated: true,
              zIndex: 5000,
              style: { strokeWidth: 3, stroke: '#64748b' },
              data: {
                label: r.description || 'Uses',
                technology: r.technology || ''
              }
            });
          }
        });

        setNodes(newNodes);
        setEdges(newEdges);
        alert('YAML imported successfully!');
      } catch (err) {
        console.error('Import error', err);
        alert('Failed to import YAML! Check the console.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const handleValidate = () => {
    const structurizrAst = generateYamlObj();
    const errors = validateArchitecture(structurizrAst, getRegistry() as any);

    if (errors.length > 0) {
      alert("⚠️ Architecture Validation Failed:\n\n" + errors.map(e => "• " + e).join("\n"));
    } else {
      alert("✅ Architecture Valid!\n\nAll constraints and placement boundaries conform to the Pattern Registry.");
    }
  };

  if (!isRegistryLoaded) {
    return <div className="flex h-screen items-center justify-center font-bold text-xl text-slate-600">Loading Registry...</div>;
  }

  return (
    <div className="flex flex-col h-screen w-full bg-slate-50 font-sans">
      <header className="h-14 bg-slate-900 flex items-center justify-between px-6 text-white shrink-0 shadow-md relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-500 rounded-md flex items-center justify-center font-bold text-lg shadow-inner">
            A
          </div>
          <h1 className="text-xl font-bold tracking-tight">Sovereign AaC Fabric</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleValidate}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold rounded-md shadow transition-colors"
          >
            Validate Design
          </button>
          <label className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-sm font-semibold rounded-md shadow transition-colors cursor-pointer ml-4 border-l border-slate-500 pl-6">
            Import YAML
            <input type="file" accept=".yaml,.yml" className="hidden" onChange={handleImportYaml} />
          </label>
          <button
            onClick={handleExportYaml}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-sm font-semibold rounded-md shadow transition-colors"
          >
            Export YAML
          </button>
        </div>
      </header>

      <main className="flex-1 w-full flex overflow-hidden">
        <ReactFlowProvider>
          <div className="flex w-full h-full">
            <Sidebar />
            <CanvasArea
              nodes={nodes}
              edges={edges}
              setNodes={setNodes}
              setEdges={setEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeSelect={(n) => { setSelectedNodeId(n?.id || null); setSelectedEdgeId(null); }}
              onEdgeSelect={(e) => { setSelectedEdgeId(e?.id || null); setSelectedNodeId(null); }}
            />
            <PropertyPanel
              selectedNode={selectedNode}
              selectedEdge={selectedEdge}
              onUpdateNodeData={handleUpdateNodeData}
              onUpdateEdgeData={handleUpdateEdgeData}
            />
          </div>
        </ReactFlowProvider>
      </main>
    </div>
  );
}
