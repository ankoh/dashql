import { describe, expect, it } from 'vitest';
import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { parseTrinoCatalogEntry, trinoSessionDefaults, withTrinoCatalogFields } from './trino_catalogs.js';

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
});
