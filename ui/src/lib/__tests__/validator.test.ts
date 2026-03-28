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
                    container: {
                        nodes: [
                            { id_suffix: 'api' },
                            { id_suffix: 'gw', widget_ref: 'api-gateway' },
                            { id_suffix: 'lb', widget_ref: 'local-load-balancer' }
                        ],
                        edges: [
                            { source_suffix: 'gw', target_suffix: 'lb' },
                            { source_suffix: 'lb', target_suffix: 'api' }
                        ]
                    }
                },
                rules: [
                    { id: '1', scope: 'all', severity: 'mandatory', type: 'node_existence', node: 'id_suffix:api' },
                    { id: '2', scope: 'all', severity: 'mandatory', type: 'node_existence', node: 'id_suffix:gw' },
                    { id: '3', scope: 'all', severity: 'mandatory', type: 'node_existence', node: 'id_suffix:lb' },
                    { id: 'e1', scope: 'all', severity: 'mandatory', type: 'edge_existence', source: 'id_suffix:gw', target: 'id_suffix:lb' },
                    { id: 'e2', scope: 'all', severity: 'mandatory', type: 'edge_existence', source: 'id_suffix:lb', target: 'id_suffix:api' },
                    { id: 'p1', scope: 'all', severity: 'mandatory', type: 'property_constraint', node: 'id_suffix:gw', property: 'provider', allowed_values: ['apigee'] },
                    { id: 'p2', scope: 'all', severity: 'mandatory', type: 'property_constraint', node: 'id_suffix:lb', property: 'provider', allowed_values: ['avi'] },
                    {
                        id: 'secure-path-v3',
                        scope: 'all',
                        severity: 'mandatory',
                        type: 'connectivity',
                        to: 'id_suffix:api',
                        must_pass_through: ['id_suffix:gw', 'id_suffix:lb']
                    }
                ]
            },
            {
                id: 'point-to-point-messaging',
                version: '1.0.0',
                name: 'Point-to-Point Messaging',
                c4Level: 'Container',
                composition: {
                    container: {
                        nodes: [
                            { id_suffix: 'producer', widget_ref: 'executable@1.0.0' },
                            { id_suffix: 'queue', widget_ref: 'message-queue@1.0.0' },
                            { id_suffix: 'consumer', widget_ref: 'executable@1.0.0' }
                        ],
                        edges: [
                            { source_suffix: 'producer', target_suffix: 'queue' },
                            { source_suffix: 'queue', target_suffix: 'consumer' }
                        ]
                    }
                },
                rules: [
                    { id: '1', scope: 'all', severity: 'mandatory', type: 'node_existence', node: 'id_suffix:producer' },
                    { id: '2', scope: 'all', severity: 'mandatory', type: 'node_existence', node: 'id_suffix:queue' },
                    { id: '3', scope: 'mandatory', severity: 'mandatory', type: 'node_existence', node: 'id_suffix:consumer' },
                    { id: 'e1', scope: 'all', severity: 'mandatory', type: 'edge_existence', source: 'id_suffix:producer', target: 'id_suffix:queue' },
                    { id: 'e2', scope: 'all', severity: 'mandatory', type: 'edge_existence', source: 'id_suffix:queue', target: 'id_suffix:consumer' },
                    { id: 'p1', scope: 'all', severity: 'mandatory', type: 'property_constraint', node: 'id_suffix:queue', property: 'technology', allowed_values: ['MQ'] }
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
        expect(errors.some(e => e.message.includes("is missing mandatory component 'id_suffix:gw'"))).toBe(true);
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
        expect(errors.some(e => e.message.includes("Standardization Violation"))).toBe(true);
        expect(errors.some(e => e.message.includes("provider=avi"))).toBe(true);
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
                            { id: 'lb', widget_ref: 'local-load-balancer@1.0.0', properties: { provider: 'avi' } },
                            { id: 'gw', properties: { origin_pattern: 'internal-api-ocp@3.0.0', composition_alias: 'gw', composition_id: 'exp1', provider: 'apigee' } }
                        ]
                    }
                ]
            }
        };

        // If it creatively adopts it, it won't throw a "Missing Component" error
        const errors = validateArchitecture(ast, mockRegistry);
        expect(errors.some(e => e.message.includes("mandatory component 'lb' is missing"))).toBe(false);
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
        expect(errors.some(e => e.message.includes("Connectivity Violation: entry 'gw_b' bypassing security"))).toBe(false);
    });

    it('should enforce standardization constraints on purely logical patterns like point-to-point messaging after import', () => {
        const ast = {
            model: {
                softwareSystems: [{
                    id: 'default-system',
                    name: 'Core',
                    properties: { widget_ref: 'software-system@1.0.0' },
                    containers: [
                        {
                            id: 'api-container',
                            name: 'API-Container',
                            properties: {
                                widget_ref: 'api-container@1.0.0',
                                origin_pattern: 'internal-api-ocp@3.0.0',
                                composition_alias: 'api',
                                composition_id: 'exp-iapi-1',
                                memberships: { 'exp-p2p-1': 'producer', 'exp-iapi-1': 'api' },
                                language: 'java'
                            }
                        },
                        {
                            id: 'batch-container',
                            name: 'Batch-Container',
                            properties: {
                                widget_ref: 'batch-container@1.0.0',
                                origin_pattern: 'point-to-point-messaging@1.0.0',
                                composition_alias: 'consumer',
                                composition_id: 'exp-p2p-1',
                                memberships: { 'exp-p2p-1': 'consumer' },
                                language: 'python'
                            }
                        },
                        {
                            id: 'message-queue',
                            name: 'Message-Queue',
                            properties: {
                                widget_ref: 'message-queue@1.0.0',
                                origin_pattern: 'point-to-point-messaging@1.0.0',
                                composition_alias: 'queue',
                                composition_id: 'exp-p2p-1',
                                memberships: { 'exp-p2p-1': 'queue' },
                                technology: 'kafka'  // WRONG! Pattern requires 'MQ'
                            }
                        }
                    ]
                }],
                relationships: [
                    { sourceId: 'api-container', destinationId: 'message-queue' },
                    { sourceId: 'message-queue', destinationId: 'batch-container' }
                ]
            },
            deployment: { nodes: [] }
        };

        const errors = validateArchitecture(ast, mockRegistry);
        expect(errors.some(e => e.message.includes("Standardization Violation"))).toBe(true);
        expect(errors.some(e => e.message.includes("technology=MQ"))).toBe(true);
    });

    it('should strictly throw error when a required architectural relationship is graphically completely deleted natively in the AST', () => {
        const ast = {
            model: {
                softwareSystems: [{
                    containers: [
                        { id: 'api-container', properties: { origin_pattern: 'point-to-point-messaging@1.0.0', composition_alias: 'producer', composition_id: 'exp-p2p' } },
                        { id: 'message-queue', properties: { origin_pattern: 'point-to-point-messaging@1.0.0', composition_alias: 'queue', composition_id: 'exp-p2p' } },
                        { id: 'batch-container', properties: { origin_pattern: 'point-to-point-messaging@1.0.0', composition_alias: 'consumer', composition_id: 'exp-p2p' } }
                    ]
                }],
                relationships: [
                    { sourceId: 'api-container', destinationId: 'message-queue' }
                    // MISSING relationship from queue -> consumer
                ]
            },
            deployment: { nodes: [] }
        };

        const errors = validateArchitecture(ast, mockRegistry);
        expect(errors.some(e => e.message.includes("is missing mandatory connection from 'id_suffix:queue' to 'id_suffix:consumer'"))).toBe(true);
    });

    it('should strictly throw error when a required architectural node is graphically completely deleted natively in the AST', () => {
        const ast = {
            model: {
                softwareSystems: [{
                    containers: [
                        { id: 'api-container', properties: { origin_pattern: 'point-to-point-messaging@1.0.0', composition_alias: 'producer', composition_id: 'exp-p2p' } },
                        { id: 'message-queue', properties: { origin_pattern: 'point-to-point-messaging@1.0.0', composition_alias: 'queue', composition_id: 'exp-p2p' } }
                        // MISSING consumer node completely
                    ]
                }],
                relationships: [
                    { sourceId: 'api-container', destinationId: 'message-queue' }
                ]
            },
            deployment: { nodes: [] }
        };

        const errors = validateArchitecture(ast, mockRegistry);
        expect(errors.some(e => e.message.includes("is missing mandatory component 'id_suffix:consumer'"))).toBe(true);
    });
});
