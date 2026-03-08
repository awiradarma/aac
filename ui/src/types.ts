export type PatternParameter = {
    type: string;
    options?: string[];
    default?: any;
    const?: any;
};

export type PatternRule = {
    id: string;
    description: string;
    condition?: string;
    allowed_values?: Record<string, string[]>;
    else_allowed_values?: Record<string, string[]>;
    structural_assertions?: string[];
};

export type MacroExpansionNode = {
    id_suffix: string;
    type: string;
    pattern_ref: string;
    label: string;
    layer?: string;
    c4Level: string;
    properties?: Record<string, any>;
    layout_hint?: { x: number; y: number };
    property_mappings?: Record<string, string>;
};

export type MacroExpansionEdge = {
    source_suffix: string;
    target_suffix: string;
    style?: Record<string, any>;
};

export type MacroExpansion = {
    nodes: MacroExpansionNode[];
    edges: MacroExpansionEdge[];
    workload_target_suffix: string;
};

export type Pattern = {
    id: string;
    name: string;
    version: string;
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
        allowed_hierarchies?: string[];
        [key: string]: any;
    };
    capabilities?: string[];
    crossplane_mapping?: any;
    macro_expansion?: MacroExpansion;
    display_metadata?: {
        icon?: string;
        color?: string;
        category?: string;
    };
};

export type DeploymentHierarchy = {
    id: string;
    name: string;
    valid_layer_chain: string[];
};

export type Registry = {
    registryName: string;
    version: string;
    deployment_hierarchies?: DeploymentHierarchy[];
    patterns: Pattern[];
};

export type NodeData = {
    label: string;
    description?: string;
    pattern_ref: string;
    c4Level: string;
    layer?: string;
    properties: Record<string, any>;
    status?: "new" | "existing";
    icon?: string;
    color?: string;
    min_width?: number;
    min_height?: number;
};
