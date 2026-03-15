import { useState, useCallback, useEffect } from 'react';
import { ReactFlowProvider, useNodesState, useEdgesState } from 'reactflow';
import { Sidebar } from './components/Sidebar';
import { CanvasArea } from './components/Canvas';
import { PropertyPanel } from './components/PropertyPanel';
import type { NodeData } from './types';
import yaml from 'js-yaml';
import { initRegistry, getPatternById, getRegistry } from './lib/registry';
import { validateArchitecture } from './lib/validator';
import { detectPatterns, type DiscoveryResult } from './lib/detector';
import type { Node } from 'reactflow';
import { Download, Upload, CheckCircle, Settings2, Box, Link2, Wand2 } from 'lucide-react';

/**
 * The core Application component encapsulating the entire AaC Fabric UI.
 * Coordinates React Flow canvas interaction, property mutations, pattern discovery, 
 * and generation of valid YAML conforming to the Sovereign Fabric schemas.
 */
export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [isRegistryLoaded, setIsRegistryLoaded] = useState(false);

  // Mobile UI states
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isPropertyPanelOpen, setIsPropertyPanelOpen] = useState(false);
  const [patternToAdd, setPatternToAdd] = useState<{ type: string; patternId: string; version: string } | null>(null);
  const [linkingNodeId, setLinkingNodeId] = useState<string | null>(null);
  const [validationModal, setValidationModal] = useState<{ isOpen: boolean, type: 'success' | 'error', message: string }>({ isOpen: false, type: 'success', message: '' });
  const [discoveryResults, setDiscoveryResults] = useState<DiscoveryResult[] | null>(null);

  useEffect(() => {
    if ((selectedNodeId || selectedEdgeId) && window.innerWidth < 768) {
      setIsPropertyPanelOpen(true);
    }
  }, [selectedNodeId, selectedEdgeId]);

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

  /**
   * Generates the structured architecture YAML representation conforming to the 
   * C4/Structurizr hierarchical schema (e.g., deployments nested under datacenters)
   */
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
    console.log("handleValidate called");
    try {
      const structurizrAst = generateYamlObj();
      console.log("AST generated:", structurizrAst);
      const errors = validateArchitecture(structurizrAst, getRegistry() as any);
      console.log("Validation errors:", errors);

      if (errors.length > 0) {
        setValidationModal({
          isOpen: true,
          type: 'error',
          message: "⚠️ Architecture Validation Failed:\n\n" + errors.map(e => "• " + e).join("\n")
        });
      } else {
        setValidationModal({
          isOpen: true,
          type: 'success',
          message: "✅ Architecture Valid!\n\nAll constraints and placement boundaries conform to the Pattern Registry."
        });
      }
    } catch (e: any) {
      console.error("Error in handleValidate:", e);
      setValidationModal({
        isOpen: true,
        type: 'error',
        message: "❌ An unexpected error occurred during validation:\n\n" + e.message
      });
    }
  };

  const handleDiscover = () => {
    try {
      const ast = generateYamlObj();
      const results = detectPatterns(ast, getRegistry());
      setDiscoveryResults(results);
    } catch (e: any) {
      console.error("Discovery error:", e);
      setValidationModal({
        isOpen: true,
        type: 'error',
        message: "❌ Error during pattern discovery:\n\n" + e.message
      });
    }
  };

  const applyDiscoveries = (results: DiscoveryResult[]) => {
    if (results.length === 0) return;

    setNodes(nds => {
      let nextNodes = [...nds];
      results.forEach((res, i) => {
        const expId = `auto-exp-${Date.now()}-${i}`;

        Object.entries(res.matchedNodes).forEach(([alias, matchedNode]) => {
          // Find the exact react-flow node ID using the flat AST id
          const targetId = matchedNode.id;

          nextNodes = nextNodes.map(n => {
            if (n.id === targetId || (n.type === 'workloadNode' && (n as any)._logicalContainerId === targetId)) {
              return {
                ...n,
                data: {
                  ...n.data,
                  origin_pattern: res.targetPattern, // Technically origin_pattern only needs to be on one node, but fine here
                  macro_expansion_id: expId,
                  macro_id_suffix: alias,
                  memberships: {
                    ...(n.data.memberships || {}),
                    [expId]: alias
                  }
                }
              };
            }
            return n;
          });
        });
      });
      return nextNodes;
    });

    setDiscoveryResults(null);
    setValidationModal({
      isOpen: true,
      type: 'success',
      message: `✅ Successfully applied ${results.length} discovered pattern(s)! Click Validate Design to check for gaps.`
    });
  };

  if (!isRegistryLoaded) {
    return <div className="flex h-screen items-center justify-center font-bold text-xl text-slate-600">Loading Registry...</div>;
  }

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-slate-50 font-sans">
      <header className="h-14 bg-slate-900 flex items-center justify-between px-4 sm:px-6 text-white shrink-0 shadow-md relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-500 rounded-md flex items-center justify-center font-bold text-lg shadow-inner">
            A
          </div>
          <h1 className="text-xl font-bold tracking-tight hidden sm:block">Sovereign AaC Fabric</h1>
          <h1 className="text-xl font-bold tracking-tight sm:hidden">AaC</h1>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={handleDiscover}
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold rounded-md shadow transition-colors flex items-center gap-2"
          >
            <Wand2 className="w-4 h-4" />
            <span className="hidden sm:inline">Auto-Detect</span>
          </button>
          <button
            type="button"
            onClick={handleValidate}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold rounded-md shadow transition-colors flex items-center gap-2"
          >
            <CheckCircle className="w-4 h-4" />
            <span className="hidden sm:inline">Validate Design</span>
          </button>

          <div className="w-px h-6 bg-slate-700 mx-1 sm:mx-2 hidden sm:block"></div>

          <label className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-sm font-semibold rounded-md shadow transition-colors cursor-pointer flex items-center gap-2">
            <Upload className="w-4 h-4 text-slate-300" />
            <span className="hidden sm:inline">Import</span>
            <input type="file" accept=".yaml,.yml" className="hidden" onChange={handleImportYaml} />
          </label>
          <button
            onClick={handleExportYaml}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-sm font-semibold rounded-md shadow transition-colors flex items-center gap-2"
          >
            <Download className="w-4 h-4 text-slate-300" />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </header>

      <main className="flex-1 w-full flex overflow-hidden relative">
        <ReactFlowProvider>
          {/* Mobile Overlay Scrims */}
          {isSidebarOpen && (
            <div className="fixed inset-0 bg-slate-900/40 z-40 md:hidden backdrop-blur-sm" onClick={() => setIsSidebarOpen(false)} />
          )}
          {isPropertyPanelOpen && (
            <div className="fixed inset-0 bg-slate-900/40 z-40 md:hidden backdrop-blur-sm" onClick={() => setIsPropertyPanelOpen(false)} />
          )}

          <div className={`fixed inset-y-0 left-0 z-50 transform bg-white transition-transform duration-300 md:relative md:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
            <Sidebar
              onAddPattern={(type, id, version) => {
                setPatternToAdd({ type, patternId: id, version });
                setIsSidebarOpen(false);
              }}
              onClose={() => setIsSidebarOpen(false)}
            />
          </div>

          <CanvasArea
            nodes={nodes}
            edges={edges}
            setNodes={setNodes}
            setEdges={setEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            patternToAdd={patternToAdd}
            onPatternAdded={() => setPatternToAdd(null)}
            onNodeSelect={(n) => {
              if (linkingNodeId) {
                if (n && n.id !== linkingNodeId) {
                  const newEdge = {
                    id: `e-${linkingNodeId}-${n.id}-${Date.now()}`,
                    source: linkingNodeId,
                    target: n.id,
                    animated: true,
                    zIndex: 5000,
                    style: { strokeWidth: 3, stroke: '#64748b' },
                    data: { label: 'Uses', technology: '' }
                  };
                  setEdges(eds => [...eds, newEdge]);
                }
                setLinkingNodeId(null);
                setSelectedNodeId(n?.id || null);
                setSelectedEdgeId(null);
                return;
              }
              setSelectedNodeId(n?.id || null);
              setSelectedEdgeId(null);
            }}
            onEdgeSelect={(e) => { setSelectedEdgeId(e?.id || null); setSelectedNodeId(null); }}
            selectedNodeId={selectedNodeId}
          />

          <div className={`fixed inset-y-0 right-0 w-80 max-w-[85vw] z-50 transform bg-white transition-transform duration-300 md:w-auto md:max-w-none md:relative md:translate-x-0 ${isPropertyPanelOpen ? 'translate-x-0' : 'translate-x-full'}`}>
            <PropertyPanel
              selectedNode={selectedNode}
              selectedEdge={selectedEdge}
              onUpdateNodeData={handleUpdateNodeData}
              onUpdateEdgeData={handleUpdateEdgeData}
              onClose={() => setIsPropertyPanelOpen(false)}
            />
          </div>

          {/* Floating Action Buttons for Mobile */}
          <div className="md:hidden absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 z-[100] pointer-events-auto">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="flex items-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg font-semibold text-sm transition-transform active:scale-95"
            >
              <Box className="w-5 h-5" />
              Patterns
            </button>
            {(selectedNode || selectedEdge) && (
              <button
                onClick={() => setIsPropertyPanelOpen(true)}
                className="flex items-center justify-center w-12 h-12 bg-slate-800 hover:bg-slate-700 text-white rounded-full shadow-lg transition-transform active:scale-95"
              >
                <Settings2 className="w-5 h-5" />
              </button>
            )}
            {selectedNode && (
              <button
                onClick={() => setLinkingNodeId(linkingNodeId === selectedNode.id ? null : selectedNode.id)}
                className={`flex items-center justify-center w-12 h-12 rounded-full shadow-lg transition-transform active:scale-95 ${linkingNodeId === selectedNode.id ? 'bg-amber-500 hover:bg-amber-600' : 'bg-slate-800 hover:bg-slate-700'} text-white`}
              >
                <Link2 className="w-5 h-5" />
              </button>
            )}
          </div>

          {linkingNodeId && (
            <div className="md:hidden absolute bottom-24 left-1/2 -translate-x-1/2 bg-amber-500 text-white px-4 py-2 rounded-lg shadow-md font-semibold text-sm whitespace-nowrap z-[100] pointer-events-none animate-pulse">
              Tap target node to connect!
            </div>
          )}
        </ReactFlowProvider>

        {/* Validation Modal Overlay */}
        {validationModal.isOpen && (
          <div className="fixed inset-0 bg-slate-900/60 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <div className={`p-4 border-b flex items-center justify-between ${validationModal.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-red-50 border-red-100 text-red-800'}`}>
                <h3 className="font-bold text-lg">Architecture Validation</h3>
                <button
                  onClick={() => setValidationModal(prev => ({ ...prev, isOpen: false }))}
                  className="p-1 hover:bg-black/5 rounded-md transition-colors"
                  type="button"
                >
                  ✕
                </button>
              </div>
              <div className="p-6 overflow-y-auto whitespace-pre-wrap text-sm text-slate-700 bg-white">
                {validationModal.message}
              </div>
              <div className="p-4 border-t bg-slate-50 flex justify-end">
                <button
                  type="button"
                  onClick={() => setValidationModal(prev => ({ ...prev, isOpen: false }))}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold rounded-md shadow transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Discovery Modal Overlay */}
        {discoveryResults !== null && (
          <div className="fixed inset-0 bg-slate-900/60 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <div className="p-4 border-b bg-indigo-50 border-indigo-100 flex items-center justify-between text-indigo-900">
                <div className="flex items-center gap-2">
                  <Wand2 className="w-5 h-5" />
                  <h3 className="font-bold text-lg">Pattern Discovery Results</h3>
                </div>
                <button
                  onClick={() => setDiscoveryResults(null)}
                  className="p-1 hover:bg-indigo-100 rounded-md transition-colors"
                  type="button"
                >
                  ✕
                </button>
              </div>
              <div className="p-6 overflow-y-auto bg-white flex-1 flex flex-col gap-4">
                {discoveryResults.length === 0 ? (
                  <div className="text-center text-slate-500 py-8">
                    No new patterns detected in the current architecture graph.
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-slate-600 mb-2">We analyzed your architecture and found {discoveryResults.length} known pattern(s). Would you like to adopt them and enforce their validation rules?</p>
                    {discoveryResults.map((res, i) => (
                      <div key={i} className="border border-slate-200 rounded-lg p-4 bg-slate-50 relative">
                        <h4 className="font-semibold text-slate-800 mb-1">{res.detectorName}</h4>
                        <div className="text-xs font-mono text-slate-500 mb-3 bg-slate-200 px-2 py-1 rounded w-fit">{res.targetPattern}</div>
                        <div className="flex flex-col gap-1">
                          {Object.entries(res.matchedNodes).map(([alias, n]) => (
                            <div key={alias} className="text-sm flex items-center gap-2">
                              <span className="font-semibold text-indigo-600 min-w-[80px] text-right">{alias}</span>
                              <span className="text-slate-400">→</span>
                              <span className="truncate" title={n.name || n.id}>{n.name || n.id}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
              <div className="p-4 border-t bg-slate-50 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setDiscoveryResults(null)}
                  className="px-4 py-2 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-md transition-colors"
                >
                  Cancel
                </button>
                {discoveryResults.length > 0 && (
                  <button
                    type="button"
                    onClick={() => applyDiscoveries(discoveryResults)}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-md shadow transition-colors flex items-center gap-2"
                  >
                    <Wand2 className="w-4 h-4" />
                    Apply Discovered Patterns
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
