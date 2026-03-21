import { describe, it, expect } from 'vitest';
import { detectPatterns } from '../detector';

describe('Pattern Discovery Auto-Detect Engine', () => {
    const mockRegistry: any = {
        detectors: [
            {
                id: 'detect-internal-api-v3',
                target_pattern: 'internal-api-ocp@3.0.0',
                conditions: [
                    { node_match: { alias: 'api', c4Level: 'Container' } },
                    { node_match: { alias: 'lb', widget_ref: 'local-load-balancer' } },
                    { node_match: { alias: 'gw', widget_ref: 'api-gateway' } },
                    { node_match: { alias: 'cluster', widget_ref: 'openshift-cluster-v4' } },
                    { node_match: { alias: 'datacenter', widget_ref: 'datacenter' } },
                    { relationship: { type: 'hosted_on', source: 'api', target: 'cluster' } },
                    { relationship: { type: 'hosted_on', source: 'gw', target: 'datacenter' } },
                    { relationship: { type: 'hosted_on', source: 'lb', target: 'datacenter' } }
                ]
            }
        ]
    };

    it('should precisely combine discrete primitives mapped via geometric containment hierarchies into identified blueprints (Subgraph Isomorphism check)', () => {
        const ast = {
            model: {
                containers: [
                    { id: 'logic_api', widget_ref: 'api-container' }
                ]
            },
            deployment: {
                nodes: [
                    {
                        id: 'dc1',
                        type: 'DeploymentNode',
                        properties: { widget_ref: 'datacenter@1.0.0' },
                        infrastructureNodes: [
                            // Placed natively on the datacenter geometry canvas!
                            { id: 'lb1', properties: { widget_ref: 'local-load-balancer@2.0.0' } },
                            { id: 'gw1', properties: { widget_ref: 'api-gateway@2.0.0' } }
                        ],
                        nodes: [
                            {
                                id: 'cluster1',
                                type: 'DeploymentNode',
                                properties: { widget_ref: 'openshift-cluster-v4@4.12.0' },
                                containerInstances: [
                                    // Placed inside the OpenShift Cluster
                                    { id: 'api1', containerId: 'logic_api' }
                                ]
                            }
                        ]
                    }
                ]
            }
        };

        const results = detectPatterns(ast, mockRegistry);
        expect(results.length).toBe(1);
        expect(results[0].targetPattern).toBe('internal-api-ocp@3.0.0');
        expect(Object.keys(results[0].matchedNodes)).toEqual(expect.arrayContaining(['api', 'lb', 'gw', 'cluster', 'datacenter']));
    });

    it('should fail cleanly if the required placement constraints are visually breached by user error', () => {
        const ast = {
            model: { containers: [{ id: 'logic_api' }] },
            deployment: {
                nodes: [
                    {
                        id: 'dc1', type: 'DeploymentNode', properties: { widget_ref: 'datacenter@1.0.0' },
                        infrastructureNodes: [{ id: 'gw1', properties: { widget_ref: 'api-gateway@2.0.0' } }],
                        nodes: [
                            {
                                id: 'cluster1', type: 'DeploymentNode', properties: { widget_ref: 'openshift-cluster-v4@1.0' },
                                containerInstances: [{ id: 'api1', containerId: 'logic_api' }]
                            }
                        ]
                    },
                    // The user accidentally dropped the LB entirely outside the Datacenter bounding box into empty space!
                    {
                        id: 'floating_lb', type: 'InfrastructureNode', properties: { widget_ref: 'local-load-balancer@2.0' }
                    }
                ]
            }
        };

        // It should mathematically refuse to detect it because `lb` is NOT topologically inside `datacenter`!
        const results = detectPatterns(ast, mockRegistry);
        expect(results.length).toBe(0);
    });

    it('should mathematically trace containers natively grouped under SoftwareSystems to prevent invisible un-adoption bugs', () => {
        const ast = {
            model: {
                softwareSystems: [
                    {
                        containers: [
                            // The engine must traverse deeply to populate ContainerMap!
                            { id: 'deep_logic_api', widget_ref: 'api-container' }
                        ]
                    }
                ]
            },
            deployment: {
                nodes: [
                    {
                        id: 'dc1', type: 'DeploymentNode', properties: { widget_ref: 'datacenter' },
                        infrastructureNodes: [
                            { id: 'lb1', properties: { widget_ref: 'local-load-balancer' } },
                            { id: 'gw1', properties: { widget_ref: 'api-gateway' } }
                        ],
                        nodes: [
                            {
                                id: 'cluster1', type: 'DeploymentNode', properties: { widget_ref: 'openshift-cluster-v4' },
                                containerInstances: [
                                    { id: 'api1', containerId: 'deep_logic_api' } // References the system-nested container!
                                ]
                            }
                        ]
                    }
                ]
            }
        };

        const results = detectPatterns(ast, mockRegistry);
        expect(results.length).toBe(1); // Caught the bug from before perfectly!
    });
});
