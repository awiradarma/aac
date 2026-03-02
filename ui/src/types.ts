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

export type Pattern = {
    id: string;
    name: string;
    version: string;
    c4Level: "System" | "Container" | "DeploymentNode" | "InfrastructureNode" | "Component";
    description?: string;
    type?: string;
    parameters?: Record<string, PatternParameter>;
    rules?: PatternRule[];
    infrastructure_requirements?: any;
    capabilities?: string[];
    crossplane_mapping?: any;
};

export type Registry = {
    registryName: string;
    version: string;
    patterns: Pattern[];
};

export type NodeData = {
    label: string;
    description?: string;
    pattern_ref: string;
    c4Level: string;
    properties: Record<string, any>;
    status?: "new" | "existing";
};
