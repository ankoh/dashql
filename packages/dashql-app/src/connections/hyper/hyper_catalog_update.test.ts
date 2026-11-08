import * as arrow from 'apache-arrow';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as dashql from '@ankoh/dashql-core';
import { buildHyperCloudCatalogQuery, catalogTablesFromHyperCloud, updateHyperCatalog } from './hyper_catalog_update.js';
import { generateCatalogTablesSQL, generateRelationsFile } from '../catalog/catalog_sql_generator.js';
import type { QueryExecutor } from '../query_executor.js';
import { TestLogger } from '../../platform/logger/test_logger.js';
import { setupWebHyperDB } from '../../platform/hyperdb/hyperdb_provider_web.js';
import { CATALOG_QUERY_READ_TIMEOUT_MS } from '../catalog/catalog_query_pg_attribute.js';
import { tableFromArrays, vectorFromArray } from '../../tests/arrow_fixtures.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL;

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

beforeEach(() => {
    dql.resetUnsafe();
});

function pgResult(tableName: string) {
    return tableFromArrays({
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
    return tableFromArrays({
        database_name: [databaseName, databaseName],
        schema_name: ['sales', 'sales'],
        table_name: ['orders', 'orders'],
        column_name: ['name', 'id'],
        ordinal_position: [1, 0],
        data_type: ['text', 'bigint'],
    });
}

function functionResult() {
    return tableFromArrays({
        function_schema: ['pg_catalog'],
        function_name: ['wasm_catalog_function'],
        return_type: ['bigint'],
        returns_set: [false],
        function_kind: ['f'],
    }).assign(new arrow.Table({
        argument_types: vectorFromArray([['integer']], new arrow.List(new arrow.Field('item', new arrow.Utf8(), true))),
        argument_names: vectorFromArray([[]], new arrow.List(new arrow.Field('item', new arrow.Utf8(), true))),
        argument_modes: vectorFromArray([[]], new arrow.List(new arrow.Field('item', new arrow.Utf8(), true))),
    }));
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
        const sql = generateCatalogTablesSQL(catalogTablesFromHyperCloud(cloudResult() as any, 'cloud attachment'));

        expect(sql).toContain('CREATE TABLE "cloud attachment"."sales"."orders"');
        expect(sql).not.toContain('CREATE TABLE "Cloud Database"');
        expect(sql.indexOf('"id" "bigint"')).toBeLessThan(sql.indexOf('"name" "text"'));
    });

    it('declares a column once when the Hyper Cloud metadata lists it twice', () => {
        const result = tableFromArrays({
            schema_name: ['sales', 'sales', 'sales', 'sales'],
            table_name: ['orders', 'orders', 'orders', 'orders'],
            column_name: ['id', 'name', 'id', 'name'],
            ordinal_position: [0, 1, 0, 1],
            data_type: ['bigint', 'text', 'bigint', 'text'],
        });
        const logger = { warn: vi.fn() };
        const sql = generateCatalogTablesSQL(catalogTablesFromHyperCloud(result as any, 'lakehouse', logger as any));

        expect(sql.match(/"id" "bigint"/g)).toHaveLength(1);
        expect(sql.match(/"name" "text"/g)).toHaveLength(1);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn.mock.calls[0][1]).toMatchObject({ database: 'lakehouse', duplicates: '2', schema: 'sales', table: 'orders', column: 'id' });
    });
});

