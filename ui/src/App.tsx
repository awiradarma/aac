import { useState, useCallback, useEffect } from 'react';
import { ReactFlowProvider, useEdgesState, applyNodeChanges, MarkerType } from 'reactflow';
import { Sidebar } from './components/Sidebar';
import { CanvasArea } from './components/Canvas';
import { PropertyPanel } from './components/PropertyPanel';
import type { NodeData, DiagramView } from './types';
import yaml from 'js-yaml';
import { initRegistry, getPatternById, getRegistry } from './lib/registry';
import { validateArchitecture } from './lib/validator';
import { detectPatterns, type DiscoveryResult } from './lib/detector';
import type { Node } from 'reactflow';
import { Download, Upload, CheckCircle, Settings2, Box, Link2, Wand2, Trash2, Edit2 } from 'lucide-react';

/**
 * The core Application component encapsulating the entire AaC Fabric UI.
 * Coordinates React Flow canvas interaction, property mutations, pattern discovery, 
 * and generation of valid YAML conforming to the Sovereign Fabric schemas.
 */

const initialNodes: Node<NodeData>[] = [
  {
    id: 'default-system',
    type: 'systemNode',
    position: { x: window.innerWidth / 2 - 150, y: window.innerHeight / 2 - 100 },
    zIndex: 5,
    style: { width: 300, height: 200 },
    data: {
      label: 'Core Software System',
      widget_ref: 'software-system@1.0.0',
      c4Level: 'SoftwareSystem',
      layer: 'SoftwareSystem',
      properties: { system_type: 'Internal System' },
      status: 'existing',
      icon: 'Server',
      color: 'slate',
      min_width: 300,
      min_height: 200,
      memberships: {}
    }
  }
];

const initialViews: DiagramView[] = [
  { id: 'default', name: 'Main System Context', type: 'SystemContext', include: ['default-system'], exclude: [], exclude_edges: [] }
];

