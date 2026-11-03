import { describe, expect, it, vi } from 'vitest';
import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

import type { QueryExecutor } from '../query_executor.js';
import { parseTrinoCatalogEntry, queryTrinoCatalogScopes, TRINO_CATALOGS_QUERY, trinoCatalogEntries, trinoCatalogScopes } from './trino_catalogs.js';
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
        expect(trinoCatalogEntries(params({ catalogName: 'hive', schemaNames: ['sales', 'hr'] }))).toEqual(['hive.sales', 'hive.hr']);
        expect(trinoCatalogEntries(params({ catalogName: 'hive' }))).toEqual(['hive']);
        expect(trinoCatalogEntries(params({ catalogName: '' }))).toEqual([]);
        expect(trinoCatalogEntries(params({ catalogs: ['iceberg'], catalogName: 'hive' }))).toEqual(['iceberg']);
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
