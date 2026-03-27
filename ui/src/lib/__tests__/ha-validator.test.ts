import { describe, it, expect } from 'vitest';
import { validateArchitecture } from '../validator';
import { Registry } from '../../types';

describe('HA Validator Engine', () => {
    const mockRegistry: Registry = {
        registryName: 'Test Registry',
        version: '1.0.0',
        patterns: [
            {
                id: 'ha-api',
                name: 'HA API',
                version: '1.0.0',
                rules: [
                    {
                        id: 'ha-placement',
                        type: 'placement_redundancy',
                        scope: 'deployment',
                        severity: 'mandatory',
                        node: 'id_suffix:api',
                        constraints: [
                            { min_count: 2, groupBy: 'layer:Region' },
                            { min_count: 2, groupBy: 'layer:Datacenter', within: 'layer:Region' }
                        ]
                    },
                    {
                        id: 'gslb-topology',
                        type: 'edge_property_constraint',
                        scope: 'deployment',
                        severity: 'mandatory',
                        source: 'id_suffix:gslb',
                        target: 'id_suffix:gw',
                        groupBy: 'layer:Region',
                        enforce_group_cohesion: true,
                        group_distribution: [
                            { 
                                role: 'active', min_groups: 1, max_groups: 1, 
                                edge_property: { style: 'solid' },
                                target_node_property: { traffic_role: 'active' }
                            },
                            { 
                                role: 'passive', min_groups: 1, 
                                edge_property: { style: 'dashed' },
                                target_node_property: { traffic_role: 'passive' }
                            }
                        ]
                    }
                ]
            }
        ]
    };

    it('should validate 4-DC active-passive redundant placement across 2 regions', () => {
        const arch = {
            model: {
                relationships: [
                    { id: 'e1', sourceId: 'gslb', destinationId: 'gw1', style: 'solid' },
                    { id: 'e2', sourceId: 'gslb', destinationId: 'gw2', style: 'solid' },
                    { id: 'e3', sourceId: 'gslb', destinationId: 'gw3', style: 'dashed' },
                    { id: 'e4', sourceId: 'gslb', destinationId: 'gw4', style: 'dashed' }
                ],
                softwareSystems: []
            },
            deployment: {
                nodes: [
                    { id: 'gslb', properties: { origin_pattern: 'ha-api@1.0.0', composition_alias: 'gslb', composition_id: 'exp1' } },
                    {
                        id: 'reg1', layer: 'Region', nodes: [
                            { id: 'dc1', layer: 'Datacenter', properties: { traffic_role: 'active' }, nodes: [
                                { id: 'gw1', properties: { memberships: { exp1: 'gw' }, traffic_role: 'active' } },
                                { id: 'api1', properties: { memberships: { exp1: 'api' } } }
                            ]},
                            { id: 'dc2', layer: 'Datacenter', properties: { traffic_role: 'active' }, nodes: [
                                { id: 'gw2', properties: { memberships: { exp1: 'gw' }, traffic_role: 'active' } },
                                { id: 'api2', properties: { memberships: { exp1: 'api' } } }
                            ]}
                        ]
                    },
                    {
                        id: 'reg2', layer: 'Region', nodes: [
                            { id: 'dc3', layer: 'Datacenter', properties: { traffic_role: 'passive' }, nodes: [
                                { id: 'gw3', properties: { memberships: { exp1: 'gw' }, traffic_role: 'passive' } },
                                { id: 'api3', properties: { memberships: { exp1: 'api' } } }
                            ]},
                            { id: 'dc4', layer: 'Datacenter', properties: { traffic_role: 'passive' }, nodes: [
                                { id: 'gw4', properties: { memberships: { exp1: 'gw' }, traffic_role: 'passive' } },
                                { id: 'api4', properties: { memberships: { exp1: 'api' } } }
                            ]}
                        ]
                    }
                ]
            }
        };

        const results = validateArchitecture(arch, mockRegistry);
        if (results.length > 0) console.log('HA Test Results:', results);
        expect(results.filter(r => r.severity === 'error')).toHaveLength(0);
    });

    it('should fail if regional cohesion is breached (mixed active/passive in one region)', () => {
        const arch = {
            model: {
                relationships: [
                    { id: 'e1', sourceId: 'gslb', destinationId: 'gw1', style: 'solid' },
                    { id: 'e2', sourceId: 'gslb', destinationId: 'gw2', style: 'dashed' } // MISMATCH in Reg1
                ]
            },
            deployment: {
                nodes: [
                    { id: 'gslb', properties: { origin_pattern: 'ha-api@1.0.0', composition_alias: 'gslb', composition_id: 'exp1' } },
                    {
                        id: 'reg1', layer: 'Region', nodes: [
                            { id: 'dc1', layer: 'Datacenter', nodes: [{ id: 'gw1', properties: { memberships: { exp1: 'gw' } } }] },
                            { id: 'dc2', layer: 'Datacenter', nodes: [{ id: 'gw2', properties: { memberships: { exp1: 'gw' } } }] }
                        ]
                    }
                ]
            }
        };

        const results = validateArchitecture(arch, mockRegistry);
        expect(results.some(r => r.message.includes('mixed active/passive paths'))).toBe(true);
    });

    it('should fail if redundancy count is insufficient', () => {
        const arch = {
            model: { relationships: [] },
            deployment: {
                nodes: [
                    { id: 'gslb', properties: { origin_pattern: 'ha-api@1.0.0', composition_alias: 'gslb', composition_id: 'exp1' } },
                    {
                        id: 'reg1', layer: 'Region', nodes: [
                            { id: 'dc1', layer: 'Datacenter', nodes: [
                                { id: 'api1', properties: { memberships: { exp1: 'api' } } }
                            ]}
                        ]
                    }
                ]
            }
        };

        const results = validateArchitecture(arch, mockRegistry);
        expect(results.some(r => r.message.includes('requires api across at least 2 Regions'))).toBe(true);
    });
});
