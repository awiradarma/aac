import { describe, it, expect } from 'vitest';
import { validateArchitecture } from '../validator';

describe('Validator Engine Regression Suite', () => {
    // Mocking the loaded registry pattern catalogs
    const mockRegistry: any = {
        patterns: [
            {
                id: 'internal-api-ocp',
                version: '3.0.0',
                name: 'Internal API on OpenShift',
                c4Level: 'Container',
                composition: {
                    nodes: [
                        { id_suffix: 'api' }, // Core workload
                        { id_suffix: 'gw', widget_ref: 'api-gateway', properties: { provider: 'apigee' } },
                        { id_suffix: 'lb', widget_ref: 'local-load-balancer', properties: { provider: 'avi' } }
                    ],
                    edges: [
                        { source_suffix: 'gw', target_suffix: 'lb' },
                        { source_suffix: 'lb', target_suffix: 'api' }
                    ]
                },
                rules: [
                    {
                        id: 'secure-path-v3',
                        connectivity_assertions: [
                            {
                                to: 'id_suffix:api',
                                must_pass_through: ['id_suffix:gw', 'id_suffix:lb']
                            }
                        ]
                    }
                ]
            }
        ]
    };

    it('should throw an error when mandatory components of a macro are missing (Completeness Check)', () => {
        const ast = {
            deployment: {
                nodes: [
                    {
                        id: 'cluster',
                        type: 'DeploymentNode',
                        containerInstances: [
                            {
                                id: 'api_instance',
                                properties: {
                                    origin_pattern: 'internal-api-ocp@3.0.0',
                                    composition_alias: 'api',
                                    composition_id: 'exp1'
                                }
                            }
                        ],
                        infrastructureNodes: [
                            // Gateway manually deleted by the user!
                            { id: 'lb', properties: { origin_pattern: 'internal-api-ocp@3.0.0', composition_alias: 'lb', composition_id: 'exp1' } }
                        ]
                    }
                ]
            }
        };

        const errors = validateArchitecture(ast, mockRegistry);
        expect(errors.some(e => e.includes("mandatory component 'gw' is missing"))).toBe(true);
    });

    it('should throw an error when standardization governance properties are violated (e.g. dragging F5 instead of AVI)', () => {
        const ast = {
            deployment: {
                nodes: [
                    {
                        id: 'cluster',
                        type: 'DeploymentNode',
                        containerInstances: [
                            { id: 'api_instance', properties: { origin_pattern: 'internal-api-ocp@3.0.0', composition_alias: 'api', composition_id: 'exp1' } }
                        ],
                        infrastructureNodes: [
                            { id: 'gw', properties: { origin_pattern: 'internal-api-ocp@3.0.0', composition_alias: 'gw', composition_id: 'exp1', provider: 'apigee' } },
                            { id: 'lb', properties: { origin_pattern: 'internal-api-ocp@3.0.0', composition_alias: 'lb', composition_id: 'exp1', provider: 'f5' } } // F5 IS WRONG!
                        ]
                    }
                ]
            }
        };

        const errors = validateArchitecture(ast, mockRegistry);
        expect(errors.some(e => e.includes("Standardization Violation"))).toBe(true);
        expect(errors.some(e => e.includes("provider=avi"))).toBe(true);
    });

    it('should smartly adopt independently drawn identical resources visually mapped inside the target boundary if they perfectly match', () => {
        const ast = {
            deployment: {
                nodes: [
                    {
                        id: 'cluster',
                        type: 'DeploymentNode',
                        containerInstances: [
                            { id: 'api_instance', properties: { origin_pattern: 'internal-api-ocp@3.0.0', composition_alias: 'api', composition_id: 'exp1' } }
                        ],
                        infrastructureNodes: [
                            // LB dropped organically from Component window natively, lacks origin_pattern
                            { id: 'lb', widget_ref: 'local-load-balancer', properties: { provider: 'avi' } },
                            { id: 'gw', properties: { origin_pattern: 'internal-api-ocp@3.0.0', composition_alias: 'gw', composition_id: 'exp1', provider: 'apigee' } }
                        ]
                    }
                ]
            }
        };

        // If it creatively adopts it, it won't throw a "Missing Component" error
        const errors = validateArchitecture(ast, mockRegistry);
        expect(errors.some(e => e.includes("mandatory component 'lb' is missing"))).toBe(false);
    });

    it('should mathematically deduce regional routing and bypass external node violation assertions locally when identical twin replicas structurally exist in independent datacenters', () => {
        const ast = {
            model: {
                containers: [{ id: 'logic_api', properties: {} }],
                relationships: [
                    // Logical C4 Edge: The DC B Gateway natively targets the shared Logical API structure!
                    { sourceId: 'gw_b', destinationId: 'logic_api' },
                    // Even if DC A Gateway does too:
                    { sourceId: 'gw_a', destinationId: 'logic_api' },
                    // Internal correct pattern edges (simulated Logical Connections)
                    { sourceId: 'gw_a', destinationId: 'lb_a' }, { sourceId: 'lb_a', destinationId: 'logic_api' },
                    { sourceId: 'gw_b', destinationId: 'lb_b' }, { sourceId: 'lb_b', destinationId: 'logic_api' }
                ]
            },
            deployment: {
                nodes: [
                    {
                        id: 'datacenter_A',
                        type: 'DeploymentNode',
                        containerInstances: [
                            { id: 'api_a', containerId: 'logic_api', properties: { origin_pattern: 'internal-api-ocp@3.0.0', composition_alias: 'api', composition_id: 'exp1' } }
                        ],
                        infrastructureNodes: [
                            { id: 'gw_a', properties: { origin_pattern: 'internal-api-ocp@3.0.0', composition_alias: 'gw', composition_id: 'exp1', provider: 'apigee' } },
                            { id: 'lb_a', properties: { origin_pattern: 'internal-api-ocp@3.0.0', composition_alias: 'lb', composition_id: 'exp1', provider: 'avi' } }
                        ]
                    },
                    {
                        id: 'datacenter_B',
                        type: 'DeploymentNode',
                        // Exact same logical container deployed as a physical twin structurally unhooked from A!
                        containerInstances: [
                            { id: 'api_b', containerId: 'logic_api', properties: { origin_pattern: 'internal-api-ocp@3.0.0', composition_alias: 'api', composition_id: 'exp2' } }
                        ],
                        // Secondary region external actor that maps structurally correctly
                        infrastructureNodes: [
                            { id: 'gw_b', properties: { origin_pattern: 'internal-api-ocp@3.0.0', composition_alias: 'gw', composition_id: 'exp2', provider: 'apigee' } },
                            { id: 'lb_b', properties: { origin_pattern: 'internal-api-ocp@3.0.0', composition_alias: 'lb', composition_id: 'exp2', provider: 'avi' } }
                        ]
                    }
                ]
            }
        };

        // If the topological regionalization engine structurally fails, gw_b mathematically assaults api_a returning Cross-Contamination Bypassing Errors!
        const errors = validateArchitecture(ast, mockRegistry);
        expect(errors.some(e => e.includes("Connectivity Violation: entry 'gw_b' bypassing security"))).toBe(false);
    });
});
