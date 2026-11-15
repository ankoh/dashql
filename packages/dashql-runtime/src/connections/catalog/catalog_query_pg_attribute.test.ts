import { describe, expect, it } from 'vitest';

import { catalogTablesFromPgAttribute, pgAttributeQuery } from './catalog_query_pg_attribute.js';
import { tableFromArrays } from '../../testing/arrow_fixtures.js';

describe('pgAttributeQuery', () => {
    it('safely qualifies an attached database alias', () => {
        const query = pgAttributeQuery({ queryDatabaseName: 'db"name' });
        expect(query).toContain('FROM "db""name"."pg_catalog".pg_class c');
        expect(query).toContain('JOIN "db""name"."pg_catalog".pg_attribute a');
    });

    it('reads only the relations that it is asked about', () => {
        const query = pgAttributeQuery({ relations: [{ databaseName: 'db', schemaName: "o'x", tableName: 'a' }] });
        expect(query).toContain(`AND ((n.nspname = 'o''x' AND c.relname = 'a'))`);
        expect(query).toContain(`AND n.nspname NOT IN ('pg_catalog', 'information_schema')`);
    });

    it('finds a relation without a schema in every schema', () => {
        const query = pgAttributeQuery({ relations: [{ databaseName: 'db', schemaName: '', tableName: 'a' }] });
        expect(query).toContain(`AND ((c.relname = 'a'))`);
    });

    it('reads all schemas without relations', () => {
        expect(pgAttributeQuery()).not.toContain('NOT IN');
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
