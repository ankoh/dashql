import * as dashql from '@ankoh/dashql-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { generateCatalogFunctionsSQL, generateCatalogRelationsSQL, parseCatalogSql } from '@ankoh/dashql-sdk/connections/catalog/catalog_structure';
import { PREFETCHED_HYPER_FUNCTIONS_SQL } from '@ankoh/dashql-sdk/connections/catalog/prefetched_hyper_functions';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => {
    dql.resetUnsafe();
});

describe('catalog structure', () => {
    it('reads the tables and the columns of a relations file', () => {
        const catalog = parseCatalogSql(dql, 'CREATE TABLE "db"."public"."orders" ("id" integer, "note" text);\nCREATE TABLE "db"."public"."empty" ();');
        expect(catalog.functions).toEqual([]);
        expect(catalog.tables).toEqual([
            { databaseName: 'db', schemaName: 'public', tableName: 'orders', columns: [
                { name: 'id', ordinalPosition: 0, dataType: 'integer' },
                { name: 'note', ordinalPosition: 1, dataType: 'text' },
            ] },
            { databaseName: 'db', schemaName: 'public', tableName: 'empty', columns: [] },
        ]);
    });

    it('reads the functions and their parameters, overloads stay apart', () => {
        const catalog = parseCatalogSql(dql, [
            'CREATE FUNCTION "db"."public"."scale"(value integer, factor integer) RETURNS bigint;',
            'CREATE FUNCTION "db"."public"."scale"(value bigint) RETURNS bigint;',
            'CREATE AGGREGATE "db"."pg_catalog"."any_value"() RETURNS any;',
        ].join('\n'));
        expect(catalog.functions).toEqual([
            { databaseName: 'db', schemaName: 'public', functionName: 'scale', isAggregate: false, returnType: 'bigint', params: [
                { name: 'value', type: 'integer' }, { name: 'factor', type: 'integer' },
            ] },
            { databaseName: 'db', schemaName: 'public', functionName: 'scale', isAggregate: false, returnType: 'bigint', params: [
                { name: 'value', type: 'bigint' },
            ] },
            { databaseName: 'db', schemaName: 'pg_catalog', functionName: 'any_value', isAggregate: true, returnType: 'any', params: [] },
        ]);
    });

    it('renders files that read back as the same structure', () => {
        const catalog = parseCatalogSql(dql, [
            'CREATE TABLE "db"."public"."orders" ("id" integer, "note" text);',
            'CREATE FUNCTION "db"."public"."scale"(value integer, factor integer) RETURNS bigint;',
            'CREATE AGGREGATE "db"."pg_catalog"."any_value"() RETURNS any;',
        ].join('\n'));
        const relations = generateCatalogRelationsSQL(catalog.tables);
        const functions = generateCatalogFunctionsSQL(catalog.functions);
        expect(parseCatalogSql(dql, relations).tables).toEqual(catalog.tables);
        expect(parseCatalogSql(dql, functions).functions).toEqual(catalog.functions);
        // A rendered file is rendered the same way again
        expect(generateCatalogFunctionsSQL(parseCatalogSql(dql, functions).functions)).toBe(functions);
    });

    it('round-trips the functions of Hyper', () => {
        const functions = parseCatalogSql(dql, PREFETCHED_HYPER_FUNCTIONS_SQL).functions;
        expect(functions.length).toBeGreaterThan(100);
        expect(parseCatalogSql(dql, generateCatalogFunctionsSQL(functions)).functions).toEqual(functions);
    });

    it('refuses a file that does not parse', () => {
        expect(() => parseCatalogSql(dql, 'CREATE TABLE broken(')).toThrow('Cannot read a catalog');
    });
});