describe('updateHyperCatalog', () => {
    it('queries standard and cloud attachments independently and merges their catalogs', async () => {
        const catalog = dql.createCatalog();
        const script = catalog.allocateEntryId();
        const relationsText = () => generateRelationsFile(catalog.readDescriptor(script));
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
            false,
            new AbortController().signal,
            { processor: async request => dql.processBatch(request) },
        );

        expect(result.failures).toEqual([]);
        expect(queries).toHaveLength(2);
        expect(queries[0]).toContain('FROM "lake db"."pg_catalog".pg_class c');
        expect(queries[1]).toContain('FROM "cloud"."_hyper_catalog"."databases" d');
        expect(executor.mock.calls.every(call => call[1].readTimeoutMs === CATALOG_QUERY_READ_TIMEOUT_MS)).toBe(true);
        expect(relationsText()).toContain('CREATE TABLE "lake db"."public"."lake_table"');
        expect(relationsText()).toContain('CREATE TABLE "cloud"."sales"."orders"');
        expect(relationsText()).not.toContain('CREATE TABLE "Cloud Database"');
        expect(catalog.flatten().read().catalogReader.tablesLength()).toBe(2);
        expect(functionScript.toString()).toContain('CREATE FUNCTION "hyper"."pg_catalog"."abs"() RETURNS any;');
    });

    it('publishes a Hyper Cloud catalog that lists a column twice', async () => {
        const catalog = dql.createCatalog();
        const script = catalog.allocateEntryId();
        const relationsText = () => generateRelationsFile(catalog.readDescriptor(script));
        const functionScript = dql.createScript(catalog);
        const rows = cloudResult();
        const executor = vi.fn<QueryExecutor>(() => [1, Promise.resolve(rows.concat(rows))]);

        const result = await updateHyperCatalog(
            { info: vi.fn(), warn: vi.fn() } as any,
            'connection',
            vi.fn(),
            7,
            [{ path: 'hyper.cloud:sales', alias: 'lakehouse' }],
            executor,
            catalog,
            dql,
            script,
            functionScript,
            false,
            new AbortController().signal,
            { processor: async request => dql.processBatch(request) },
        );

        expect(result.failures).toEqual([]);
        expect(relationsText().match(/"id" "bigint"/g)).toHaveLength(1);
        expect(catalog.flatten().read().catalogReader.tablesLength()).toBe(1);

        // Completion reads the columns of the published catalog with their types
        const text = 'select * from orde';
        const editor = dql.createScript(catalog);
        editor.insertTextAt(0, text);
        editor.analyze();
        editor.moveCursor(text.length);
        const completion = editor.completeAtCursor(10).read();
        let columns: string[] = [];
        for (let i = 0; i < completion.candidatesLength(); ++i) {
            const candidate = completion.candidates(i)!;
            if (candidate.displayText() != 'orders') continue;
            const info = candidate.catalogObjects(0)!.info()!;
            for (let c = 0; c < info.columnsLength(); ++c) {
                columns.push(`${info.columns(c)!.name()} ${info.columns(c)!.detail()}`);
            }
        }
        expect(columns).toEqual(['id bigint', 'name text']);
    });

    it('uses the unqualified default database and live function catalog for Hyper WASM', async () => {
        const catalog = dql.createCatalog();
        const script = catalog.allocateEntryId();
        const relationsText = () => generateRelationsFile(catalog.readDescriptor(script));
        const functionScript = dql.createScript(catalog);
        let query = '';
        const executor = vi.fn<QueryExecutor>((_connectionId, args) => {
            if (args.query.includes('FROM pg_proc p')) {
                return [2, Promise.resolve(functionResult())];
            }
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
            true,
            new AbortController().signal,
            { processor: async request => dql.processBatch(request) },
        );

        expect(query).toContain('FROM pg_catalog.pg_class c');
        expect(query).not.toContain('"hyper"."pg_catalog"');
        expect(relationsText()).toContain('CREATE TABLE "hyper"."public"."default_table"');
        expect(functionScript.toString()).toContain('-- Catalog Source: HyperDB WASM pg_proc');
        expect(functionScript.toString()).toContain(
            'CREATE FUNCTION "hyper"."pg_catalog"."wasm_catalog_function"("arg1" integer) RETURNS bigint;',
        );
        expect(functionScript.toString()).not.toContain('CREATE FUNCTION "hyper"."pg_catalog"."abs"');
        expect(executor.mock.calls[1]?.[1].readTimeoutMs).toBe(CATALOG_QUERY_READ_TIMEOUT_MS);
    });

    it('keeps the relations of a failed database while committing a successful database', async () => {
        const catalog = dql.createCatalog();
        const script = catalog.allocateEntryId();
        const relationsText = () => generateRelationsFile(catalog.readDescriptor(script));
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
            false,
            new AbortController().signal,
            { processor: async request => dql.processBatch(request) },
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
            false,
            new AbortController().signal,
            { processor: async request => dql.processBatch(request) },
        );

        expect(result.updatedDatabases).toEqual(['first']);
        expect(result.failures.map(failure => failure.database)).toEqual(['second']);
        expect(relationsText()).toContain('"first"."public"."first_v2"');
        expect(relationsText()).not.toContain('"first"."public"."first_v1"');
        expect(relationsText()).toContain('"second"."public"."second_v1"');
        expect(relationsText()).not.toContain('"second"."public"."second_v2"');
    });

    it('leaves the catalog untouched when every attachment fails validation', async () => {
        const catalog = dql.createCatalog();
        const script = catalog.allocateEntryId();
        const relationsText = () => generateRelationsFile(catalog.readDescriptor(script));
        const functionScript = dql.createScript(catalog);
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
            false,
            new AbortController().signal,
        )).rejects.toThrow('Failed to refresh every attached database');

        expect(executor).not.toHaveBeenCalled();
        expect(catalog.readDescriptor(script)).toBeNull();
    });

    it.each(['processing', 'function publication', 'relation publication', 'aborted'])('keeps the relations after a %s failure', async failure => {
        const catalog = dql.createCatalog();
        const relations = catalog.allocateEntryId();
        const functionScript = dql.createScript(catalog);
        const relationsText = () => generateRelationsFile(catalog.readDescriptor(relations));
        let revision = 1;
        const executor = vi.fn<QueryExecutor>(() => [1, Promise.resolve(pgResult(`table_v${revision}`))]);
        const refresh = (signal: AbortSignal, processor = async (request: dashql.BatchRequest) => dql.processBatch(request)) => updateHyperCatalog(
            { info: vi.fn() } as any, 'connection', vi.fn(), revision, [], executor,
            catalog, dql, relations, functionScript, false, signal, { processor },
        );
        await refresh(new AbortController().signal);
        const previousRelations = relationsText();
        const previousFunctions = functionScript.toString();
        revision = 2;
        const abort = new AbortController();
        const processor = async (request: dashql.BatchRequest) => {
            const result = dql.processBatch(request);
            if (failure === 'processing') result.scripts[0].failure = 'function processing failed';
            if (failure === 'aborted') abort.abort();
            return result;
        };
        const replaceDescriptor = catalog.replaceDescriptor.bind(catalog);
        const publication = failure.endsWith('publication')
            ? vi.spyOn(catalog, 'replaceDescriptor').mockImplementation((id, layer, descriptor) => {
                const failing = failure === 'function publication' ? functionScript.catalog_entry_id : relations;
                if (id === failing) throw new Error('descriptor import failed');
                replaceDescriptor(id, layer, descriptor);
            })
            : null;
        try {
            await expect(refresh(abort.signal, processor)).rejects.toThrow();
            expect(relationsText()).toBe(previousRelations);
            // The functions are published first, a later failure leaves them published
            if (failure !== 'relation publication') expect(functionScript.toString()).toBe(previousFunctions);
        } finally {
            publication?.mockRestore();
        }
    });

    it('publishes an empty function catalog to clear stale functions', async () => {
        const catalog = dql.createCatalog();
        const relations = catalog.allocateEntryId();
        const functionScript = dql.createScript(catalog);
        let emptyFunctions = false;
        const executor = vi.fn<QueryExecutor>((_id, args) => [1, Promise.resolve(args.query.includes('FROM pg_proc p')
            ? emptyFunctions ? tableFromArrays({}) : functionResult()
            : pgResult('items'))]);
        const refresh = () => updateHyperCatalog(
            { info: vi.fn() } as any, 'connection', vi.fn(), 1, [], executor,
            catalog, dql, relations, functionScript, true, new AbortController().signal,
            { processor: async request => dql.processBatch(request) },
        );
        await refresh();
        expect(functionScript.toString()).toContain('wasm_catalog_function');
        emptyFunctions = true;
        await refresh();
        expect(functionScript.toString()).not.toContain('wasm_catalog_function');
        expect(catalog.containsEntryId(functionScript.catalog_entry_id)).toBe(true);
    });
});

