import * as core from '@ankoh/dashql-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildAgentPrompt, buildSchemaContext, describeSqlDialect } from './sql_generation.js';
import { ConnectorType } from '../../connections/connector_info.js';
import { isSystemSchema } from '../../connections/system_schemas.js';
import { Logger } from '../../../platform/logger/logger.js';

class TestLogger extends Logger {
    public destroy(): void { }
    protected flushPendingRecords(): void { }
}

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL;
beforeAll(async () => {
    dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterAll(() => dql.resetUnsafe());

describe('SQL generation', () => {
    it('names the dialect and the dashql commands in the agent prompt', () => {
        const prompt = buildAgentPrompt({
            question: 'top customers\0',
            dialect: describeSqlDialect(ConnectorType.TRINO),
            mentionedIdentifiers: ['customers (table)'],
        });
        expect(prompt).toContain('The connection speaks Trino.');
        expect(prompt).toContain('`dashql agent scripts`');
        expect(prompt).toContain('`dashql agent edit <script>`, into a new script');
        expect(prompt).toContain('The question mentions these catalog objects: customers (table).');
        expect(prompt.endsWith('\n\nQuestion:\ntop customers')).toBe(true);
    });

    it('describes the user relations of the connection and the session tables', () => {
        const catalog = dql.createCatalog();
        try {
            const scriptSession = dql.createScriptSession(catalog);
            scriptSession.replaceText(scriptSession.getTextVersion(), 'create table summary as select 1 as total, 2 as count');
            scriptSession.analyze();
            scriptSession.loadIntoCatalog();
            const relations = [
                '-- DashQL Connection Relations.',
                'CREATE TABLE "db"."public"."orders" ("id" INTEGER, "amount" FLOAT);',
                'CREATE TABLE "db"."pg_catalog"."pg_class" ("oid" INTEGER);',
                'CREATE TABLE "db"."information_schema"."columns" ("table_name" VARCHAR);',
                'CREATE TABLE "db"."pg_toast"."pg_toast_123" ("chunk_id" INTEGER);',
                'CREATE TABLE "db"."sales"."customers" ("id" INTEGER);',
            ].join('\n');
            const conn = { catalogRelationScript: { toString: () => relations } };
            const sessionScripts = { instance: dql, connectionCatalog: catalog, scripts: { 1: { scriptSession, connection: { catalog } } } } as any;
            const logger = new TestLogger();
            expect(buildSchemaContext(conn as any, sessionScripts, logger)).toBe([
                'CREATE TABLE "db"."public"."orders" ("id" INTEGER, "amount" FLOAT);',
                'CREATE TABLE "db"."sales"."customers" ("id" INTEGER);',
                '-- Tables defined by the session, column types are unknown',
                'CREATE TABLE "summary" ("total", "count");',
            ].join('\n'));
            expect(buildSchemaContext(null, sessionScripts, logger)).toBe([
                '-- Tables defined by the session, column types are unknown',
                'CREATE TABLE "summary" ("total", "count");',
            ].join('\n'));
            scriptSession.destroy();
        } finally {
            catalog.destroy();
        }
    });

    it('truncates a large schema at a statement boundary and warns', () => {
        const catalog = dql.createCatalog();
        try {
            const columns = Array.from({ length: 200 }, (_, i) => `"column_${i}" INTEGER`).join(', ');
            const relations = Array.from({ length: 100 }, (_, i) => `CREATE TABLE "public"."t${i}" (${columns});`).join('\n');
            const logger = new TestLogger();
            const warn = vi.spyOn(logger, 'warn');
            const schema = buildSchemaContext(
                { catalogRelationScript: { toString: () => relations } } as any,
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
