import * as core from '@ankoh/dashql-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildSchemaContext } from './agent_catalog.js';
import { packCatalogTable, type CatalogTable } from '../connections/catalog/catalog_sql_generator.js';
import { isSystemSchema } from '../connections/catalog/system_schemas.js';
import { TestLogger } from '../platform/logger/test_logger.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL;
beforeAll(async () => {
    dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterAll(() => dql.resetUnsafe());

describe('Agent catalog', () => {
    it('describes the user relations of the connection, its catalog changes and the session tables', () => {
        const catalog = dql.createCatalog();
        try {
            const scriptSession = dql.createScriptSession(catalog);
            scriptSession.replaceText(scriptSession.getTextVersion(), 'create table summary as select 1 as total, 2 as count');
            scriptSession.analyze();
            scriptSession.loadIntoCatalog();
            const table = (schemaName: string, tableName: string, column: string, dataType: string): CatalogTable => ({
                databaseName: 'db', schemaName, tableName, columns: [{ name: column, ordinalPosition: 1, dataType }],
            });
            const descriptor = { tables: [
                table('public', 'orders', 'id', 'INTEGER'),
                table('pg_catalog', 'pg_class', 'oid', 'INTEGER'),
                table('information_schema', 'columns', 'table_name', 'VARCHAR'),
                table('pg_toast', 'pg_toast_123', 'chunk_id', 'INTEGER'),
                table('sales', 'customers', 'id', 'INTEGER'),
            ].map(packCatalogTable) };
            const conn = { catalog: { readDescriptor: () => descriptor }, catalogRelationEntryId: 1 };
            const sessionScripts = { instance: dql, connectionCatalog: catalog, scripts: { 1: { scriptSession, connection: { connectionId: 'db', catalog } } } } as any;
            const logger = new TestLogger();
            expect(buildSchemaContext('db', conn as any, sessionScripts, logger)).toBe([
                'CREATE TABLE "db"."public"."orders" (\n    "id" "INTEGER"\n);',
                'CREATE TABLE "db"."sales"."customers" (\n    "id" "INTEGER"\n);',
                '-- Tables defined by the session, column types are unknown',
                'CREATE TABLE "summary" ("total", "count");',
            ].join('\n'));
            expect(buildSchemaContext('db', null, sessionScripts, logger)).toBe([
                '-- Tables defined by the session, column types are unknown',
                'CREATE TABLE "summary" ("total", "count");',
            ].join('\n'));
            scriptSession.destroy();
        } finally {
            catalog.destroy();
        }
    });

    it('describes only the session tables of scripts on the connection', () => {
        const catalog = dql.createCatalog();
        const lakeCatalog = dql.createCatalog();
        try {
            const define = (target: core.DashQLCatalog, text: string) => {
                const scriptSession = dql.createScriptSession(target);
                scriptSession.replaceText(scriptSession.getTextVersion(), text);
                scriptSession.analyze();
                scriptSession.loadIntoCatalog();
                return scriptSession;
            };
            const onDb = define(catalog, 'create table summary as select 1 as total');
            const onLake = define(lakeCatalog, 'create table staged as select 1 as id');
            const sessionScripts = {
                instance: dql,
                connectionCatalog: catalog,
                scripts: {
                    1: { scriptSession: onDb, connection: { connectionId: 'db', catalog } },
                    2: { scriptSession: onLake, connection: { connectionId: 'lake', catalog: lakeCatalog } },
                },
            } as any;
            const logger = new TestLogger();
            expect(buildSchemaContext('lake', null, sessionScripts, logger)).toBe([
                '-- Tables defined by the session, column types are unknown',
                'CREATE TABLE "staged" ("id");',
            ].join('\n'));
            expect(buildSchemaContext('db', null, sessionScripts, logger)).toBe([
                '-- Tables defined by the session, column types are unknown',
                'CREATE TABLE "summary" ("total");',
            ].join('\n'));
            onDb.destroy();
            onLake.destroy();
        } finally {
            lakeCatalog.destroy();
            catalog.destroy();
        }
    });

    it('truncates a large schema at a statement boundary and warns', () => {
        const catalog = dql.createCatalog();
        try {
            const descriptor = { tables: Array.from({ length: 100 }, (_, i) => packCatalogTable({
                databaseName: 'db', schemaName: 'public', tableName: `t${i}`,
                columns: Array.from({ length: 200 }, (_, c) => ({ name: `column_${c}`, ordinalPosition: c, dataType: 'INTEGER' })),
            })) };
            const logger = new TestLogger();
            const warn = vi.spyOn(logger, 'warn');
            const schema = buildSchemaContext(
                'db',
                { catalog: { readDescriptor: () => descriptor }, catalogRelationEntryId: 1 } as any,
                { instance: dql, connectionCatalog: catalog, scripts: {} } as any,
                logger,
            );
            expect(schema.length).toBeLessThan(101_000);
            expect(schema.endsWith(');\n-- The schema is truncated')).toBe(true);
            expect(warn).toHaveBeenCalledOnce();
        } finally {
            catalog.destroy();
        }
    });

    it('recognizes system schemas', () => {
        expect(isSystemSchema('pg_catalog')).toBe(true);
        expect(isSystemSchema('INFORMATION_SCHEMA')).toBe(true);
        expect(isSystemSchema('pg_temp_3')).toBe(true);
        expect(isSystemSchema('public')).toBe(false);
    });
});
