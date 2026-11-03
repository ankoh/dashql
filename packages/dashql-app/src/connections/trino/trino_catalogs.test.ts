import { describe, expect, it, vi } from 'vitest';
import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

import type { QueryExecutor } from '../query_executor.js';
import { parseTrinoCatalogEntry, queryTrinoCatalogScopes, TRINO_CATALOGS_QUERY, trinoCatalogScopes, trinoSessionDefaults, withTrinoCatalogFields } from './trino_catalogs.js';
import { CATALOG_UPDATE_REGISTER_QUERY } from '../connection_state.js';
import { tableFromArrays } from '../../tests/arrow_fixtures.js';

const params = (fields: Partial<connection.TrinoConnectionParams>): connection.TrinoConnectionParams => ({
    endpoint: 'https://trino.example.com',
    auth: { authType: 'AUTH_BASIC' },
    ...fields,
});

describe('Trino catalog entries', () => {
    it('splits an entry at the first dot', () => {
        expect(parseTrinoCatalogEntry('hive')).toEqual({ catalog: 'hive', schema: null });
        expect(parseTrinoCatalogEntry(' hive . sales ')).toEqual({ catalog: 'hive', schema: 'sales' });
        expect(parseTrinoCatalogEntry('hive.')).toEqual({ catalog: 'hive', schema: null });
        expect(parseTrinoCatalogEntry('hive.a.b')).toEqual({ catalog: 'hive', schema: 'a.b' });
        expect(parseTrinoCatalogEntry('')).toBeNull();
        expect(parseTrinoCatalogEntry('.sales')).toBeNull();
    });

    it('reads the catalog and schemas of params that predate the entries', () => {
        const fields = (legacy: Partial<connection.TrinoConnectionParams>) => {
            const { defaultCatalog, defaultSchema, catalogs, catalogName, schemaNames } = withTrinoCatalogFields(params(legacy)) as connection.TrinoConnectionParams;
            return { defaultCatalog, defaultSchema, catalogs, catalogName, schemaNames };
        };
        expect(fields({ catalogName: 'hive', schemaNames: ['sales', 'hr'] })).toEqual({ defaultCatalog: 'hive', catalogs: ['hive.sales', 'hive.hr'] });
        expect(fields({ catalogName: 'hive' })).toEqual({ defaultCatalog: 'hive', catalogs: [] });
        expect(fields({ catalogName: '' })).toEqual({ defaultCatalog: '', catalogs: [] });
        expect(fields({ defaultCatalog: 'iceberg', defaultSchema: 'sales', catalogs: ['iceberg'] }))
            .toEqual({ defaultCatalog: 'iceberg', defaultSchema: 'sales', catalogs: ['iceberg'] });
    });

    it('sends a default schema only with a default catalog', () => {
        expect(trinoSessionDefaults(params({ defaultCatalog: ' hive ', defaultSchema: ' sales ' }))).toEqual({ catalog: 'hive', schema: 'sales' });
        expect(trinoSessionDefaults(params({ defaultCatalog: 'hive', defaultSchema: '' }))).toEqual({ catalog: 'hive', schema: null });
        expect(trinoSessionDefaults(params({ defaultSchema: 'sales' }))).toEqual({ catalog: null, schema: null });
        expect(trinoSessionDefaults(params({ catalogName: 'hive', schemaNames: ['sales'] }))).toEqual({ catalog: 'hive', schema: null });
    });

    it('reads the default catalog without entries', () => {
        expect(trinoCatalogScopes(params({ defaultCatalog: 'hive', catalogs: [] }))).toEqual([{ catalog: 'hive', schemas: [] }]);
        expect(trinoCatalogScopes(params({ catalogName: 'hive' }))).toEqual([{ catalog: 'hive', schemas: [] }]);
        expect(trinoCatalogScopes(params({ defaultCatalog: 'hive', catalogs: ['iceberg'] }))).toEqual([{ catalog: 'iceberg', schemas: [] }]);
        expect(trinoCatalogScopes(params({ catalogs: [] }))).toEqual([]);
    });

    it('groups the entries by catalog in the order of their first entry', () => {
        const scopes = trinoCatalogScopes(params({ catalogs: ['iceberg.sales', 'hive', '', 'iceberg.hr', 'iceberg.sales', 'hive.ignored'] }));
        expect(scopes).toEqual([
            { catalog: 'iceberg', schemas: ['sales', 'hr'] },
            { catalog: 'hive', schemas: [] },
        ]);
    });

    it('reads all catalogs of the server', async () => {
        const executor = vi.fn<QueryExecutor>(() => [3, Promise.resolve(tableFromArrays({ catalog_name: ['hive', 'system'] }))]);
        const dispatch = vi.fn();
        const scopes = await queryTrinoCatalogScopes('connection', dispatch, 7, executor);
        expect(executor.mock.calls[0][1].query).toBe(TRINO_CATALOGS_QUERY);
        expect(dispatch).toHaveBeenCalledWith('connection', { type: CATALOG_UPDATE_REGISTER_QUERY, value: [7, 3] });
        expect(scopes).toEqual([
            { catalog: 'hive', schemas: [] },
            { catalog: 'system', schemas: [] },
        ]);
    });
});
