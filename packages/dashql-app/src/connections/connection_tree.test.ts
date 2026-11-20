import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import type * as core from '@akohn/dashql';
import { connectionLabelOf, connectionLabels } from './connection_label.js';
import {
    connectionTreeRowHeight,
    flattenCatalogRows,
    listedConnections,
    isConnectionInitiallyExpanded,
    isVisibleCatalogNode,
    type CatalogNode,
} from './connection_tree.js';

// The labels themselves come from the runtime (`labels_of_connections` of the tests of the core runtime)
describe('connection rows', () => {
    it('initially collapses Memory only when another database exists', () => {
        const memory = {
            connectionId: 'memory',
            embedded: true,
            connectorType: ConnectorType.HYPER,
            details: { setupParams: { protocol: 'WASM' }, channel: null, connector: { kind: 'hyper' } },
        } as unknown as ConnectionState;
        const remote = {
            connectionId: 'remote',
            connectorType: ConnectorType.TRINO,
            details: { setupParams: {}, channel: null, connector: { kind: 'trino' } },
        } as unknown as ConnectionState;

        expect(isConnectionInitiallyExpanded(memory, 1)).toBe(true);
        expect(isConnectionInitiallyExpanded(memory, 2)).toBe(false);
        expect(isConnectionInitiallyExpanded(remote, 2)).toBe(true);
    });
});

describe('connections of the same connector', () => {
    const label = (name: string, detail: string) => ({ name, connector: name, detail, text: `${name} ${detail}` });
    const hyper = (connectionId: string, extra: Partial<ConnectionState> = {}) => ({
        connectionId,
        active: true,
        label: label('Hyper', 'Http'),
        connectorType: ConnectorType.HYPER,
        details: { setupParams: { protocol: 'V3_HTTP' }, channel: null, connector: { kind: 'hyper' } },
        ...extra,
    }) as unknown as ConnectionState;
    const trino = (connectionId: string) => ({
        connectionId,
        active: true,
        label: label('Trino', 'Http'),
        connectorType: ConnectorType.TRINO,
        details: { setupParams: {}, channel: null, connector: { kind: 'trino' } },
    }) as unknown as ConnectionState;
    /// The connections and their list as the runtime shows them, with the listed connections and their ordinals
    const viewsOf = (databases: ConnectionState[], listed: Record<string, boolean> = {}, ordinals: Record<string, number> = {}) => ({
        connections: new Map(databases.map(database => [database.connectionId, database])),
        list: {
            connections: databases.map(database => ({
                connectionId: database.connectionId,
                connectorType: database.connectorType,
                active: database.active,
                listed: listed[database.connectionId] ?? database.active,
                ordinal: ordinals[database.connectionId] ?? null,
                label: ordinals[database.connectionId] == null
                    ? database.label
                    : label(`${database.label.name} #${ordinals[database.connectionId]}`, database.label.detail),
            })),
            connectionsByType: [],
        } as unknown as core.ConnectionListView,
    });

    it('labels connections with the labels of the list', () => {
        const { connections, list } = viewsOf([hyper('a'), trino('t'), hyper('b')], {}, { a: 1, b: 2 });
        const labels = connectionLabels(list);
        expect(connectionLabelOf(connections.get('b')!, labels).text).toBe('Hyper #2 Http');
        expect(connectionLabelOf(connections.get('t')!, labels).text).toBe('Trino Http');
        // A connection outside of the list keeps its own label
        expect(connectionLabelOf(hyper('gone'), labels).text).toBe('Hyper Http');
    });

    it('lists the connections that the list marks as listed', () => {
        // Inactive connections that no workbook uses are not listed
        const { connections, list } = viewsOf([hyper('a', { active: false }), hyper('b', { active: false })], { a: true });
        expect(listedConnections(connections, list, []).map(database => database.connectionId)).toEqual(['a']);
    });

    it('always lists the clouds', () => {
        const { connections, list } = viewsOf([hyper('a', { active: false }), hyper('b', { active: false })], { a: true });
        expect(listedConnections(connections, list, [], ['b']).map(database => database.connectionId)).toEqual(['a', 'b']);
    });

    it('sizes the group headings of the connection tree', () => {
        const rows = [
            { type: 'connection-group', key: 'g', label: 'This workbook' },
            { type: 'connection', key: 'a', database: hyper('a') },
            { type: 'connection-group', key: 'h', label: 'Other connections' },
        ] as Parameters<typeof connectionTreeRowHeight>[1]['rows'];
        // A heading that follows another group keeps more space above it than the first one
        expect(connectionTreeRowHeight(0, { rows })).toBeLessThan(connectionTreeRowHeight(2, { rows }));
        expect(connectionTreeRowHeight(1, { rows })).toBeLessThan(connectionTreeRowHeight(2, { rows }));
    });
});

describe('connection catalog tree', () => {
    it('hides anonymous database and schema containers created by unqualified SQL declarations', () => {
        expect(isVisibleCatalogNode('database', '')).toBe(false);
        expect(isVisibleCatalogNode('schema', '   ')).toBe(false);
        expect(isVisibleCatalogNode('database', 'hyper')).toBe(true);
        expect(isVisibleCatalogNode('schema', 'public')).toBe(true);
    });

    it('reads descendants only when their parents are expanded', () => {
        const schemas = [{ nameId: () => 1, childBegin: () => 0, childCount: () => 2 }];
        const tables = [
            { nameId: () => 2, childBegin: () => 0, childCount: () => 0 },
            { nameId: () => 3, childBegin: () => 0, childCount: () => 0 },
        ];
        const reader = {
            readName: (id: number) => ['', 'public', 'accounts', 'contacts'][id],
            catalogReader: {
                databasesLength: () => 1,
                schemasLength: () => schemas.length,
                tablesLength: () => tables.length,
                columnsLength: () => 0,
                schemas: (index: number) => schemas[index],
                tables: (index: number) => tables[index],
                columns: () => null,
            },
        } as unknown as Parameters<typeof flattenCatalogRows>[0];
        const database: CatalogNode = {
            key: 'catalog/database:0:hyper', name: 'hyper', kind: 'database', index: 0, childBegin: 0, childCount: 1,
        };

        const databaseOnly = flattenCatalogRows(reader, [database], new Set());
        expect(databaseOnly.map(row => row.name)).toEqual(['hyper']);
        expect(databaseOnly[0].type).toBe('catalog');

        const withSchema = flattenCatalogRows(reader, [database], new Set([database.key]));
        expect(withSchema.map(row => row.name)).toEqual(['hyper', 'public']);

        const withTables = flattenCatalogRows(reader, [database], new Set([database.key, withSchema[1].key]));
        expect(withTables.map(row => row.name)).toEqual(['hyper', 'public', 'accounts', 'contacts']);
    });
});
