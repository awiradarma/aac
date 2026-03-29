import { describe, it, expect } from 'vitest';
import { validateArchitecture } from '../validator';
import type { Registry } from '../../types';

describe('Global HA API (Active-Passive) Logic Tests', () => {
    const mockRegistry: Registry = {
        registryName: 'Production Registry',
        version: '1.0.0',
        patterns: [
            {
                id: 'ha-api-active-passive',
                name: 'Global HA API (Active-Passive)',
                version: '1.0.0',
                rules: [
                    {
                        id: 'api-enterprise-ha',
                        type: 'placement_redundancy',
                        scope: 'deployment',
                        severity: 'mandatory',
                        node: "id_suffix:api",
                        constraints: [
                            { min_count: 2, groupBy: "layer:Region" },
                            { min_count: 2, groupBy: "layer:Datacenter", within: "layer:Region" },
                            { total_count: 4, groupBy: "layer:Datacenter" }
                        ]
                    },
                    {
                        id: 'gslb-group-alignment',
                        type: 'edge_property_constraint',
                        scope: 'deployment',
                        severity: 'mandatory',
                        source: "id_suffix:gslb",
                        target: "id_suffix:gw",
                        groupBy: "layer:Region",
                        enforce_group_cohesion: true,
                        group_distribution: [
                            { role: 'active', min_groups: 1, max_groups: 1, edge_property: { style: 'solid' }, target_node_property: { traffic_role: 'active' } },
                            { role: 'passive', min_groups: 1, edge_property: { style: 'dashed' }, target_node_property: { traffic_role: 'passive' } }
                        ]
                    }
                ]
            }
        ]
    };

    it('should PASS for a perfect 4-DC expansion across 2 regions', () => {
        const arch = {
            model: {
                relationships: [
                    { id: 'e1', sourceId: 'gslb', destinationId: 'gw1', style: 'solid' },
                    { id: 'e2', sourceId: 'gslb', destinationId: 'gw2', style: 'solid' },
                    { id: 'e3', sourceId: 'gslb', destinationId: 'gw3', style: 'dashed' },
                    { id: 'e4', sourceId: 'gslb', destinationId: 'gw4', style: 'dashed' }
                ]
            },
            deployment: {
                nodes: [
                    { id: 'gslb', properties: { origin_pattern: 'ha-api-active-passive@1.0.0', composition_alias: 'gslb', composition_id: 'exp1' } },
                    {
                        id: 'reg1', layer: 'Region', nodes: [
                            { id: 'dc1', layer: 'Datacenter', properties: { traffic_role: 'active' }, nodes: [
                                { id: 'gw1', properties: { memberships: { exp1: 'gw-1' }, traffic_role: 'active' } },
                                { id: 'api1', properties: { memberships: { exp1: 'api-1' } } }
                            ]},
                            { id: 'dc2', layer: 'Datacenter', properties: { traffic_role: 'active' }, nodes: [
                                { id: 'gw2', properties: { memberships: { exp1: 'gw-2' }, traffic_role: 'active' } },
                                { id: 'api2', properties: { memberships: { exp1: 'api-2' } } }
                            ]}
                        ]
                    },
                    {
                        id: 'reg2', layer: 'Region', nodes: [
                            { id: 'dc3', layer: 'Datacenter', properties: { traffic_role: 'passive' }, nodes: [
                                { id: 'gw3', properties: { memberships: { exp1: 'gw-3' }, traffic_role: 'passive' } },
                                { id: 'api3', properties: { memberships: { exp1: 'api-3' } } }
                            ]},
                            { id: 'dc4', layer: 'Datacenter', properties: { traffic_role: 'passive' }, nodes: [
                                { id: 'gw4', properties: { memberships: { exp1: 'gw-4' }, traffic_role: 'passive' } },
                                { id: 'api4', properties: { memberships: { exp1: 'api-4' } } }
                            ]}
                        ]
                    }
                ]
            }
        };

        const results = validateArchitecture(arch, mockRegistry);
        expect(results.filter(r => r.severity === 'error')).toHaveLength(0);
    });

    it('should FAIL if one region is missing API nodes', () => {
        const arch = {
            deployment: {
                nodes: [
                    { id: 'gslb', properties: { origin_pattern: 'ha-api-active-passive@1.0.0', composition_alias: 'gslb', composition_id: 'exp1' } },
                    {
                        id: 'reg1', layer: 'Region', nodes: [
                            { id: 'dc1', layer: 'Datacenter', nodes: [{ id: 'api1', properties: { memberships: { exp1: 'api-1' } } }]}
                        ]
                    }
                ]
            }
        };

        const results = validateArchitecture(arch, mockRegistry);
        const errors = results.filter(r => r.severity === 'error');
        expect(errors.some(e => e.message.includes('requires api across at least 2 Regions'))).toBe(true);
    });

    it('should FAIL if a region does not have at least 2 Datacenters with API', () => {
        const arch = {
            deployment: {
                nodes: [
                    { id: 'gslb', properties: { origin_pattern: 'ha-api-active-passive@1.0.0', composition_alias: 'gslb', composition_id: 'exp1' } },
                    {
                        id: 'reg1', layer: 'Region', nodes: [
                            { id: 'dc1', layer: 'Datacenter', nodes: [
                                { id: 'api1', isInstance: true, properties: { memberships: { exp1: 'api' }, composition_id: 'exp1' } }
                            ]}
                        ]
                    },
                    {
                        id: 'reg2', layer: 'Region', nodes: [
                            { id: 'dc2', layer: 'Datacenter', nodes: [
                                { id: 'api2', isInstance: true, properties: { memberships: { exp1: 'api' }, composition_id: 'exp1' } }
                            ]}
                        ]
                    }
                ]
            }
        };

        const results = validateArchitecture(arch, mockRegistry);
        const errors = results.filter(r => r.severity === 'error');
        expect(errors.some(e => e.message.includes('must contain at least 2 Datacenters'))).toBe(true);
    });

    it('should FAIL if traffic role is mismatched (Active edge to Passive node)', () => {
        const arch = {
            model: {
                relationships: [
                    { id: 'e1', sourceId: 'gslb', destinationId: 'gw1', properties: { styleVariant: 'solid' } } // solid = active
                ]
            },
            deployment: {
                nodes: [
                    { id: 'gslb', properties: { origin_pattern: 'ha-api-active-passive@1.0.0', composition_alias: 'gslb', composition_id: 'exp1' } },
                    {
                        id: 'reg1', layer: 'Region', nodes: [
                            { id: 'dc1', layer: 'Datacenter', properties: { traffic_role: 'passive' }, nodes: [ // passive node
                                { id: 'gw1', properties: { memberships: { exp1: 'gw' }, traffic_role: 'passive', composition_id: 'exp1' } }
                            ]}
                        ]
                    }
                ]
            }
        };

        const results = validateArchitecture(arch, mockRegistry);
        const errors = results.filter(r => r.severity === 'error');
        expect(errors.some(e => e.message.includes('expected at least 1 active groups, found 0'))).toBe(true);
    });
});
