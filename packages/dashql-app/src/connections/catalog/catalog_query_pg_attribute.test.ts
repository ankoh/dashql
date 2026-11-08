import { describe, expect, it, vi } from 'vitest';

import { CATALOG_QUERY_READ_TIMEOUT_MS, catalogTablesFromPgAttribute, pgAttributeQuery, queryPgAttribute } from './catalog_query_pg_attribute.js';
import type { QueryExecutor } from '../query_executor.js';
import { tableFromArrays } from '../../tests/arrow_fixtures.js';

describe('queryPgAttribute', () => {
    it('safely qualifies an attached database alias', async () => {
        let query = '';
        const executor = vi.fn<QueryExecutor>((_connectionId, args) => {
            query = args.query;
            return [1, Promise.resolve(tableFromArrays({}))];
        });

        await queryPgAttribute('session', vi.fn(), 7, 'catalog', [], executor, 'db"name');

        expect(query).toContain('FROM "db""name"."pg_catalog".pg_class c');
        expect(query).toContain('JOIN "db""name"."pg_catalog".pg_attribute a');
        expect(executor.mock.calls[0][1].readTimeoutMs).toBe(CATALOG_QUERY_READ_TIMEOUT_MS);
    });

    it('reads only the relations that it is asked about', () => {
        const query = pgAttributeQuery({ relations: [{ databaseName: 'db', schemaName: "o'x", tableName: 'a' }] });
        expect(query).toContain(`AND ((n.nspname = 'o''x' AND c.relname = 'a'))`);
    });

    it('leaves out the schemas of the system on request', () => {
        expect(pgAttributeQuery()).not.toContain('NOT IN');
        expect(pgAttributeQuery({ userSchemasOnly: true })).toContain(`AND n.nspname NOT IN ('pg_catalog', 'information_schema')`);
    });
});

describe('catalogTablesFromPgAttribute', () => {
    it('groups the rows by table and keeps the ordinal positions', () => {
        const rows = tableFromArrays({
            table_schema: ['public', 'public', 'other'],
            table_name: ['items', 'items', 'tags'],
            column_name: ['name', 'id', 'tag'],
            ordinal_position: [2, 1, 1],
            data_type: ['text', 'int8', 'text'],
        });
        const tables = catalogTablesFromPgAttribute(rows as any, 'db');
        expect(tables.map(table => `${table.databaseName}.${table.schemaName}.${table.tableName}`)).toEqual(['db.public.items', 'db.other.tags']);
        expect(tables[0].columns).toEqual([
            { name: 'name', ordinalPosition: 2, dataType: 'text' },
            { name: 'id', ordinalPosition: 1, dataType: 'int8' },
        ]);
    });
});
