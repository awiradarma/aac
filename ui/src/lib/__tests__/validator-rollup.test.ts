import { describe, it, expect } from 'vitest';
import { validateArchitecture } from '../validator';

describe('Validator Rollup Line Testing', () => {
    const mockRegistry: any = {
        patterns: [
            {
                id: 'secure-zone-macro',
                version: '1.0.0',
                name: 'Secure Zone Macro',
                c4Level: 'SoftwareSystem',
                composition: {
                    container: {
                        nodes: [
                            { id_suffix: 'gateway', widget_ref: 'api-gateway' },
                            { id_suffix: 'core_db', widget_ref: 'database' }
                        ],
                        edges: [
                            { source_suffix: 'gateway', target_suffix: 'core_db' }
                        ]
                    }
                },
                rules: [
                    { id: '1', scope: 'all', severity: 'mandatory', type: 'node_existence', node: 'id_suffix:gateway' },
                    { id: '2', scope: 'all', severity: 'mandatory', type: 'node_existence', node: 'id_suffix:core_db' },
                    { id: '3', scope: 'all', severity: 'mandatory', type: 'edge_existence', source: 'id_suffix:gateway', target: 'id_suffix:core_db' },
                    {
                        id: 'strict-ingress',
                        scope: 'all',
                        severity: 'mandatory',
                        type: 'connectivity',
                        to: 'id_suffix:core_db',
                        must_pass_through: ['id_suffix:gateway']
                    }
                ]
            }
        ]
    };

    it('should successfully enforce parent-level rules using deeply nested inferred relationships (Rollup Check)', () => {
        const ast = {
            model: {
                softwareSystems: [
                    {
                        id: 'external-system',
                        name: 'External Threat',
                        containers: [
                            { id: 'rogue-container' }
                        ]
                    },
                    {
                        id: 'secure-system',
                        name: 'Secure Vault',
                        properties: { origin_pattern: 'secure-zone-macro@1.0.0', composition_alias: 'system', composition_id: 'exp1' },
                        containers: [
                            { id: 'gateway_node', properties: { origin_pattern: 'secure-zone-macro@1.0.0', composition_alias: 'gateway', composition_id: 'exp1' } },
                            { id: 'db_node', properties: { origin_pattern: 'secure-zone-macro@1.0.0', composition_alias: 'core_db', composition_id: 'exp1' } }
                        ]
                    }
                ],
                relationships: [
                    // The threat bypasses the gateway by connecting directly from its nested container to the DB container!
                    { sourceId: 'rogue-container', destinationId: 'db_node' },
                    { sourceId: 'gateway_node', destinationId: 'db_node' }
                ]
            },
            deployment: { nodes: [] }
        };

        const errors = validateArchitecture(ast, mockRegistry);

        // Due to Rollup validation, it should identify that the External System/Container is illegally reaching the DB
        expect(errors.some(e => e.message.includes("Connectivity Violation"))).toBe(true);
        expect(errors.some(e => e.message.includes("Traffic to 'Secure Vault' MUST pass through 'gateway'.")) || errors.some(e => e.message.includes("bypassing security"))).toBe(true);
    });
});
