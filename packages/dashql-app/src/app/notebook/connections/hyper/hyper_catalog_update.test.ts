import * as arrow from 'apache-arrow';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as dashql from '../../../../core/index.js';
import { buildHyperCloudCatalogQuery, generateCatalogSQLFromHyperCloud, updateHyperCatalog } from './hyper_catalog_update.js';
import type { QueryExecutor } from '../query_executor.js';
import { CATALOG_QUERY_READ_TIMEOUT_MS } from '../catalog_query_pg_attribute.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL;

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

beforeEach(() => {
    dql.resetUnsafe();
});

function pgResult(tableName: string) {
    return arrow.tableFromArrays({
        table_schema: ['public'],
        table_name: [tableName],
        column_name: ['id'],
        ordinal_position: [1],
        data_type: ['int8'],
        is_nullable: ['NO'],
        numeric_precision: [null],
        numeric_scale: [null],
    });
}

function cloudResult(databaseName = 'Cloud Database') {
    return arrow.tableFromArrays({
        database_name: [databaseName, databaseName],
        schema_name: ['sales', 'sales'],
        table_name: ['orders', 'orders'],
        column_name: ['name', 'id'],
        ordinal_position: [1, 0],
        data_type: ['text', 'bigint'],
    });
}

describe('Hyper catalog query generation', () => {
    it('qualifies Hyper Cloud metadata tables without projecting UUIDs', () => {
        const query = buildHyperCloudCatalogQuery('cloud"catalog');
        const projection = query.slice(query.indexOf('SELECT'), query.indexOf('FROM'));

        expect(query).toContain('FROM "cloud""catalog"."_hyper_catalog"."databases" d');
        expect(query).toContain('s.database_id = d.database_id');
        expect(projection).not.toMatch(/\b(?:account|database|schema|object|column)_id\b/);
        expect(projection).not.toContain('database_name_display');
        expect(projection).toContain('CAST(c.type_descriptor AS TEXT) AS data_type');
    });

    it('uses the attached database name and ordinal positions from Hyper Cloud metadata', () => {
        const sql = generateCatalogSQLFromHyperCloud(cloudResult() as any, 'cloud attachment');

        expect(sql).toContain('CREATE TABLE "cloud attachment"."sales"."orders"');
        expect(sql).not.toContain('CREATE TABLE "Cloud Database"');
        expect(sql.indexOf('"id" INTEGER')).toBeLessThan(sql.indexOf('"name" VARCHAR'));
    });
});

describe('updateHyperCatalog', () => {
    it('queries standard and cloud attachments independently and merges their catalogs', async () => {
        const catalog = dql.createCatalog();
        const script = dql.createScript(catalog);
        const functionScript = dql.createScript(catalog);
        const queries: string[] = [];
        const executor = vi.fn<QueryExecutor>((_connectionId, args) => {
            queries.push(args.query);
            const result = args.query.includes('"_hyper_catalog"."databases"')
                ? cloudResult()
                : pgResult('lake_table');
            return [queries.length, Promise.resolve(result)];
        });

        const result = await updateHyperCatalog(
            { info: vi.fn() } as any,
            'connection',
            vi.fn(),
            7,
            [
                { path: 'lakehouse:tenant;default', alias: 'lake db' },
                { path: 'hyper.cloud/catalog', alias: 'cloud' },
            ],
            executor,
            catalog,
            dql,
            script,
            functionScript,
            new AbortController().signal,
        );

        expect(result.failures).toEqual([]);
        expect(queries).toHaveLength(2);
        expect(queries[0]).toContain('FROM "lake db"."pg_catalog".pg_class c');
        expect(queries[1]).toContain('FROM "cloud"."_hyper_catalog"."databases" d');
        expect(executor.mock.calls.every(call => call[1].readTimeoutMs === CATALOG_QUERY_READ_TIMEOUT_MS)).toBe(true);
        expect(script.toString()).toContain('CREATE TABLE "lake db"."public"."lake_table"');
        expect(script.toString()).toContain('CREATE TABLE "cloud"."sales"."orders"');
        expect(script.toString()).not.toContain('CREATE TABLE "Cloud Database"');
        expect(script.getAnalyzed().read().tablesLength()).toBe(2);
        expect(functionScript.toString()).toContain('CREATE FUNCTION "default"."pg_catalog"."abs"() RETURNS any;');
    });

    it('uses the unqualified default database when there are no attachments', async () => {
        const catalog = dql.createCatalog();
        const script = dql.createScript(catalog);
        const functionScript = dql.createScript(catalog);
        let query = '';
        const executor = vi.fn<QueryExecutor>((_connectionId, args) => {
            query = args.query;
            return [1, Promise.resolve(pgResult('default_table'))];
        });

        await updateHyperCatalog(
            { info: vi.fn() } as any,
            'connection',
            vi.fn(),
            8,
            [],
            executor,
            catalog,
            dql,
            script,
            functionScript,
            new AbortController().signal,
        );

        expect(query).toContain('FROM pg_catalog.pg_class c');
        expect(query).not.toContain('"default"."pg_catalog"');
        expect(script.toString()).toContain('CREATE TABLE "default"."public"."default_table"');
    });

    it('retains a failed database section while committing a successful database', async () => {
        const catalog = dql.createCatalog();
        const script = dql.createScript(catalog);
        const functionScript = dql.createScript(catalog);
        const attachments = [
            { path: 'lakehouse:first', alias: 'first' },
            { path: 'lakehouse:second', alias: 'second' },
        ];
        let revision = 1;
        let failSecond = false;
        const executor = vi.fn<QueryExecutor>((_connectionId, args) => {
            if (failSecond && args.query.includes('"second"."pg_catalog"')) {
                return [2, Promise.reject(new Error('second unavailable'))];
            }
            const alias = args.query.includes('"first"."pg_catalog"') ? 'first' : 'second';
            return [1, Promise.resolve(pgResult(`${alias}_v${revision}`))];
        });

        await updateHyperCatalog(
            { info: vi.fn() } as any,
            'connection',
            vi.fn(),
            9,
            attachments,
            executor,
            catalog,
            dql,
            script,
            functionScript,
            new AbortController().signal,
        );
        revision = 2;
        failSecond = true;

        const result = await updateHyperCatalog(
            { info: vi.fn() } as any,
            'connection',
            vi.fn(),
            10,
            attachments,
            executor,
            catalog,
            dql,
            script,
            functionScript,
            new AbortController().signal,
        );

        expect(result.updatedDatabases).toEqual(['first']);
        expect(result.failures.map(failure => failure.database)).toEqual(['second']);
        expect(script.toString()).toContain('"first"."public"."first_v2"');
        expect(script.toString()).not.toContain('"first"."public"."first_v1"');
        expect(script.toString()).toContain('"second"."public"."second_v1"');
        expect(script.toString()).not.toContain('"second"."public"."second_v2"');
    });

    it('leaves the script untouched when every attachment fails validation', async () => {
        const catalog = dql.createCatalog();
        const script = dql.createScript(catalog);
        const functionScript = dql.createScript(catalog);
        script.replaceText('legacy catalog text');
        const executor = vi.fn<QueryExecutor>();

        await expect(updateHyperCatalog(
            { info: vi.fn() } as any,
            'connection',
            vi.fn(),
            11,
            [{ path: 'lakehouse:first', alias: '' }],
            executor,
            catalog,
            dql,
            script,
            functionScript,
            new AbortController().signal,
        )).rejects.toThrow('Failed to refresh every attached database');

        expect(executor).not.toHaveBeenCalled();
        expect(script.toString()).toBe('legacy catalog text');
    });
});