export default function App() {
  const [nodes, setNodes] = useState<Node<NodeData>[]>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [isRegistryLoaded, setIsRegistryLoaded] = useState(false);
  const [views, setViews] = useState<DiagramView[]>(initialViews);
  const [activeViewId, setActiveViewId] = useState<string>('default');

  // Mobile UI states
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isPropertyPanelOpen, setIsPropertyPanelOpen] = useState(false);
  const [patternToAdd, setPatternToAdd] = useState<{ type: string; patternId: string; version: string } | null>(null);
  const [linkingNodeId, setLinkingNodeId] = useState<string | null>(null);
  const [validationModal, setValidationModal] = useState<{ isOpen: boolean, type: 'success' | 'error', message: string }>({ isOpen: false, type: 'success', message: '' });
  const [viewModal, setViewModal] = useState<{ isOpen: boolean, mode: 'create' | 'edit', viewId?: string }>({ isOpen: false, mode: 'create' });
  const [viewModalForm, setViewModalForm] = useState({ name: '', type: 'SystemLandscape' });
  const [discoveryResults, setDiscoveryResults] = useState<DiscoveryResult[] | null>(null);

  // Custom node changes to track per-view coordinates dynamically
  const onNodesChange = useCallback((changes: any[]) => {
    const removeChanges = changes.filter(c => c.type === 'remove');
    let finalChanges = [...changes];

    if (removeChanges.length > 0) {
      const explicitIds = new Set(removeChanges.map(c => c.id));
      let pendingDeletions = new Set([...explicitIds]);
      let sizeBefore = 0;

      while (pendingDeletions.size > sizeBefore) {
        sizeBefore = pendingDeletions.size;
        nodes.forEach(n => {
          if (n.parentNode && pendingDeletions.has(n.parentNode)) pendingDeletions.add(n.id);
          if (n.data.logical_parent_id && pendingDeletions.has(n.data.logical_parent_id)) pendingDeletions.add(n.id);
        });
      }

      const affectedViews = views.filter(v => pendingDeletions.has(v.scope_entity_id || ''));
      const includesHierarchicalNesting = Array.from(explicitIds).some(id => {
        const n = nodes.find(x => x.id === id);
        return n && (explicitIds.has(n.parentNode || '') || explicitIds.has(n.data?.logical_parent_id || ''));
      });
      const cascadingIds = Array.from(pendingDeletions).filter(id => !explicitIds.has(id));

      if (cascadingIds.length > 0 || includesHierarchicalNesting || affectedViews.length > 0) {
        const proceed = window.confirm(`Warning: You are deleting an element that contains nested architecture. This will permanently delete ${pendingDeletions.size} elements and ${affectedViews.length} views. Proceed?`);
        if (!proceed) {
          finalChanges = changes.filter(c => c.type !== 'remove');
        } else {
          if (affectedViews.length > 0) {
            if (affectedViews.some(v => v.id === activeViewId)) {
              setActiveViewId('default');
            }
            setViews(vs => vs.filter(v => !affectedViews.some(av => av.id === v.id)));
          }
          cascadingIds.forEach(id => finalChanges.push({ type: 'remove', id }));
        }
      }
    }

    if (finalChanges.length === 0) return;

    setNodes((nds) => {
      // 2. Use reactflow's utility internally
      const updatedNodes = applyNodeChanges(finalChanges, nds);

      return updatedNodes.map((n: Node, i: number) => {
        const originalNode = nds[i];
        const posChange = finalChanges.find((c: any) => c.type === 'position' && c.id === n.id);
        const isAutomatedJump = posChange && !posChange.dragging && !posChange.positionAbsolute;

        if (!isAutomatedJump && (n.position.x !== originalNode.position.x || n.position.y !== originalNode.position.y || n.style?.width !== originalNode.style?.width || n.parentNode !== originalNode.parentNode)) {
          const currentLayouts = n.data.layoutMap || {};
          return {
            ...n,
            data: {
              ...n.data,
              layoutMap: {
                ...currentLayouts,
                [activeViewId]: {
                  x: n.position.x,
                  y: n.position.y,
                  width: n.style?.width,
                  height: n.style?.height,
                  parentNode: n.parentNode
                }
              }
            }
          };
        }
        return n;
      });
    });
  }, [activeViewId, nodes, views]);

  // When activeViewId changes, swap the physical layout of all nodes to that view's saved snapshot
  useEffect(() => {
    setNodes((currentNodes) => currentNodes.map(n => {
      const layout = n.data.layoutMap?.[activeViewId];

      // Actively strip out physics dimensions when they don't apply to the active view.
      // This prevents the invisible DOM Wrapper from remaining 1000x800 pixels (which causes connection ports 
      // to route 800 pixels into thin air) when a boundary container returns back to a normal view.
      const sanitizedStyle: any = { ...n.style };
      if (!layout || !layout.width) {
        // Prevent layout strip mechanism from destroying baseline registry shapes for infrastructure structures
        if (n.type !== 'deploymentNode') {
          delete sanitizedStyle.width;
          delete sanitizedStyle.height;
        }
      } else {
        sanitizedStyle.width = layout.width;
        sanitizedStyle.height = layout.height;
      }

      if (layout) {
        return {
          ...n,
          position: { x: layout.x, y: layout.y },
          style: sanitizedStyle,
          parentNode: layout.parentNode,
          extent: layout.parentNode ? 'parent' : undefined
        };
      }

      return {
        ...n,
        style: sanitizedStyle
      };
    }));
  }, [activeViewId, setNodes]);


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
          const finalData = { ...e.data, ...newData };
          const isAnimated = finalData.styleVariant === 'animated';
          const baseStyle = e.style || { strokeWidth: 3, stroke: '#64748b' };
          let newStyle: any = { ...baseStyle };

          if (finalData.styleVariant === 'dashed') {
            newStyle.strokeDasharray = '5, 5';
            newStyle.strokeLinecap = 'square';
          } else if (finalData.styleVariant === 'dotted') {
            newStyle.strokeDasharray = '2, 5';
            newStyle.strokeLinecap = 'round';
          } else {
            delete newStyle.strokeDasharray;
            delete newStyle.strokeLinecap;
          }

          const direction = finalData.direction || 'forward';
          const drawMarker = { type: MarkerType.ArrowClosed, width: 20, height: 20, color: newStyle.stroke || '#64748b' };

          let mStart = undefined;
          let mEnd = undefined;

          if (direction === 'forward') mEnd = drawMarker;
          if (direction === 'reverse') mStart = drawMarker;
          if (direction === 'both') {
            mStart = drawMarker;
            mEnd = drawMarker;
          }

          return {
            ...e,
            animated: isAnimated,
            style: newStyle,
            markerStart: mStart,
            markerEnd: mEnd,
            data: finalData,
            label: finalData.technology ? `${finalData.label}\n[${finalData.technology}]` : finalData.label,
            labelStyle: { fill: '#475569', fontWeight: 700, fontSize: 11, whiteSpace: 'pre-wrap', textAlign: 'center' as any },
            labelBgStyle: { fill: '#f8fafc', color: '#f8fafc', fillOpacity: 0.9, stroke: '#e2e8f0', strokeWidth: 1 }
          };
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
        people: [],
        softwareSystems: [],
        containers: [],
        relationships: []
      },
      deployment: {
        nodes: []
      }
    };

    const allNodes = nodes.filter(n => n.type === 'deploymentNode' || n.type === 'infrastructureNode');
    const containerNodes = nodes.filter(n => n.type === 'containerNode');
    const componentNodes = nodes.filter(n => n.type === 'componentNode');
    const systemNodes = nodes.filter(n => n.type === 'systemNode');
    const personNodes = nodes.filter(n => n.type === 'personNode');

    const allIdMap = new Map<string, string>();
    systemNodes.forEach(n => allIdMap.set(n.id, n.id));
    personNodes.forEach(n => allIdMap.set(n.id, n.id));
    componentNodes.forEach(n => allIdMap.set(n.id, n.id));
    allNodes.forEach(n => allIdMap.set(n.id, n.id));

    // Group workloads into unique Model Containers based on widget_ref and label
    containerNodes.forEach(w => {
      const patternId = w.data.widget_ref?.split('@')[0] || 'unknown';
      const logicalId = `${patternId}-${w.data.label.replace(/\s+/g, '-')}`.toLowerCase();
      allIdMap.set(w.id, logicalId);
      (w as any)._logicalContainerId = logicalId;
    });

    const serializeLayout = (n: any) => {
      if (!n.data?.layoutMap || Object.keys(n.data.layoutMap).length === 0) return undefined;
      const outMap: any = {};
      // Stamp the live canvas geometry into the active view dynamically ensuring export boundaries always identically match physical visual topology states!
      outMap[activeViewId] = {
        x: n.position.x,
        y: n.position.y,
        width: n.style?.width,
        height: n.style?.height,
        parentNode: allIdMap.get(n.parentNode || '') || n.parentNode
      };

      for (const [viewId, layout] of Object.entries<any>(n.data.layoutMap)) {
        if (viewId === activeViewId) continue; // Already dynamically serialized natively above!
        const cleanLayout = { ...layout };
        if (cleanLayout.parentNode) cleanLayout.parentNode = allIdMap.get(cleanLayout.parentNode) || cleanLayout.parentNode;
        outMap[viewId] = cleanLayout;
      }
      return JSON.stringify(outMap);
    };

    const uniqueComponents = new Map<string, any>();
    componentNodes.forEach(c => {
      uniqueComponents.set(c.id, {
        name: c.data.label?.replace(/\s+/g, '-') || 'Unnamed-Component',
        id: c.id,
        logical_parent_id: c.data.logical_parent_id,
        properties: {
          widget_ref: c.data.widget_ref,
          status: 'new',
          aac_layout: serializeLayout(c),
          ...c.data.properties
        }
      });
      (c as any)._logicalId = c.id;
    });

    const uniqueContainers = new Map<string, any>();
    const containerIdMap = new Map<string, string>(); // React Flow ID -> Logical ID

    // Group workloads into unique Model Containers based on widget_ref and label
    containerNodes.forEach(w => {
      const patternId = w.data.widget_ref?.split('@')[0] || 'unknown';
      const logicalId = `${patternId}-${w.data.label.replace(/\s+/g, '-')}`.toLowerCase();

      if (!uniqueContainers.has(logicalId)) {
        uniqueContainers.set(logicalId, {
          name: w.data.label.replace(/\s+/g, '-'),
          id: logicalId,
          logical_parent_id: w.data.logical_parent_id,
          properties: {
            widget_ref: w.data.widget_ref,
            origin_pattern: (w.data as any).origin_pattern,
            composition_alias: (w.data as any).composition_alias,
            composition_id: (w.data as any).composition_id,
            memberships: (w.data as any).memberships,
            status: 'new',
            aac_layout: serializeLayout(w),
            ...w.data.properties
          }
        });
      }

      // Store logical ID reference for deployment mapping
      (w as any)._logicalContainerId = logicalId;
      containerIdMap.set(w.id, logicalId);
    });

    const compArr = Array.from(uniqueComponents.values());
    const containerArr = Array.from(uniqueContainers.values());

    containerArr.forEach((cont: any) => {
      const nestedComps = compArr.filter(c => containerIdMap.get(c.logical_parent_id) === cont.id || c.logical_parent_id === cont.id);
      if (nestedComps.length > 0) {
        cont.components = nestedComps.map(c => { const { logical_parent_id, ...rest } = c; return rest; });
      }
    });

    structurizr.model.people = personNodes.map(p => ({
      name: p.data.label.replace(/\s+/g, '-'),
      id: p.id,
      properties: {
        widget_ref: p.data.widget_ref,
        aac_layout: serializeLayout(p),
        ...p.data.properties
      }
    }));

    structurizr.model.softwareSystems = systemNodes.map(s => {
      const systemContainers = containerArr.filter((c: any) => c.logical_parent_id === s.id);
      const out: any = {
        name: s.data.label.replace(/\s+/g, '-'),
        id: s.id,
        properties: {
          widget_ref: s.data.widget_ref,
          aac_layout: serializeLayout(s),
          ...s.data.properties
        }
      };
      if (systemContainers.length > 0) {
        out.containers = systemContainers.map((c: any) => {
          const { logical_parent_id, ...rest } = c; // Filter out from standard DSL
          return rest;
        });
      }
      return out;
    });

    const orphanedContainers = containerArr.filter((c: any) => !c.logical_parent_id).map((c: any) => {
      const { logical_parent_id, ...rest } = c;
      return rest;
    });

    if (orphanedContainers.length > 0) {
      structurizr.model.containers = orphanedContainers;
    } else {
      delete structurizr.model.containers;
    }

    // Generate Relationships
    const relationships: any[] = [];
    const relTracker = new Set<string>();

    edges.forEach(e => {
      // Find source and target in any pool
      const sourceNode = nodes.find(n => n.id === e.source);
      const targetNode = nodes.find(n => n.id === e.target);

      if (sourceNode && targetNode) {
        let sourceLogicId = sourceNode.id;
        if (sourceNode.type === 'containerNode') sourceLogicId = (sourceNode as any)._logicalContainerId || sourceNode.id;

        let targetLogicId = targetNode.id;
        if (targetNode.type === 'containerNode') targetLogicId = (targetNode as any)._logicalContainerId || targetNode.id;

        // Map relationships uniquely between explicitly defined distinct physical edge ports!
        const relId = `${sourceLogicId}-${targetLogicId}-${e.sourceHandle || ''}-${e.targetHandle || ''}`;
        if (!relTracker.has(relId)) {
          relTracker.add(relId);
          relationships.push({
            sourceId: sourceLogicId,
            destinationId: targetLogicId,
            description: e.data?.label || 'Uses',
            technology: e.data?.technology || '',
            properties: {
              styleVariant: e.data?.styleVariant || 'solid',
              direction: e.data?.direction || 'forward',
              sourceHandle: e.sourceHandle || undefined,
              targetHandle: e.targetHandle || undefined
            }
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
            widget_ref: child.data.widget_ref,
            aac_layout: serializeLayout(child),
            origin_pattern: (child.data as any).origin_pattern,
            composition_alias: (child.data as any).composition_alias,
            composition_id: (child.data as any).composition_id,
            memberships: (child.data as any).memberships,
            status: 'new',
            ...child.data.properties
          }
        };
        const nestedNodes = buildTree(child.id);
        if (nestedNodes.length > 0) dNode.nodes = nestedNodes;

        // Find containers linked to this deployment node
        const containers = containerNodes.filter(w => w.parentNode === child.id);
        if (containers.length > 0) {
          dNode.containerInstances = containers.map(w => ({
            id: w.id, // Strictly preserve origin ID mapping mathematically seamlessly avoiding inclusion blinding
            containerId: (w as any)._logicalContainerId || w.id,
            properties: {
              widget_ref: w.data.widget_ref,
              aac_layout: serializeLayout(w),
              origin_pattern: (w.data as any).origin_pattern,
              composition_alias: (w.data as any).composition_alias,
              composition_id: (w.data as any).composition_id,
              memberships: (w.data as any).memberships,
              ...w.data.properties
            }
          }));
        }

        const infra = nodes.filter(n => n.type === 'infrastructureNode' && n.parentNode === child.id);
        if (infra.length > 0) {
          dNode.infrastructureNodes = infra.map(w => ({
            id: w.id,
            name: w.data.label.replace(/\s+/g, '-'),
            properties: {
              widget_ref: w.data.widget_ref,
              aac_layout: serializeLayout(w),
              origin_pattern: (w.data as any).origin_pattern,
              composition_alias: (w.data as any).composition_alias,
              composition_id: (w.data as any).composition_id,
              memberships: (w.data as any).memberships,
              ...w.data.properties
            }
          }));
        }

        return dNode;
      });
    };

    structurizr.deployment.nodes = buildTree(undefined);

    structurizr.views = views.map(v => {
      // 🚨 CRITICAL FIX: NEVER map visually included items via allIdMap natively!
      // If we translate a physical instance's structural ID back into its primary logical container's ID exclusively, a deployment view natively loses
      // the ability to identify and render the physical node correctly mathematically when re-importing!
      return {
        key: v.id,
        name: v.name,
        type: v.type,
        include: Array.from(new Set(v.include)), // Strongly lock exact identities seamlessly
        exclude: Array.from(new Set(v.exclude)), // Strongly lock exact exclusions seamlessly
        exclude_edges: Array.from(new Set(v.exclude_edges || [])),
        scope_entity_id: v.scope_entity_id ? (allIdMap.get(v.scope_entity_id) || v.scope_entity_id) : undefined // Scope entity safely parses logically
      };
    });
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

    // Provide the absolute mathematically flawless truth of the raw ReactFlow GUI engine arrays dynamically to assert exact offline parity
    const rawGraph = JSON.stringify({ nodes, edges, views }, null, 2);
    const blobJson = new Blob([rawGraph], { type: 'application/json' });
    const urlJson = URL.createObjectURL(blobJson);
    const aJson = document.createElement('a');
    aJson.href = urlJson;
    aJson.download = 'raw-reactflow-topology.json';
    aJson.click();
    URL.revokeObjectURL(urlJson);
  };

  const handleImportYaml = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const arch = yaml.load(content) as any;
        const importedViews = arch.views || [];
        const targetViewId = importedViews.length > 0 ? (importedViews[0].key || importedViews[0].id) : 'default';

        const newNodes: Node<NodeData>[] = [];

        const containerMap: Record<string, any> = {};
        const cNodes = arch.model?.containers || [];
        cNodes.forEach((cn: any) => { containerMap[cn.id] = cn; });

        // Add Systems and People
        const sNodes = arch.model?.softwareSystems || [];
        sNodes.forEach((sn: any) => {
          const nestedContainers = sn.containers || [];
          nestedContainers.forEach((cn: any) => {
            cn.logical_parent_id = sn.id;
            containerMap[cn.id] = cn;
          });

          const rawProps = sn.properties || {};
          const props = { ...rawProps };
          const patternId = props.widget_ref?.split('@')[0];
          const pattern = patternId ? getPatternById(patternId) : null;
          let importedLayout: any = undefined;
          if (props.aac_layout) {
            try { importedLayout = JSON.parse(props.aac_layout as string); } catch (e) { }
            delete props.aac_layout;
          }
          const widgetRef = props.widget_ref || '';
          const status = props.status || 'existing';
          delete props.widget_ref;
          delete props.status;

          newNodes.push({
            id: sn.id,
            type: 'systemNode',
            position: importedLayout?.[targetViewId] ? { x: importedLayout[targetViewId].x, y: importedLayout[targetViewId].y } : { x: Math.random() * 400 + 100, y: Math.random() * 300 + 100 },
            zIndex: 10,
            style: importedLayout?.[targetViewId]?.width ? { width: importedLayout[targetViewId].width, height: importedLayout[targetViewId].height } : undefined,
            data: {
              label: sn.name.replace(/-/g, ' '),
              widget_ref: widgetRef,
              c4Level: pattern ? pattern.c4Level : 'SoftwareSystem',
              layer: pattern?.layer,
              properties: props,
              status: status,
              icon: pattern?.display_metadata?.icon,
              color: pattern?.display_metadata?.color,
              min_width: pattern?.min_width || 300,
              min_height: pattern?.min_height || 200,
              layoutMap: importedLayout
            }
          });
        });

        const pNodes = arch.model?.people || [];
        pNodes.forEach((pn: any) => {
          const rawProps = pn.properties || {};
          const props = { ...rawProps };
          const patternId = props.widget_ref?.split('@')[0];
          const pattern = patternId ? getPatternById(patternId) : null;
          let importedLayout: any = undefined;
          if (props.aac_layout) {
            try { importedLayout = JSON.parse(props.aac_layout as string); } catch (e) { }
            delete props.aac_layout;
          }
          const widgetRef = props.widget_ref || '';
          const status = props.status || 'existing';
          delete props.widget_ref;
          delete props.status;

          newNodes.push({
            id: pn.id,
            type: 'personNode',
            position: importedLayout?.[targetViewId] ? { x: importedLayout[targetViewId].x, y: importedLayout[targetViewId].y } : { x: Math.random() * 400 + 100, y: Math.random() * 300 + 100 },
            zIndex: 10,
            style: importedLayout?.[targetViewId]?.width ? { width: importedLayout[targetViewId].width, height: importedLayout[targetViewId].height } : undefined,
            data: {
              label: pn.name.replace(/-/g, ' '),
              widget_ref: widgetRef,
              c4Level: pattern ? pattern.c4Level : 'Person',
              layer: pattern?.layer,
              properties: props,
              status: status,
              icon: pattern?.display_metadata?.icon,
              color: pattern?.display_metadata?.color,
              min_width: pattern?.min_width || 200,
              min_height: pattern?.min_height || 200,
              layoutMap: importedLayout
            }
          });
        });

        // Loop over containerMap to natively insert containers and their interior components into ReactFlow
        Object.values(containerMap).forEach((cn: any) => {
          const rawProps = cn.properties || {};
          const props = { ...rawProps };
          const patternId = props.widget_ref?.split('@')[0];
          const pattern = patternId ? getPatternById(patternId) : null;

          let importedLayout: any = undefined;
          if (props.aac_layout) {
            try { importedLayout = JSON.parse(props.aac_layout as string); } catch (e) { }
            delete props.aac_layout;
          }
          const widgetRef = props.widget_ref || '';
          const status = props.status || 'existing';
          delete props.widget_ref;
          delete props.status;

          if (!newNodes.find(n => n.id === cn.id)) { // Prevent dupes with deployments later
            newNodes.push({
              id: cn.id,
              type: 'containerNode',
              position: importedLayout?.[targetViewId] ? { x: importedLayout[targetViewId].x, y: importedLayout[targetViewId].y } : { x: Math.random() * 400 + 100, y: Math.random() * 300 + 100 },
              parentNode: cn.logical_parent_id,
              extent: cn.logical_parent_id ? 'parent' : undefined,
              zIndex: 15,
              style: importedLayout?.[targetViewId]?.width ? { width: importedLayout[targetViewId].width, height: importedLayout[targetViewId].height } : undefined,
              data: {
                label: cn.name?.replace(/-/g, ' ') || 'Container',
                widget_ref: widgetRef,
                c4Level: pattern ? pattern.c4Level : 'Container',
                layer: pattern?.layer,
                properties: props,
                status: status,
                icon: pattern?.display_metadata?.icon,
                color: pattern?.display_metadata?.color,
                min_width: pattern?.min_width || 200,
                min_height: pattern?.min_height || 150,
                logical_parent_id: cn.logical_parent_id,
                layoutMap: importedLayout
              }
            });
          }

          const nestedComponents = cn.components || [];
          nestedComponents.forEach((cmp: any) => {
            const rawCpProps = cmp.properties || {};
            const cpProps = { ...rawCpProps };
            const cpPatternId = cpProps.widget_ref?.split('@')[0];
            const cpPattern = cpPatternId ? getPatternById(cpPatternId) : null;
            let importedLayoutComp: any = undefined;
            if (cpProps.aac_layout) {
              try { importedLayoutComp = JSON.parse(cpProps.aac_layout as string); } catch (e) { }
              delete cpProps.aac_layout;
            }
            const widgetRef = cpProps.widget_ref || '';
            const status = cpProps.status || 'existing';
            delete cpProps.widget_ref;
            delete cpProps.status;

            if (!newNodes.find(n => n.id === cmp.id)) {
              newNodes.push({
                id: cmp.id,
                type: 'componentNode',
                position: importedLayoutComp?.[targetViewId] ? { x: importedLayoutComp[targetViewId].x, y: importedLayoutComp[targetViewId].y } : { x: Math.random() * 200 + 50, y: Math.random() * 200 + 50 },
                parentNode: cn.id,
                extent: 'parent',
                zIndex: 20,
                style: importedLayoutComp?.[targetViewId]?.width ? { width: importedLayoutComp[targetViewId].width, height: importedLayoutComp[targetViewId].height } : undefined,
                data: {
                  label: cmp.name?.replace(/-/g, ' ') || 'Component',
                  widget_ref: widgetRef,
                  c4Level: cpPattern ? cpPattern.c4Level : 'Component',
                  layer: cpPattern?.layer,
                  properties: cpProps,
                  status: status,
                  icon: cpPattern?.display_metadata?.icon,
                  color: cpPattern?.display_metadata?.color,
                  min_width: cpPattern?.min_width || 150,
                  min_height: cpPattern?.min_height || 100,
                  logical_parent_id: cn.id,
                  layoutMap: importedLayoutComp
                }
              });
            }
          });
        });

        const dNodes = arch.deployment?.nodes || [];
        if (importedViews.length > 0) {
          setViews(importedViews.map((v: any) => ({ id: v.key || `v-${Date.now()}`, name: v.name || 'Imported View', type: v.type || 'Container', include: v.include || ['*'], exclude: v.exclude || [], exclude_edges: v.exclude_edges || [], scope_entity_id: v.scope_entity_id })));
          setActiveViewId(importedViews[0].key || importedViews[0].id);
        } else {
          setViews([{ ...initialViews[0], include: ['*'] }]);
          setActiveViewId('default');
        }

        // Layout algorithm
        let yOffset = 50;

        const parseHierarchy = (nodeList: any[], parentId?: string, depth = 0) => {
          let internalOffsetX = 50;
          let internalOffsetY = depth === 0 ? yOffset : 80;

          nodeList.forEach((dn: any) => {
            const props = dn.properties || {};
            const patternId = props.widget_ref?.split('@')[0];
            const pattern = patternId ? getPatternById(patternId) : null;

            let nodeType = 'deploymentNode';
            if (pattern?.c4Level === 'DeploymentNode' && (pattern?.layer === 'Region' || pattern?.layer === 'Datacenter' || pattern?.id?.includes('hierarchy'))) nodeType = 'deploymentNode';
            if (pattern?.c4Level === 'InfrastructureNode') nodeType = 'infrastructureNode';
            if (pattern?.c4Level === 'Container' || pattern?.c4Level === 'Component') nodeType = 'containerNode';

            // Static sizing and offsets based on tier
            let width, height, nodeZIndex = 15;
            if (nodeType === 'deploymentNode') {
              width = pattern?.default_width || 1000;
              height = pattern?.default_height || 800;
              nodeZIndex = (depth * 5) + 5;
            }

            const newProps = { ...props };
            let importedLayout: any = undefined;
            if (newProps.aac_layout) {
              try { importedLayout = JSON.parse(newProps.aac_layout as string); } catch (e) { }
            }

            delete newProps.widget_ref;
            delete newProps.status;
            delete newProps.origin_pattern;
            delete newProps.composition_alias;
            delete newProps.composition_id;
            delete newProps.aac_layout;

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
                widget_ref: props.widget_ref || '',
                c4Level: pattern ? pattern.c4Level : 'DeploymentNode',
                layer: pattern?.layer,
                layoutMap: importedLayout || {},
                properties: newProps,
                status: props.status || 'existing',
                icon: pattern?.display_metadata?.icon,
                color: pattern?.display_metadata?.color,
                min_width: pattern?.min_width,
                min_height: pattern?.min_height,
                origin_pattern: props.origin_pattern,
                composition_alias: props.composition_alias,
                composition_id: props.composition_id,
                memberships: props.memberships || {},
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
                const cPattern = cProps.widget_ref ? getPatternById(cProps.widget_ref.split('@')[0]) : null;
                const cleanCProps = { ...cProps };
                delete cleanCProps.widget_ref;
                delete cleanCProps.origin_pattern;
                delete cleanCProps.composition_alias;
                delete cleanCProps.composition_id;

                const instanceNodeId = ci.id || `workload-${ci.containerId}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

                const ciProps = ci.properties || {};
                let importedLayoutInst: any = undefined;
                if (ciProps.aac_layout) {
                  try { importedLayoutInst = JSON.parse(ciProps.aac_layout as string); } catch (e) { }
                }

                newNodes.push({
                  id: instanceNodeId,
                  type: 'containerNode',
                  position: importedLayoutInst?.[targetViewId] ? { x: importedLayoutInst[targetViewId].x, y: importedLayoutInst[targetViewId].y } : { x: 50, y: containerY },
                  parentNode: dn.id,
                  extent: 'parent',
                  zIndex: 20,
                  data: {
                    layoutMap: importedLayoutInst || {},
                    label: cn.name.replace(/-/g, ' '),
                    widget_ref: cProps.widget_ref || '',
                    c4Level: cPattern ? cPattern.c4Level : 'Container',
                    layer: cPattern?.layer,
                    properties: cleanCProps,
                    status: cProps.status || 'existing',
                    icon: cPattern?.display_metadata?.icon,
                    color: cPattern?.display_metadata?.color,
                    min_width: cPattern?.min_width,
                    min_height: cPattern?.min_height,
                    origin_pattern: ciProps.origin_pattern || cProps.origin_pattern,
                    composition_alias: ciProps.composition_alias || cProps.composition_alias,
                    composition_id: ciProps.composition_id || cProps.composition_id,
                    memberships: ciProps.memberships || cProps.memberships || {},
                    containerId: ci.containerId,
                    logical_parent_id: cn.logical_parent_id
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
          const sources = newNodes.filter(n => n.id === r.sourceId || (n.data as any).containerId === r.sourceId);
          const blocks = newNodes.filter(n => n.id === r.destinationId || (n.data as any).containerId === r.destinationId);

          sources.forEach(sourceTarget => {
            // Regional Edge Distribution Matcher:
            // If a physical source legitimately connects globally to a Logical concept, trace regionally locally first.
            let destTarget = blocks.find(b => b.data?.composition_id === sourceTarget.data?.composition_id && sourceTarget.data?.composition_id);
            // If there's no native localized twin mapped, fallback to resolving broadly identically
            if (!destTarget && blocks.length > 0) destTarget = blocks[0];

            if (sourceTarget && destTarget) {
              const props = r.properties || {};
              const direction = props.direction || 'forward';
              const styleVariant = props.styleVariant || 'solid';
              const isAnimated = styleVariant === 'animated';

              let newStyle: any = { strokeWidth: 3, stroke: '#64748b' };
              if (styleVariant === 'dashed') {
                newStyle.strokeDasharray = '5, 5';
                newStyle.strokeLinecap = 'square';
              } else if (styleVariant === 'dotted') {
                newStyle.strokeDasharray = '2, 5';
                newStyle.strokeLinecap = 'round';
              }

              const drawMarker = { type: MarkerType.ArrowClosed, width: 20, height: 20, color: newStyle.stroke };
              let mStart = undefined;
              let mEnd = undefined;
              if (direction === 'forward') mEnd = drawMarker;
              if (direction === 'reverse') mStart = drawMarker;
              if (direction === 'both') {
                mStart = drawMarker;
                mEnd = drawMarker;
              }

              newEdges.push({
                id: `e-${sourceTarget.id}-${destTarget.id}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                source: sourceTarget.id,
                target: destTarget.id,
                sourceHandle: props.sourceHandle,
                targetHandle: props.targetHandle,
                animated: isAnimated,
                type: 'smoothstep',
                zIndex: 5000,
                markerStart: mStart,
                markerEnd: mEnd,
                style: newStyle,
                label: r.technology ? `${r.description || 'Uses'}\n[${r.technology}]` : (r.description || 'Uses'),
                labelStyle: { fill: '#475569', fontWeight: 700, fontSize: 11, whiteSpace: 'pre-wrap', textAlign: 'center' as any },
                labelBgStyle: { fill: '#f8fafc', color: '#f8fafc', fillOpacity: 0.9, stroke: '#e2e8f0', strokeWidth: 1 },
                data: {
                  label: r.description || 'Uses',
                  technology: r.technology || '',
                  styleVariant,
                  direction
                }
              });
            }
          });
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
          const logicalId = matchedNode.logicalId;

          nextNodes = nextNodes.map(n => {
            const isMatch = n.id === targetId ||
              (n.type === 'containerNode' && (n as any)._logicalContainerId === targetId) ||
              (n.type === 'containerNode' && logicalId && (n as any)._logicalContainerId === logicalId);

            if (isMatch) {
              return {
                ...n,
                data: {
                  ...n.data,
                  origin_pattern: res.targetPattern, // Technically origin_pattern only needs to be on one node, but fine here
                  composition_id: expId,
                  composition_alias: alias,
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

  const handleNavigateToScope = (nodeId: string, nodeLabel: string, targetType: string) => {
    const existingView = views.find(v => v.type === targetType && v.scope_entity_id === nodeId);
    let targetViewId = '';

    if (existingView) {
      targetViewId = existingView.id;
    } else {
      const newViewId = `v-${Date.now()}`;
      const newView: DiagramView = {
        id: newViewId,
        name: `${nodeLabel} - ${targetType}s`,
        type: targetType,
        include: [nodeId], // Only include the boundary and strictly nested children
        exclude: [],
        scope_entity_id: nodeId
      };
      setViews(vs => [...vs, newView]);
      targetViewId = newViewId;
    }

    setNodes(nds => nds.map(n => {
      if (n.id === nodeId && !n.data.layoutMap?.[targetViewId]) {
        return {
          ...n,
          data: { ...n.data, layoutMap: { ...(n.data.layoutMap || {}), [targetViewId]: { x: 50, y: 50, width: 1000, height: 800 } } }
        };
      }
      return n;
    }));

    setActiveViewId(targetViewId);
    setIsPropertyPanelOpen(false);
  };

  const activeView = views.find(v => v.id === activeViewId) || views[0];

  const allowedLevelsByView: Record<string, string[]> = {
    'SystemLandscape': ['Person', 'SoftwareSystem'],
    'SystemContext': ['Person', 'SoftwareSystem'],
    'Container': ['Person', 'SoftwareSystem', 'Container'],
    'Component': ['Person', 'SoftwareSystem', 'Container', 'Component'],
    'Deployment': ['DeploymentNode', 'InfrastructureNode', 'Container']
  };

  const hiddenSet = new Set<string>();
  nodes.forEach(n => {
    let isHidden = false;
    const allowed = allowedLevelsByView[activeView.type] || [];
    const isExplicitlyIncluded = activeView.include.includes(n.id) || (activeView.scope_entity_id ? n.data?.logical_parent_id === activeView.scope_entity_id : false);

    if (activeView.exclude.includes(n.id)) {
      isHidden = true;
    } else if (n.data?.containerId && activeView.type !== 'Deployment') {
      // Forcefully hide physical runtime replicas from polluting purely logical architecture views!
      isHidden = true;
    } else if (!allowed.includes(n.data?.c4Level) && !isExplicitlyIncluded) {
      // Enforce structural abstractions mathematically natively unless explicitly drawn in the model tree or manually included
      isHidden = true;
    } else if (!activeView.include.includes('*') && !isExplicitlyIncluded) {
      isHidden = true;
    } else if (activeView.include.includes('*') && !isExplicitlyIncluded && activeView.scope_entity_id) {
      // UX visual declutter: auto-hide components that belong to other containers
      if (activeView.type === 'Component' && n.data?.c4Level === 'Component') isHidden = true;
      if (activeView.type === 'Container' && n.data?.c4Level === 'Container') isHidden = true;
    }

    if (isHidden) hiddenSet.add(n.id);
  });

  const visibleNodes = nodes.map(n => {
    const isBoundary = (activeView.type === 'Container' || activeView.type === 'Component') && activeView.scope_entity_id === n.id;
    let safeParentNode = n.parentNode;
    if (isBoundary || (n.parentNode && hiddenSet.has(n.parentNode))) {
      safeParentNode = undefined;
    }

    const computedStyle = { ...n.style };
    if (isBoundary && !computedStyle.width) {
      // Autonomously explode un-styled boundaries back out to their C4 macroscopic geometries!
      computedStyle.width = activeView.type === 'Container' ? 1000 : 800;
      computedStyle.height = activeView.type === 'Container' ? 800 : 600;
    }

    return {
      ...n,
      hidden: hiddenSet.has(n.id),
      parentNode: safeParentNode,
      style: computedStyle,
      zIndex: isBoundary ? 0 : n.zIndex,
      data: {
        ...n.data,
        isScopedBoundary: isBoundary
      }
    };
  });

  const getVisibleAncestor = (nodeId: string): string | null => {
    if (!hiddenSet.has(nodeId)) return nodeId;
    const n = nodes.find(x => x.id === nodeId);
    if (!n) return null;
    if (n.parentNode) return getVisibleAncestor(n.parentNode);
    // CRITICAL: Prevent Physical Runtime Replicas from aggressively spawning duplicate Logic edges natively rolling up when mathematically hidden!
    if (n.data?.containerId) return null;
    if (n.data.logical_parent_id) return getVisibleAncestor(n.data.logical_parent_id);
    return null;
  };

  const visibleEdges: any[] = [];
  const edgeTracker = new Map<string, any>();

  edges.forEach(e => {
    if ((activeView.exclude_edges || []).includes(e.id)) return;

    const vSource = getVisibleAncestor(e.source);
    const vTarget = getVisibleAncestor(e.target);

    if (vSource && vTarget && vSource !== vTarget) {
      const isRolledUp = vSource !== e.source || vTarget !== e.target;
      // Synthesize a unique id if rolled up so we don't draw duplicate implicit lines
      const displayId = isRolledUp ? `rollup-${vSource}-${vTarget}` : e.id;

      const existing = edgeTracker.get(displayId);
      if (existing) {
        // Track the real constituent edge
        if (!existing.data?._underlyingEdgeIds?.includes(e.id)) {
          existing.data = { ...existing.data, _underlyingEdgeIds: [...(existing.data?._underlyingEdgeIds || []), e.id] };
        }

        // Aggregate labels if they are distinctly different
        const existingLabel = existing.data?.label || '';
        const newLabel = e.data?.label || '';
        if (newLabel && existingLabel && existingLabel !== newLabel && !existingLabel.includes(newLabel)) {
          existing.data = {
            ...existing.data,
            label: `${existingLabel} & ${newLabel}`
          };
        } else if (newLabel && !existingLabel) {
          existing.data = { ...existing.data, label: newLabel };
        }
      } else {
        const edgeToPush = {
          ...e,
          id: displayId,
          source: vSource,
          target: vTarget,
          hidden: false
        };
        // Safely clone data so we can mutate the text representation if multiple lines share this path
        edgeToPush.data = { ...(e.data || {}), _underlyingEdgeIds: [e.id] };
        edgeTracker.set(displayId, edgeToPush);
        visibleEdges.push(edgeToPush);
      }
    }
  });

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

          {/* Mobile-Friendly View Switcher */}
          <div className="flex bg-slate-800 rounded border border-slate-700 ml-2 md:hidden relative max-w-[140px]">
            <select
              value={activeViewId}
              onChange={(e) => setActiveViewId(e.target.value)}
              className="bg-transparent text-white text-xs p-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full appearance-none pr-6 z-10"
            >
              {views.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
              <svg className="w-3 h-3 fill-current" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" fillRule="evenodd"></path></svg>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 ml-4 border-l border-slate-700 pl-4 hidden md:flex">
          <select
            value={activeViewId}
            onChange={(e) => setActiveViewId(e.target.value)}
            className="bg-slate-800 text-white text-sm rounded border border-slate-700 p-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[200px]"
          >
            {views.map(v => (
              <option key={v.id} value={v.id}>{v.name} ({v.type})</option>
            ))}
          </select>
          <button
            onClick={() => {
              setViewModalForm({ name: activeView.name, type: activeView.type });
              setViewModal({ isOpen: true, mode: 'edit', viewId: activeViewId });
            }}
            className="p-1.5 text-slate-400 hover:text-white transition-colors"
            title="Edit View"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              setViewModalForm({ name: 'New View', type: 'SystemLandscape' });
              setViewModal({ isOpen: true, mode: 'create' });
            }}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-sm font-semibold text-white transition-colors whitespace-nowrap"
          >
            + View
          </button>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={handleDiscover}
            className="flex p-2 sm:px-3 sm:py-2 bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold rounded-md shadow transition-colors items-center gap-2"
            title="Auto-Detect Patterns"
          >
            <Wand2 className="w-4 h-4" />
            <span className="hidden sm:inline">Auto-Detect</span>
          </button>
          <button
            type="button"
            onClick={handleValidate}
            className="flex p-2 sm:px-3 sm:py-2 bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold rounded-md shadow transition-colors items-center gap-2"
            title="Validate Design"
          >
            <CheckCircle className="w-4 h-4" />
            <span className="hidden sm:inline">Validate Design</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (window.confirm('Are you sure you want to clear the canvas and start a new design?')) {
                setNodes(initialNodes);
                setEdges([]);
                setSelectedNodeId(null);
                setSelectedEdgeId(null);
                setViews(initialViews);
                setActiveViewId('default');
                setValidationModal({ isOpen: false, type: 'success', message: '' });
                setDiscoveryResults(null);
              }
            }}
            className="flex p-2 sm:px-3 sm:py-2 bg-red-600 hover:bg-red-500 text-sm font-semibold rounded-md shadow transition-colors items-center gap-2"
            title="Clear Canvas"
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden sm:inline">Clear Canvas</span>
          </button>

          <div className="w-px h-6 bg-slate-700 mx-1 sm:mx-2 hidden sm:block"></div>

          <label className="p-2 sm:px-3 sm:py-2 bg-slate-800 hover:bg-slate-700 text-sm font-semibold rounded-md shadow transition-colors cursor-pointer flex items-center gap-2" title="Import YAML">
            <Upload className="w-4 h-4 text-slate-300" />
            <span className="hidden sm:inline">Import</span>
            <input type="file" accept=".yaml,.yml" className="hidden" onChange={handleImportYaml} />
          </label>
          <button
            onClick={handleExportYaml}
            className="p-2 sm:px-3 sm:py-2 bg-slate-800 hover:bg-slate-700 text-sm font-semibold rounded-md shadow transition-colors flex items-center gap-2"
            title="Export YAML"
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
              activeView={activeView}
              hiddenNodes={nodes.filter(n => {
                const allowedLevelsByView: Record<string, string[]> = {
                  'SystemLandscape': ['Person', 'SoftwareSystem'],
                  'SystemContext': ['Person', 'SoftwareSystem'],
                  'Container': ['Person', 'SoftwareSystem', 'Container'],
                  'Component': ['Person', 'SoftwareSystem', 'Container', 'Component'],
                  'Deployment': ['DeploymentNode', 'InfrastructureNode', 'Container']
                };
                const allowed = allowedLevelsByView[activeView.type] || [];
                if (!allowed.includes(n.data?.c4Level)) return false; // Strictly enforce abstraction hierarchy

                const isExplicitlyIncluded = activeView.include.includes(n.id) || (activeView.scope_entity_id ? n.data?.logical_parent_id === activeView.scope_entity_id : false);

                // Unconditionally drop peer internal details before they even touch the include/exclude filters
                if (!isExplicitlyIncluded && activeView.scope_entity_id) {
                  if (activeView.type === 'Component' && n.data?.c4Level === 'Component') return false;
                  if (activeView.type === 'Container' && n.data?.c4Level === 'Container') return false;
                }

                if (activeView.exclude.includes(n.id)) return true;
                if (!activeView.include.includes('*') && !isExplicitlyIncluded) return true;
                return false;
              })}
              onRevealNode={(id: string) => {
                setViews(vs => vs.map(v => v.id === activeView.id ? { ...v, include: Array.from(new Set([...v.include, id])), exclude: v.exclude.filter(e => e !== id) } : v));
              }}
              onAddPattern={(type, id, version) => {
                setPatternToAdd({ type, patternId: id, version });
                setIsSidebarOpen(false);
              }}
              onClose={() => setIsSidebarOpen(false)}
            />
          </div>

          <CanvasArea
            activeView={activeView}
            nodes={visibleNodes}
            edges={visibleEdges}
            setNodes={(action: any) => {
              setNodes((prevNodes) => {
                const result = typeof action === 'function' ? action(prevNodes) : action;
                // Deep hook: if new nodes were added, officially append them to the active view if it is not a wildcard
                const activeV = views.find(v => v.id === activeViewId);
                const allowed = activeV ? allowedLevelsByView[activeV.type] || [] : [];

                const newIds = result.filter((n: Node) => {
                  if (prevNodes.some(p => p.id === n.id)) return false;
                  // Critical Fix: Only append to this view's whitelist if the node structurally maps to this view type!
                  return allowed.includes(n.data?.c4Level);
                }).map((n: Node) => n.id);

                if (newIds.length > 0 && activeV && !activeV.include.includes('*')) {
                  setViews(cvs => cvs.map(v => v.id === activeViewId ? { ...v, include: [...v.include, ...newIds] } : v));
                }
                return result;
              });
            }}
            setEdges={setEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            patternToAdd={patternToAdd}
            onPatternAdded={() => setPatternToAdd(null)}
            onRevealNode={(id: string) => {
              setViews(vs => vs.map(v => v.id === activeViewId ? { ...v, include: Array.from(new Set([...v.include, id])), exclude: v.exclude.filter(e => e !== id) } : v));
            }}
            onNodeSelect={(n) => {
              if (linkingNodeId) {
                if (n && n.id !== linkingNodeId) {
                  const sPort = prompt("Source port? (top, right, bottom, left)", "right") || "right";
                  const tPort = prompt("Target port? (top, right, bottom, left)", "left") || "left";

                  const newEdge = {
                    id: `e-${linkingNodeId}-${n.id}-${Date.now()}`,
                    source: linkingNodeId,
                    target: n.id,
                    sourceHandle: `source-${sPort.toLowerCase()}`,
                    targetHandle: `target-${tPort.toLowerCase()}`,
                    animated: false,
                    type: 'smoothstep',
                    zIndex: 5000,
                    markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20, color: '#64748b' },
                    style: { strokeWidth: 3, stroke: '#64748b' },
                    label: 'Uses',
                    labelStyle: { fill: '#475569', fontWeight: 700, fontSize: 11, whiteSpace: 'pre-wrap', textAlign: 'center' as any },
                    labelBgStyle: { fill: '#f8fafc', color: '#f8fafc', fillOpacity: 0.9, stroke: '#e2e8f0', strokeWidth: 1 },
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
              activeView={activeView}
              onUpdateView={(v) => setViews(vs => vs.map(existing => existing.id === v.id ? v : existing))}
              selectedNode={selectedNode}
              selectedEdge={selectedEdge}
              onUpdateNodeData={handleUpdateNodeData}
              onUpdateEdgeData={handleUpdateEdgeData}
              onNavigateToScope={handleNavigateToScope}
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
            <button
              onClick={() => {
                setViewModalForm({ name: 'New View', type: 'SystemLandscape' });
                setViewModal({ isOpen: true, mode: 'create' });
              }}
              className="flex items-center justify-center w-12 h-12 bg-slate-800 hover:bg-slate-700 text-white rounded-full shadow-lg transition-transform active:scale-95"
              title="New View"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            </button>
            <button
              onClick={() => setIsPropertyPanelOpen(true)}
              className="flex items-center justify-center w-12 h-12 bg-slate-800 hover:bg-slate-700 text-white rounded-full shadow-lg transition-transform active:scale-95"
              title={selectedNode || selectedEdge ? "Properties" : "Design Overview"}
            >
              <Settings2 className="w-5 h-5" />
            </button>
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

        {/* View Modal Overlay */}
        {viewModal.isOpen && (
          <div className="fixed inset-0 bg-slate-900/60 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <div className="p-4 border-b bg-slate-50 border-slate-100 flex items-center justify-between text-slate-800">
                <h3 className="font-bold text-lg">{viewModal.mode === 'create' ? 'Create New View' : 'Edit View'}</h3>
                <button
                  onClick={() => setViewModal({ isOpen: false, mode: 'create' })}
                  className="p-1 hover:bg-slate-200 rounded-md transition-colors"
                >
                  ✕
                </button>
              </div>
              <div className="p-6 bg-white flex flex-col gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">View Name</label>
                  <input
                    type="text"
                    value={viewModalForm.name}
                    onChange={(e) => setViewModalForm({ ...viewModalForm, name: e.target.value })}
                    className="w-full border border-slate-300 rounded-md p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g. Core Banking Container View"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Diagram Level (C4)</label>
                  <select
                    value={viewModalForm.type}
                    onChange={(e) => setViewModalForm({ ...viewModalForm, type: e.target.value })}
                    disabled={viewModalForm.type === 'Container' || viewModalForm.type === 'Component'}
                    className="w-full border border-slate-300 rounded-md p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:bg-slate-100"
                  >
                    <option value="SystemLandscape">System Landscape</option>
                    <option value="SystemContext">System Context</option>
                    <option value="Deployment">Deployment</option>
                    {viewModalForm.type === 'Container' && <option value="Container">Container (Scoped)</option>}
                    {viewModalForm.type === 'Component' && <option value="Component">Component (Scoped)</option>}
                  </select>
                  <p className="text-xs text-slate-500 mt-2">
                    {viewModalForm.type === 'Container' || viewModalForm.type === 'Component'
                      ? 'Scoped model views cannot be manually modified or created from the global dropdown. They are automatically managed by drilling down into specific elements on the canvas.'
                      : 'This dictates the available patterns and validation rules applied to the canvas.'}
                  </p>
                </div>
              </div>
              <div className="p-4 border-t bg-slate-50 flex justify-end gap-3">
                <button
                  onClick={() => setViewModal({ isOpen: false, mode: 'create' })}
                  className="px-4 py-2 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (viewModal.mode === 'create') {
                      const newId = 'v-' + Date.now();
                      setViews([...views, { id: newId, name: viewModalForm.name, type: viewModalForm.type, include: [], exclude: [] }]);
                      setActiveViewId(newId);
                    } else {
                      setViews(views.map(v => v.id === viewModal.viewId ? { ...v, name: viewModalForm.name, type: viewModalForm.type } : v));
                    }
                    setViewModal({ isOpen: false, mode: 'create' });
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-md shadow transition-colors"
                >
                  Save View
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