describe('updateHyperCatalog of touched relations', () => {
    const ORDERS = { databaseName: 'hyper', schemaName: 'public', tableName: 'orders' };
    const COLUMNS = (columns: string[]) => tableFromArrays({
        table_schema: columns.map(() => 'public'),
        table_name: columns.map(() => 'orders'),
        column_name: columns,
        ordinal_position: columns.map((_, i) => i + 1),
        data_type: columns.map(() => 'int4'),
    });
    /// Update the relations with the rows that the connection reports
    const update = async (entry: number, catalog: dashql.DashQLCatalog, rows: unknown) => {
        const executor = vi.fn<QueryExecutor>(() => [1, Promise.resolve(rows)] as never);
        const functions = dql.createScript(catalog);
        const processor = vi.fn(async (request: dashql.BatchRequest) => dql.processBatch(request));
        await updateHyperCatalog(new TestLogger(), 'database', vi.fn(), 1, [], executor, catalog, dql, entry, functions, true, new AbortController().signal, { processor }, [ORDERS]);
        return { executor, functions, processor };
    };

    it('asks about the relations only, without parsing anything, and leaves the functions alone', async () => {
        const catalog = dql.createCatalog();
        const entry = catalog.allocateEntryId();
        const text = () => generateRelationsFile(catalog.readDescriptor(entry));
        const { executor, functions, processor } = await update(entry, catalog, COLUMNS(['a', 'b']));
        expect(executor).toHaveBeenCalledTimes(1);
        expect(executor.mock.calls[0][1].query).toContain("n.nspname = 'public' AND c.relname = 'orders'");
        expect(processor).not.toHaveBeenCalled();
        expect(text()).toContain('CREATE TABLE "hyper"."public"."orders"');
        expect(text()).toContain('"b" "int4"');
        expect(functions.toString()).toBe('');

        // The next answer replaces the table
        await update(entry, catalog, COLUMNS(['c']));
        expect(text()).toContain('"c" "int4"');
        expect(text()).not.toContain('"b" "int4"');
        expect(text().match(/CREATE TABLE/g)).toHaveLength(1);

        // No rows: the relation is gone, an unchanged answer keeps the version
        await update(entry, catalog, COLUMNS([]));
        expect(text()).not.toContain('CREATE TABLE');
        const version = catalog.flatten().read().catalogReader.catalogVersion();
        await update(entry, catalog, COLUMNS([]));
        expect(catalog.flatten().read().catalogReader.catalogVersion()).toBe(version);
    });
});

