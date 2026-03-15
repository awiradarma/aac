/** 
 * Defines the schema parameters allowed for an architecture widget/pattern.
 * Similar to JSON-Schema, enforces parameter controls in the property panel.
 */
export type PatternParameter = {
    type: string;
    options?: string[];
    default?: any;
    const?: any;
};

/**
 * Validation rules mapping for structural or routing constraints.
 */
export type PatternRule = {
    id: string;
    description: string;
    condition?: string;
    allowed_values?: Record<string, string[]>;
    else_allowed_values?: Record<string, string[]>;
    structural_assertions?: string[];
    /** Asserts whether a graph path between 'to' passing through 'must_pass_through' is mandated */
    connectivity_assertions?: {
        to: string;
        must_pass_through: string[];
    }[];
};

/** A placeholder template for a child component generated when dropped via a Macro Expansion. */
export type MacroExpansionNode = {
    id_suffix: string; // The alias mapped across the macro (e.g. 'lb', 'cluster')
    type: string; // Canvas node type reference
    pattern_ref: string; // Underlying actual blueprint versioned ID
    label: string;
    layer?: string;
    c4Level: string;
    properties?: Record<string, any>;
    layout_hint?: { x: number; y: number };
    property_mappings?: Record<string, string>;
};

/** A preset networking path defined inside a Blueprint */
export type MacroExpansionEdge = {
    source_suffix: string;
    target_suffix: string;
    style?: Record<string, any>;
};

/** Defines composite architecture structures that spawn multiple sub-components when dropped on the canvas */
export type MacroExpansion = {
    nodes: MacroExpansionNode[];
    edges: MacroExpansionEdge[];
    workload_target_suffix: string; // Defines where generic compute drops inside this pattern should land
};

/** The unified definition of any component loaded from the Registry */
export type Pattern = {
    id: string; // e.g. "openshift-cluster-v4"
    name: string; // e.g. "OpenShift v4 Architecture"
    version: string; // SemVer
    c4Level: "System" | "Container" | "DeploymentNode" | "InfrastructureNode" | "Component";
    description?: string;
    layer?: string;
    default_width?: number;
    default_height?: number;
    min_width?: number;
    min_height?: number;
    parameters?: Record<string, PatternParameter>;
    rules?: PatternRule[];
    infrastructure_requirements?: {
        allowed_hierarchies?: string[]; // Governs legal environments (e.g. AWS vs On-Prem)
        [key: string]: any;
    };
    capabilities?: string[];
    crossplane_mapping?: any; // Infrastructure as code mapping definitions
    macro_expansion?: MacroExpansion;
    display_metadata?: {
        icon?: string;
        color?: string; // e.g. "blue", "amber", "emerald"
        category?: string; // Determines palette section (e.g. "Storage", "Compute")
    };
};

/** Legal nesting order rules (e.g., Datacenter -> Cluster -> Namespace) */
export type DeploymentHierarchy = {
    id: string;
    name: string;
    valid_layer_chain: string[];
};

export type Registry = {
    registryName: string;
    version: string;
    deployment_hierarchies?: DeploymentHierarchy[];
    patterns: Pattern[]; // All fully fetched patterns & widgets
    detectors?: any[]; // Rules for brownfield discovery engine
};

/** State shape associated with each individual node block visually rendered on the canvas */
export type NodeData = {
    label: string;
    description?: string;
    pattern_ref: string; // Link to blueprint schema
    c4Level: string;
    layer?: string;
    properties: Record<string, any>;
    status?: "new" | "existing";
    icon?: string;
    color?: string;
    min_width?: number;
    min_height?: number;
    origin_pattern?: string; // If this node was spawned from a macro expansion, track original ID
    macro_id_suffix?: string; // If this is an expanded node, what alias was it? (e.g. 'lb')
    macro_expansion_id?: string; // The specific drop session ID to group expanded components together
    memberships?: Record<string, string>; // Sub-graph relationships if adopted by multiple patterns (expansionId -> suffix)
};