describe('updateHyperCatalog on the embedded Hyper', () => {
    it('reports what the database has after a statement, whatever the statement says', async () => {
        const database = await setupWebHyperDB('hyper_catalog_relations_test', new TestLogger());
        const connection = await database.connect();
        const catalog = dql.createCatalog();
        const script = catalog.allocateEntryId();
        const functions = dql.createScript(catalog);
        const executor: QueryExecutor = (_id, args) => [1, connection.query(args.query) as never];
        const relations = [{ databaseName: 'hyper', schemaName: 'public', tableName: 'live_orders' }];
        const update = () => updateHyperCatalog(
            new TestLogger(), 'database', vi.fn(), 1, [], executor, catalog, dql, script, functions, true, new AbortController().signal,
            { processor: async request => dql.processBatch(request) }, relations,
        );
        /// The published tables as `schema.table(a, b)`
        const published = () => (catalog.describeEntriesOf(script).unpack() as dashql.buffers.catalog.CatalogEntriesT).entries.flatMap(entry =>
            entry.schemas.flatMap(schema => schema.tables.map(table =>
                `${schema.schemaName}.${table.tableName}(${table.columns.map(column => String(column.columnName)).join(', ')})`)));
        try {
            await connection.query('create table live_orders (id int, amount int)');
            await update();
            expect(published()).toEqual(['public.live_orders(id, amount)']);
            // The statement declares other columns, the table stays
            await connection.query('create table if not exists live_orders (other int)');
            await update();
            expect(published()).toEqual(['public.live_orders(id, amount)']);

            await connection.query('drop table live_orders');
            await update();
            expect(generateRelationsFile(catalog.readDescriptor(script))).not.toContain('live_orders');
        } finally {
            await connection.close();
        }
    });
});

