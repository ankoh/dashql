import * as core from '@ankoh/dashql-core';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TestLogger } from '../../testing/test_logger.js';
import { CONNECTOR_INFOS, ConnectorType } from '../../connections/connector_info.js';
import type { CancelQuery, QueryExecutionArgs, QueryExecutor } from '../../connections/query_execution_args.js';
import { WorkbookTestBackend, TEST_WORKBOOK_ID, testConnections, testWorkbook } from '../../testing/workbook_test_backend.js';
import { StorageWriter } from '../../storage/storage_writer.js';
import { QueryCacheMissError } from '../../query/query_result_cache.js';
import { memoryQueryResultCache } from '../../testing/memory_query_result_cache.js';
import { runWorkbookExecution, type ExecutionMounts, type WorkbookExecutionState } from './workbook_execution.js';
import {
    createWorkbookScripts,
    type WorkbookScripts,
    type WorkbookScriptsAction,
    reduceWorkbookScripts,
    REGISTER_QUERY,
    PROJECT_WORKBOOK,
    REGISTER_SCRIPT_RESULT,
    replaceScriptSessionText,
    SET_SCRIPT_CONNECTION,
    SET_SCRIPT_EXECUTION_VISUALIZATION,
    SET_SCRIPT_TEXT,
    SET_WORKBOOK_ATTACHMENTS,
} from './workbook_scripts.js';
import type { ModifyWorkbookScripts } from './workbook_scripts_registry_state.js';
import { createEmptyMetadata } from './script_types.js';
import { tableFromArrays } from '../../testing/arrow_fixtures.js';
import { createWorkbookZip, exportWorkbookAsSharedZip } from '../persistence/workbook_export.js';
import { readWorkbookBundleFromZip } from '../persistence/workbook_import.js';
import { openTestHyperDB } from '../../testing/test_hyperdb.js';
import type { HyperDB } from '../../platform/hyperdb/hyperdb_wasm.js';
import { importWorkbookQueryResults, retainWorkbookQueryResults } from '../persistence/workbook_query_results.js';
import { computeQueryCacheKeyForConnection } from '../../connections/query_executor_service.js';
import { decodeConnectionFromProto } from '../../connections/connection_import.js';
import type { ConnectionParams } from '../../connections/connection_params.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL;
const logger = new TestLogger();

/// The embedded database that writes and reads the workbook archives
let archiveDatabase: HyperDB;
let terminateArchiveDatabase: (() => Promise<void>) | null = null;

beforeAll(async () => {
    dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
    archiveDatabase = await openTestHyperDB('dashql-workbook-execution');
    terminateArchiveDatabase = () => archiveDatabase.terminate();
}, 60_000);
afterAll(async () => {
    await terminateArchiveDatabase?.();
});
afterEach(() => { vi.restoreAllMocks(); dql.resetUnsafe(); });

function fixture(entries: Array<[string, string]>) {
    const catalog = dql.createCatalog();
    const connection = { connectionId: crypto.randomUUID(), connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER], catalog, local: true };
    const sorted = [...entries].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
    let live: WorkbookScripts = createWorkbookScripts({
        instance: dql, workbookId: crypto.randomUUID(), name: 'Execution integration',
        pendingConnection: entries.length === 0 ? connection : null, workbookMetadata: createEmptyMetadata(),
        scripts: sorted.map(([name, sql]) => ({ name, sql, connection })),
    });
    const writer = new StorageWriter(logger, new WorkbookTestBackend());
    const write = vi.spyOn(writer, 'write');
    const apply = (action: WorkbookScriptsAction) => {
        live = reduceWorkbookScripts(live, action, writer, logger);
        return live;
    };
    const modifyWorkbookScripts = vi.fn<ModifyWorkbookScripts>(action => { apply(action); });
    const calls: Array<{ databaseId: string; queryId: number; sql: string }> = [];
    let nextQueryId = 0;
    const executeQuery = vi.fn<QueryExecutor>((connectionId, args) => {
        const queryId = ++nextQueryId;
        calls.push({ databaseId: connectionId, queryId, sql: args.query });
        return [queryId, Promise.resolve(args.analyzeResults ? tableFromArrays({ value: [1] }) : null)];
    });
    const cancelQuery = vi.fn<CancelQuery>(async () => {});
    const states: WorkbookExecutionState[] = [];
    const controller = new AbortController();
    const run = (options: Partial<Parameters<typeof runWorkbookExecution>[0]> = {}) => runWorkbookExecution({
        workbook: live, getWorkbook: () => live, executeQuery, cancelQuery, modifyWorkbookScripts,
        signal: controller.signal, onState: state => { states.push(state); },
        ...options,
    });
    const script = (fileName: string) => live.scripts[live.scriptRefs[fileName].scriptId];
    const lastState = () => states[states.length - 1];
    /// The plan of the workbook with the analyses as they are, e.g. as a run left them
    const plan = () => live.native!.workbook.planRun(null, '/mnt/external/cache');
    return { run, apply, script, getWorkbook: () => live, modifyWorkbookScripts, executeQuery,
        cancelQuery, controller, calls, states, lastState, plan, write };
}

describe('workbook execution with real core planning', () => {
    it('plans the scripts of every connection at once and runs them in the catalogs of their connections', async () => {
        const f = fixture([
            ['1_create.sql', 'create table items (id int);'],
            ['2_remote.sql', 'select 42;'],
            ['3_query.sql', 'select id from items;'],
        ]);
        const remote = { connectionId: crypto.randomUUID(), connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], catalog: dql.createCatalog() };
        const remoteKey = f.script('2_remote.sql').scriptKey;
        f.apply({ type: SET_SCRIPT_CONNECTION, value: { fileName: '2_remote.sql', connection: remote } });
        expect(f.script('2_remote.sql').scriptKey).toBe(remoteKey);
        await f.run();
        expect(f.lastState()?.error).toBeNull();
        const main = f.script('1_create.sql').connection.connectionId;
        const graph = f.plan();
        expect(graph.connections.map(connection => connection.connectionId)).toEqual([main, remote.connectionId]);
        expect(graph.scripts.map(script => [script.name, script.connection])).toEqual([['1_create', 0], ['2_remote', 1], ['3_query', 0]]);
        expect(f.calls.map(call => [call.databaseId, call.sql])).toEqual([
            [main, 'create table items (id int)'],
            [remote.connectionId, 'select 42'],
            [main, 'select id from items'],
        ]);
        // The query resolves the table that the first script created in the same catalog
        expect(graph.unresolvedReferences).toEqual([]);
        expect(f.lastState()).toMatchObject({ phase: 'succeeded', completedScripts: 3 });
    });

    it('hands a client function call to the runtime with the values of its inputs, and caches nothing', async () => {
        const f = fixture([['1_call.sql', `/* @param :id = 'Vip' */
call clfn.item_get (id => :id, size => 2);`]]);
        const script = f.script('1_call.sql');
        script.connection.catalog.registerClientFunctions(JSON.stringify({
            format: 1, namespace: 'clfn', functions: [{
                name: 'item_get', method: 'GET', path: '/items/{id}', options: [{ name: 'id', in: 'path', required: true }, { name: 'size', in: 'query' }],
            }],
        }));
        const args: QueryExecutionArgs[] = [];
        f.executeQuery.mockImplementation((_connectionId, query) => {
            args.push(query);
            return [1, Promise.resolve(tableFromArrays({ value: [1] }))];
        });
        const cache = memoryQueryResultCache();
        await f.run({ cache, resultKey: async () => 'key', cachesResults: () => true });
        expect(f.lastState()?.error).toBeNull();
        expect(args).toHaveLength(1);
        expect(args[0].query).toEqual("call clfn.item_get (id => 'Vip', size => 2)");
        expect(args[0].clientFunctionCall).toEqual({
            namespace: 'clfn', function: 'item_get', effect: 'read', explain: false, options: { id: 'Vip', size: 2 },
        });
        expect(args[0].cacheable).toEqual(false);
        expect(args[0].cacheOnly).toBeUndefined();
    });

    it('sends another call to the backend as written', async () => {
        const f = fixture([['1_call.sql', 'call other.procedure (a => 1);']]);
        f.script('1_call.sql').connection.catalog.registerClientFunctions(JSON.stringify({ format: 1, namespace: 'clfn', functions: [{ name: 'f' }] }));
        await f.run();
        expect(f.calls.map(call => call.sql)).toEqual(['call other.procedure (a => 1)']);
        expect(f.executeQuery.mock.calls[0][1].clientFunctionCall).toBeUndefined();
    });

    it('inlines a script reference of the same connection into the query', async () => {
        const f = fixture([
            ['0_setup.sql', 'create table items (id int);'],
            ['1_foo.sql', 'select id from items where id > 1;'],
            ['2_bar.sql', 'select count(*) from :"1_foo";'],
        ]);
        await f.run();
        expect(f.lastState()?.error).toBeNull();
        const main = f.script('1_foo.sql').connection.connectionId;
        expect(f.calls.map(call => [call.databaseId, call.sql])).toEqual([
            [main, 'create table items (id int)'],
            [main, 'select id from items where id > 1'],
            [main, 'with "1_foo" as (\nselect id from items where id > 1\n)\nselect count(*) from "1_foo"'],
        ]);
        expect(f.plan().references.map(reference => reference.cteName)).toEqual(['1_foo']);
    });

    it.each([false, true])('materializes a script of another connection for the embedded database and mounts it before the scan (caching %s)', async caching => {
        const f = fixture([
            ['1_foo.sql', 'select 1 as a;'],
            ['2_bar.sql', 'select count(*) from :"1_foo";'],
        ]);
        const remote = { connectionId: crypto.randomUUID(), connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], catalog: dql.createCatalog() };
        f.apply({ type: SET_SCRIPT_CONNECTION, value: { fileName: '1_foo.sql', connection: remote } });
        const main = f.script('2_bar.sql').connection.connectionId;
        const events: string[] = [];
        const cacheArgs: Array<Partial<QueryExecutionArgs>> = [];
        f.executeQuery.mockImplementation((connectionId, args) => {
            events.push(`query:${connectionId === main ? 'local' : 'remote'}`);
            cacheArgs.push({ cacheable: args.cacheable, refreshCache: args.refreshCache, cacheSignature: args.cacheSignature });
            f.calls.push({ databaseId: connectionId, queryId: f.calls.length + 1, sql: args.query });
            return [f.calls.length, Promise.resolve(tableFromArrays({ a: [1] }))];
        });
        const run = crypto.randomUUID();
        const mounts: ExecutionMounts = {
            prefix: '/mnt/external/cache',
            fileName: (key: string | null) => `${key ?? 'transient'}.${run}.parquet`,
            writeTable: vi.fn(async (path: string) => { events.push(`mount:${path.slice(path.lastIndexOf('/') + 1)}`); return new Blob(); }),
            use: vi.fn(async () => {}),
            release: vi.fn(async () => { events.push('release'); }),
        };
        await f.run({
            mounts,
            resultKey: async (connectionId, signature) => `${connectionId === main ? 'local' : 'remote'}:${signature}`,
            cachesResults: () => caching,
        });
        expect(f.lastState()?.error).toBeNull();
        // The remote query runs first, its result is mounted, the embedded database scans it
        const graph = f.plan();
        const fooKey = `remote:${graph.scripts[0].signature}`;
        // A result with a reusable key is a new file of its key, any other one a transient file
        const file = `${caching ? fooKey : 'transient'}.${run}.parquet`;
        expect(events).toEqual(['query:remote', `mount:${file}`, 'query:local', 'release']);
        const path = `/mnt/external/cache/${file}`;
        expect(f.calls.map(call => call.sql)).toEqual([
            'select 1 as a',
            `with "1_foo" as (select * from external('${path}', format => 'parquet'))\nselect count(*) from "1_foo"`,
        ]);
        // The run reads no cached result. The materialized result is the file of its key already, the result of bar
        // becomes the newest file of its key if it is reusable.
        expect(cacheArgs[0]).toEqual({ cacheable: false });
        expect(cacheArgs[1]).toEqual(caching
            ? { cacheable: true, refreshCache: true, cacheSignature: `${graph.scripts[1].signature}\n${fooKey}` }
            : { cacheable: false });
    });

    describe('cached results', () => {
        /// A workbook whose scripts read each other, the executor records the cache arguments of every query
        const cachedFixture = () => {
            const f = fixture([
                ['0_setup.sql', 'create table items (id int);'],
                ['1_foo.sql', 'select 1 as id;'],
                ['2_bar.sql', 'select count(*) from :"1_foo";'],
                ['3_qux.sql', 'select id from items;'],
            ]);
            const cache = memoryQueryResultCache();
            const queries: Array<{ sql: string; cacheOnly: boolean; cacheable: boolean; refreshCache: boolean }> = [];
            let miss = false;
            f.executeQuery.mockImplementation((connectionId, args) => {
                queries.push({ sql: args.query, cacheOnly: args.cacheOnly ?? false, cacheable: args.cacheable ?? false, refreshCache: args.refreshCache ?? false });
                f.calls.push({ databaseId: connectionId, queryId: f.calls.length + 1, sql: args.query });
                if (args.cacheOnly && miss) return [f.calls.length, Promise.reject(new QueryCacheMissError())];
                return [f.calls.length, Promise.resolve(args.analyzeResults ? tableFromArrays({ value: [1] }) : null)];
            });
            const options = { cache, resultKey: async (_connectionId: string, signature: string) => `key:${signature}`, cachesResults: () => true };
            const keyOf = (index: number): string => {
                const graph = f.plan();
                const script = graph.scripts[index];
                return `key:${[script.signature, ...(script.referencedScripts ?? []).map(r => keyOf(r))].join('\n')}`;
            };
            return { ...f, cache, queries, options, keyOf, missCachedResults: () => { miss = true; } };
        };

        const BAR = 'with "1_foo" as (\nselect 1 as id\n)\nselect count(*) from "1_foo"';

        it('serves the cached results of scripts and runs the others', async () => {
            const f = cachedFixture();
            await f.run(f.options);
            expect(f.lastState()?.error).toBeNull();
            // Without cached results every script runs, the queries with reusable keys are cached
            expect(f.queries.map(q => [q.sql, q.cacheOnly, q.cacheable])).toEqual([
                ['create table items (id int)', false, false],
                ['select 1 as id', false, true],
                [BAR, false, true],
                ['select id from items', false, true],
            ]);

            // foo is served, bar runs and still inlines the query of foo. qux reads what setup writes, it runs although
            // its result is cached.
            f.cache.put(f.keyOf(1));
            f.cache.put(f.keyOf(3));
            f.queries.length = 0;
            await f.run(f.options);
            expect(f.lastState()).toMatchObject({ phase: 'succeeded', completedScripts: 4, error: null });
            expect(f.queries.map(q => [q.sql, q.cacheOnly])).toEqual([
                ['select 1 as id', true],
                ['create table items (id int)', false],
                [BAR, false],
                ['select id from items', false],
            ]);
            // The served script registers its result
            expect(f.script('1_foo.sql').latestQueryId).not.toBeNull();
        });

        it('reads no cached results on a refresh', async () => {
            const f = cachedFixture();
            await f.run(f.options);
            f.cache.put(f.keyOf(1));
            f.queries.length = 0;
            await f.run({ ...f.options, refresh: true });
            expect(f.lastState()?.error).toBeNull();
            expect(f.queries.map(q => q.cacheOnly)).toEqual([false, false, false, false]);
            expect(f.queries.filter(q => q.cacheable).every(q => q.refreshCache)).toBe(true);
        });

        it('runs a script whose cached result is gone', async () => {
            const f = cachedFixture();
            await f.run(f.options);
            f.cache.put(f.keyOf(1));
            f.missCachedResults();
            f.queries.length = 0;
            await f.run(f.options);
            expect(f.lastState()?.error).toBeNull();
            expect(f.queries.map(q => [q.sql, q.cacheOnly])).toEqual([
                ['select 1 as id', true],
                ['create table items (id int)', false],
                ['select 1 as id', false],
                [BAR, false],
                ['select id from items', false],
            ]);
        });

        it('serves the cached results while the connection is not connected and skips the other scripts', async () => {
            const f = cachedFixture();
            await f.run(f.options);
            // qux reads what setup writes, setup can't run, so qux is served
            f.cache.put(f.keyOf(1));
            f.cache.put(f.keyOf(3));
            f.queries.length = 0;
            await f.run({ ...f.options, canRun: () => false });
            expect(f.lastState()).toMatchObject({ phase: 'succeeded', totalScripts: 4, completedScripts: 2, skippedScripts: 2, totalStatements: 0, error: null });
            // Only cached results are read, nothing reaches the backend
            expect(f.queries.map(q => [q.sql, q.cacheOnly])).toEqual([
                ['select 1 as id', true],
                ['select id from items', true],
            ]);
            expect(f.script('3_qux.sql').latestQueryId).not.toBeNull();
        });

        it('skips nothing while the connections are connected', async () => {
            const f = cachedFixture();
            await f.run({ ...f.options, canRun: () => true });
            expect(f.lastState()).toMatchObject({ phase: 'succeeded', completedScripts: 4, skippedScripts: 0 });
            expect(f.queries).toHaveLength(4);
        });

        it('scans the cached result of a script of a connection that is not connected, and skips the scan without it', async () => {
            const f = fixture([
                ['1_foo.sql', 'select 1 as a;'],
                ['2_bar.sql', 'select count(*) from :"1_foo";'],
                ['3_local.sql', 'select 2;'],
            ]);
            const remote = { connectionId: crypto.randomUUID(), connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], catalog: dql.createCatalog() };
            f.apply({ type: SET_SCRIPT_CONNECTION, value: { fileName: '1_foo.sql', connection: remote } });
            const main = f.script('2_bar.sql').connection.connectionId;
            const cache = memoryQueryResultCache();
            const queries: Array<{ connection: string; sql: string; cacheOnly: boolean }> = [];
            f.executeQuery.mockImplementation((connectionId, args) => {
                queries.push({ connection: connectionId === main ? 'local' : 'remote', sql: args.query, cacheOnly: args.cacheOnly ?? false });
                return [queries.length, Promise.resolve(tableFromArrays({ a: [1] }))];
            });
            const mounts: ExecutionMounts = {
                prefix: '/mnt/external/cache',
                fileName: (key: string | null) => `${key ?? 'transient'}.run.parquet`,
                writeTable: vi.fn(async () => new Blob()),
                use: vi.fn(async () => {}),
                release: vi.fn(async () => {}),
            };
            const options = {
                mounts, cache,
                resultKey: async (connectionId: string, signature: string) => `${connectionId === main ? 'local' : 'remote'}:${signature}`,
                cachesResults: (connectionId: string) => connectionId !== main,
                canRun: (connectionId: string) => connectionId === main,
            };
            // Without a cached result of foo, bar is skipped with foo, the other scripts of the embedded database run
            await f.run(options);
            expect(f.lastState()).toMatchObject({ phase: 'succeeded', completedScripts: 1, skippedScripts: 2, error: null });
            expect(queries).toEqual([{ connection: 'local', sql: 'select 2', cacheOnly: false }]);
            expect(mounts.writeTable).not.toHaveBeenCalled();

            const fooKey = `remote:${f.plan().scripts[0].signature}`;
            const file = cache.put(fooKey);
            queries.length = 0;
            await f.run(options);
            expect(f.lastState()).toMatchObject({ phase: 'succeeded', completedScripts: 3, skippedScripts: 0, error: null });
            expect(queries).toEqual([
                { connection: 'remote', sql: 'select 1 as a', cacheOnly: true },
                { connection: 'local', sql: `with "1_foo" as (select * from external('/mnt/external/cache/${file}', format => 'parquet'))\nselect count(*) from "1_foo"`, cacheOnly: false },
                { connection: 'local', sql: 'select 2', cacheOnly: false },
            ]);
        });

        it('serves every script of an exported workbook with its results after an import, without a connection', async () => {
            const f = fixture([
                ['1_foo.sql', 'select 1 as id;'],
                ['2_bar.sql', 'select count(*) from :"1_foo";'],
                ['3_qux.sql', '/* @vis bar x=id y=id */\nselect 2 as id;'],
            ]);
            const remote = { connectionId: crypto.randomUUID(), connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], catalog: dql.createCatalog() };
            for (const fileName of ['1_foo.sql', '2_bar.sql', '3_qux.sql']) {
                f.apply({ type: SET_SCRIPT_CONNECTION, value: { fileName, connection: remote } });
            }
            const keyOf = async (_connectionId: string, signature: string) => {
                const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature));
                return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
            };
            // An online run writes the results under the keys of the run
            const source = memoryQueryResultCache();
            f.executeQuery.mockImplementation((_connectionId, args) => {
                const id = f.calls.push({ databaseId: _connectionId, queryId: f.calls.length + 1, sql: args.query });
                if (args.refreshCache && args.cacheSignature != null) {
                    void keyOf('', args.cacheSignature).then(key => source.put(key, null, new TextEncoder().encode(args.query)));
                }
                if (args.cacheOnly) return [id, Promise.reject(new QueryCacheMissError())];
                return [id, Promise.resolve(tableFromArrays({ id: [1] }))];
            });
            const services = { createMounts: () => null, cacheKey: keyOf, cachesResults: () => true, cache: source, maxConcurrentQueries: () => 1 };
            await f.run({ cache: source, resultKey: keyOf, cachesResults: () => true });
            expect(f.lastState()).toMatchObject({ phase: 'succeeded', completedScripts: 3 });
            await vi.waitFor(() => expect(source.files.size).toBe(3));

            // The export carries the files under the keys that a run reads
            const retained = await retainWorkbookQueryResults(services, f.getWorkbook(), source);
            expect(retained).toMatchObject({ cachedScripts: 3, totalScripts: 3 });
            const zip = await createWorkbookZip({ database: archiveDatabase, core: dql }, { workbook: testWorkbook(), catalogs: [], scripts: [], results: retained.results });
            await retained.release();
            const bundle = await readWorkbookBundleFromZip(zip, archiveDatabase);
            expect(bundle.results).toHaveLength(3);

            // Another app imports them and runs without a connection
            const target = memoryQueryResultCache();
            expect(await importWorkbookQueryResults(target, bundle.results!)).toMatchObject({ added: 3, kept: 0, failed: 0 });
            const served: string[] = [];
            f.executeQuery.mockImplementation((_connectionId, args) => {
                if (!args.cacheOnly) throw new Error(`${args.query} reached the backend`);
                served.push(args.query);
                return [served.length, Promise.resolve(tableFromArrays({ id: [1] }))];
            });
            await f.run({ cache: target, resultKey: keyOf, cachesResults: () => true, canRun: () => false });
            expect(f.lastState()).toMatchObject({ phase: 'succeeded', completedScripts: 3, skippedScripts: 0, error: null });
            expect(served).toHaveLength(3);
            expect(f.script('3_qux.sql').latestResultQueryId).not.toBeNull();
        });

        it('serves a shared file on the connection that its import creates, under the keys of the app', async () => {
            // The connection of the sharer carries secrets and a login, the file carries neither
            const live = { trino: {
                endpoint: 'https://trino.example', defaultCatalog: 'hive', defaultSchema: 'sales', catalogs: ['hive.sales'],
                metadata: { authorization: 'Bearer secret-token' },
                auth: { authType: 'AUTH_BASIC', basic: { username: 'alice', secret: 'secret-password' } },
            } } as unknown as ConnectionParams;
            // The keys of the app: the connection as storage restores it, the signature that the executor gets
            const keysOf = (params: ConnectionParams) => {
                const [, details] = decodeConnectionFromProto(params as never, '');
                return async (_connectionId: string, signature: string) => await computeQueryCacheKeyForConnection(details, signature);
            };
            const files: Array<[string, string]> = [
                ['1_foo.sql', 'select 1 as id;'],
                ['2_bar.sql', 'select count(*) from :"1_foo";'],
                ['3_qux.sql', '/* @vis bar x=id y=id */\nselect 2 as id;'],
            ];

            // The sharer runs the workbook online, the results land under the keys of its connection
            const f = fixture(files);
            const sharer = { connectionId: crypto.randomUUID(), connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], catalog: dql.createCatalog() };
            const sharerConnectionId = sharer.connectionId;
            const sharerKey = keysOf(live);
            for (const [fileName] of files) f.apply({ type: SET_SCRIPT_CONNECTION, value: { fileName, connection: sharer } });
            const source = memoryQueryResultCache();
            const writes: Promise<unknown>[] = [];
            f.executeQuery.mockImplementation((connectionId, args) => {
                const id = f.calls.push({ databaseId: connectionId, queryId: f.calls.length + 1, sql: args.query });
                if (args.cacheOnly) return [id, Promise.reject(new QueryCacheMissError())];
                if (args.refreshCache && args.cacheSignature != null) {
                    writes.push(sharerKey(connectionId, args.cacheSignature).then(key => source.put(key!, null, new TextEncoder().encode(args.query))));
                }
                return [id, Promise.resolve(tableFromArrays({ id: [1] }))];
            });
            await f.run({ cache: source, resultKey: sharerKey, cachesResults: () => true });
            expect(f.lastState().error).toBeNull();
            expect(f.lastState()).toMatchObject({ phase: 'succeeded', completedScripts: 3 });
            await Promise.all(writes);
            expect(source.files.size).toBe(3);

            // The file of the workbook, from storage like the save overlay writes it
            const backend = new WorkbookTestBackend();
            await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook({
                ...testConnections({ connectionId: sharerConnectionId, params: live }),
                scripts: files.map(([name]) => ({ name, connectionId: sharerConnectionId })),
            }));
            for (const [name, sql] of files) await backend.saveScript(TEST_WORKBOOK_ID, name, sql);
            const services = { createMounts: () => null, cacheKey: sharerKey, cachesResults: () => true, cache: source, maxConcurrentQueries: () => 1 };
            const retained = await retainWorkbookQueryResults(services, f.getWorkbook(), source);
            expect(retained).toMatchObject({ cachedScripts: 3, totalScripts: 3 });
            const zip = await exportWorkbookAsSharedZip(backend, { database: archiveDatabase, core: dql }, TEST_WORKBOOK_ID, new Map([[sharerConnectionId, live]]), {
                withLoginHint: false, queryResults: retained.results,
            });
            await retained.release();

            // The recipient imports it: a new connection from the shared params, new ids, its own core workbook
            const bundle = await readWorkbookBundleFromZip(zip, archiveDatabase);
            const [shared] = bundle.workbook.connections;
            expect(JSON.stringify(shared.params)).not.toMatch(/secret-password|secret-token|alice/);
            expect(shared.connectionId).not.toBe(sharerConnectionId);
            const recipientKey = keysOf(shared.params);
            // The key follows the endpoint, a workbook of another backend finds nothing
            expect(await keysOf({ trino: { ...(shared.params as any).trino, endpoint: 'https://other.example' } } as ConnectionParams)('', 'select 1'))
                .not.toBe(await recipientKey('', 'select 1'));
            const target = memoryQueryResultCache();
            expect(await importWorkbookQueryResults(target, bundle.results!)).toMatchObject({ added: 3, kept: 0, failed: 0 });
            const g = fixture(bundle.scripts.map(script => [script.name, script.sql]));
            const recipient = { connectionId: shared.connectionId, connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], catalog: dql.createCatalog() };
            for (const script of bundle.scripts) g.apply({ type: SET_SCRIPT_CONNECTION, value: { fileName: script.name, connection: recipient } });
            // The executor serves a query from the file of the key of its connection and signature, or misses
            g.executeQuery.mockImplementation((connectionId, args) => {
                if (!args.cacheOnly) throw new Error(`${args.query} reached the backend`);
                const served = recipientKey(connectionId, args.cacheSignature!)
                    .then(key => target.lookup(key!))
                    .then(entry => entry != null ? tableFromArrays({ id: [1] }) : Promise.reject(new QueryCacheMissError()));
                return [g.calls.push({ databaseId: connectionId, queryId: g.calls.length + 1, sql: args.query }), served];
            });
            await g.run({ cache: target, resultKey: recipientKey, cachesResults: () => true, canRun: () => false });
            expect(g.lastState().error).toBeNull();
            expect(g.lastState()).toMatchObject({ phase: 'succeeded', completedScripts: 3, skippedScripts: 0 });
            expect(g.calls).toHaveLength(3);
        });

        it('scans the cached result of a script of another connection instead of running it', async () => {
            const f = fixture([
                ['1_foo.sql', 'select 1 as a;'],
                ['2_bar.sql', 'select count(*) from :"1_foo";'],
            ]);
            const remote = { connectionId: crypto.randomUUID(), connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], catalog: dql.createCatalog() };
            f.apply({ type: SET_SCRIPT_CONNECTION, value: { fileName: '1_foo.sql', connection: remote } });
            const main = f.script('2_bar.sql').connection.connectionId;
            const cache = memoryQueryResultCache();
            const queries: Array<{ connection: string; sql: string; cacheOnly: boolean }> = [];
            f.executeQuery.mockImplementation((connectionId, args) => {
                queries.push({ connection: connectionId === main ? 'local' : 'remote', sql: args.query, cacheOnly: args.cacheOnly ?? false });
                return [queries.length, Promise.resolve(tableFromArrays({ a: [1] }))];
            });
            const mounts: ExecutionMounts = {
                prefix: '/mnt/external/cache',
                fileName: (key: string | null) => `${key ?? 'transient'}.run.parquet`,
                writeTable: vi.fn(async () => new Blob()),
                use: vi.fn(async () => {}),
                release: vi.fn(async () => {}),
            };
            // Plan once to learn the signature of foo
            await f.run({ mounts });
            const fooKey = `remote:${f.plan().scripts[0].signature}`;
            const file = cache.put(fooKey);
            queries.length = 0;
            await f.run({
                mounts, cache,
                resultKey: async (connectionId, signature) => `${connectionId === main ? 'local' : 'remote'}:${signature}`,
                cachesResults: () => true,
            });
            expect(f.lastState()?.error).toBeNull();
            // foo is served from the cache, bar scans the cached file, nothing runs remotely
            expect(queries).toEqual([
                { connection: 'remote', sql: 'select 1 as a', cacheOnly: true },
                { connection: 'local', sql: `with "1_foo" as (select * from external('/mnt/external/cache/${file}', format => 'parquet'))\nselect count(*) from "1_foo"`, cacheOnly: false },
            ]);
            expect(mounts.use).toHaveBeenCalledWith(`/mnt/external/cache/${file}`);
            expect(cache.retain).toHaveBeenCalledWith(fooKey);
        });
    });

    it('fails a run in which a remote connection reads a script of another connection', async () => {
        const f = fixture([
            ['1_foo.sql', 'select 1 as a;'],
            ['2_bar.sql', 'select count(*) from :"1_foo";'],
        ]);
        const remote = { connectionId: crypto.randomUUID(), connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], catalog: dql.createCatalog() };
        f.apply({ type: SET_SCRIPT_CONNECTION, value: { fileName: '2_bar.sql', connection: remote } });
        await f.run();
        expect(f.executeQuery).not.toHaveBeenCalled();
        expect(f.lastState()).toMatchObject({ phase: 'failed' });
        expect(f.lastState()?.error).toContain('2_bar.sql runs on the connection');
    });

    it('executes create, insert, and select across scripts in natural order with real dependencies', async () => {
        const f = fixture([
            ['10_query.sql', 'select id from items;'],
            ['2_insert.sql', 'insert into items values (7);'],
            ['1_create.sql', 'create table items (id int);'],
        ]);
        await f.run();
        expect(f.lastState()?.error).toBeNull();

        const graph = f.plan();
        expect(graph.scripts.map(script => script.name)).toEqual(['1_create', '2_insert', '10_query']);
        expect(f.calls).toEqual([
            { databaseId: f.script('1_create.sql').connection.connectionId, queryId: 1, sql: 'create table items (id int)' },
            { databaseId: f.script('1_create.sql').connection.connectionId, queryId: 2, sql: 'insert into items values (7)' },
            { databaseId: f.script('1_create.sql').connection.connectionId, queryId: 3, sql: 'select id from items' },
        ]);
        expect(graph.valid).toBe(true);
        expect(graph.nodes.map(node => [node.script, node.statementId, node.producesOutput]))
            .toEqual([[0, 0, false], [1, 0, false], [2, 0, true]]);
        expect(graph.entities.map(entity => entity.name)).toEqual(['items']);
        expect(graph.unresolvedReferences).toEqual([]);
        expect(graph.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({ from: 0, to: 1, reason: core.buffers.execution.ExecutionGraphEdgeReason.DDL }),
            expect.objectContaining({ from: 1, to: 2, reason: core.buffers.execution.ExecutionGraphEdgeReason.READ_AFTER_WRITE }),
        ]));
        expect(f.lastState()).toEqual({
            phase: 'succeeded', totalScripts: 3, completedScripts: 3,
            totalStatements: 3, completedStatements: 3,
            activeFileName: null, activeStatementIndex: null, activeStatementCount: null, error: null, skippedScripts: 0, skippedFiles: [],
        });
        expect(f.cancelQuery).not.toHaveBeenCalled();
    });

    it('synchronizes analysis through the reducer before backend calls and retains query registrations', async () => {
        const f = fixture([
            ['1_create.sql', 'create table items (id int);'],
            ['2_query.sql', 'select id from items;'],
        ]);
        const initial = f.getWorkbook();
        const executor = f.executeQuery.getMockImplementation()!;
        f.executeQuery.mockImplementation((connectionId, args) => {
            expect(f.getWorkbook()).not.toBe(initial);
            for (const script of Object.values(f.getWorkbook().scripts)) {
                expect(script.analysisOutdated).toBe(false);
                expect(script.editorUpdate).toMatchObject({
                    status: core.buffers.editor.EditorUpdateStatus.OK, analysisAvailable: true,
                    textVersion: script.scriptSession.getTextVersion(),
                    catalogRevision: script.scriptSession.getCatalogRevision(),
                });
            }
            expect(f.script('1_create.sql').annotations.tableDefs).toEqual(['items']);
            return executor(connectionId, args);
        });
        await f.run();

        // The run changes the Rust workbook, the app projects it again
        const actions = f.modifyWorkbookScripts.mock.calls.map(([action]) => action);
        expect(actions.length).toBeGreaterThan(0);
        expect(actions.every(action => action.type === PROJECT_WORKBOOK)).toBe(true);
        expect(f.script('2_query.sql').latestResultQueryId).toBe(2);
        expect(f.script('1_create.sql').latestQueryId).toBe(1);
        expect(f.script('2_query.sql').latestQueryId).toBe(2);
        expect(f.write).not.toHaveBeenCalled();
        expect(f.lastState().phase).toBe('succeeded');
    });

    it('analyzes only the last output per script and restores it after trailing commands', async () => {
        const f = fixture([
            ['1_outputs.sql', 'create table items (id int); select 1; select 2; insert into items values (3);'],
            ['2_outputs.sql', 'select id from items; select 4;'],
        ]);
        f.apply({ type: REGISTER_QUERY, value: [f.script('1_outputs.sql').scriptKey, 0] });
        f.apply({ type: REGISTER_SCRIPT_RESULT, value: [f.script('1_outputs.sql').scriptKey, 0] });
        await f.run();

        expect(f.plan().nodes.map(node => node.producesOutput)).toEqual([false, true, true, false, true, true]);
        expect(f.executeQuery.mock.calls.map(([, args]) => args.analyzeResults))
            .toEqual([false, false, true, false, false, true]);
        expect(f.script('1_outputs.sql').latestQueryId).toBe(3);
        expect(f.script('2_outputs.sql').latestQueryId).toBe(6);
        expect(f.calls.map(call => call.queryId)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(f.lastState()).toMatchObject({ phase: 'succeeded', completedStatements: 6, completedScripts: 2 });
    });

    it('executes EXPLAIN as an output statement', async () => {
        const f = fixture([['1_explain.sql', 'explain select 2;']]);
        await f.run();

        expect(f.plan().valid).toBe(true);
        expect(f.plan().nodes[0]).toMatchObject({ producesOutput: true, visualization: null });
        expect(f.calls.map(call => call.sql)).toEqual(['explain select 2']);
        expect(f.executeQuery.mock.calls[0][1]).toMatchObject({ analyzeResults: true, publishResults: true });
        expect(f.script('1_explain.sql').annotations.visualizeQuery).toBeNull();
        expect(f.lastState().phase).toBe('succeeded');
    });

    it('lowers multiple visualizations and retains the last output after trailing DELETE', async () => {
        const f = fixture([['1_visualize.sql',
            'create table items (id int);\n/* @vis table */\nselect id from items;\n'
            + '/* @vis table\n   @board row=2 column=4 width=8 height=5 */\nselect 2 as value;\n'
            + 'delete from items;']]);
        await f.run();

        expect(f.plan().valid).toBe(true);
        expect(f.calls.map(call => call.sql)).toEqual([
            'create table items (id int)', 'select id from items', 'select 2 as value', 'delete from items',
        ]);
        expect(f.executeQuery.mock.calls.map(([, args]) => args.analyzeResults)).toEqual([false, false, true, false]);
        expect(f.script('1_visualize.sql')).toMatchObject({
            latestQueryId: 3, latestResultQueryId: 3,
            annotations: { visualizeQuery: { renderer: 'table', sql: 'select 2 as value', statementId: 2,
                dashboardSpec: { row: 2, column: 4, width: 8, height: 5 } } },
        });
        // The card of the captured statement can be moved although a DELETE follows it
        expect(f.script('1_visualize.sql').scriptSession.rewriteVisBoard(2, 0, 0, 6, 3)).toBe(
            'create table items (id int);\n/* @vis table */\nselect id from items;\n'
            + '/**\n * @vis table\n * @board row=0 column=0 width=6 height=3\n */\nselect 2 as value;\n'
            + 'delete from items;');
        expect(f.write).not.toHaveBeenCalled();
        expect(f.lastState().phase).toBe('succeeded');
    });

    it('uses captured visualization despite live edits during execution', async () => {
        const f = fixture([['1_visualize.sql',
            'create table items (id int, other int);\n'
            + '/* @vis table\n   @board row=2 column=4 */\nselect id from items;']]);
        const executor = f.executeQuery.getMockImplementation()!;
        f.executeQuery.mockImplementation((connectionId, args) => {
            const execution = executor(connectionId, args);
            if (!args.analyzeResults) {
                f.apply({ type: SET_SCRIPT_TEXT, value: { scriptKey: f.script('1_visualize.sql').scriptKey,
                    text: '/* @vis table */\nselect other from items;' } });
            } else {
                execution[1] = execution[1].then(table => {
                    f.apply({ type: SET_SCRIPT_TEXT, value: { scriptKey: f.script('1_visualize.sql').scriptKey, text: 'select 9;' } });
                    return table;
                });
            }
            return execution;
        });
        await f.run();

        expect(f.calls.map(call => call.sql)).toEqual([
            'create table items (id int, other int)',
            'select id from items',
        ]);
        expect(f.script('1_visualize.sql').scriptSession.getText()).toBe('select 9;');
        expect(f.script('1_visualize.sql').annotations.visualizeQuery).toMatchObject({
            renderer: 'table', sql: 'select id from items',
            dashboardSpec: { row: 2, column: 4 },
        });
        expect(f.lastState().phase).toBe('succeeded');
    });

    it('clears live visualization metadata when the captured output is no visualization', async () => {
        const f = fixture([['1_query.sql', 'create table items (id int); select 1;']]);
        const executor = f.executeQuery.getMockImplementation()!;
        f.executeQuery.mockImplementation((connectionId, args) => {
            if (!args.analyzeResults) {
                f.apply({ type: SET_SCRIPT_TEXT, value: { scriptKey: f.script('1_query.sql').scriptKey,
                    text: '/* @vis table */\nselect 2;' } });
                expect(f.script('1_query.sql').annotations.visualizeQuery?.renderer).toBe('table');
            }
            return executor(connectionId, args);
        });
        await f.run();

        expect(f.calls.map(call => call.sql)).toEqual(['create table items (id int)', 'select 1']);
        expect(f.script('1_query.sql').annotations.visualizeQuery).toBeNull();
        expect(f.lastState().phase).toBe('succeeded');
    });

    it('changes only the visualization annotation without analysis, catalog publication, or storage', () => {
        const f = fixture([['1_query.sql', 'select 1;']]);
        const previous = f.script('1_query.sql');
        const analyze = vi.spyOn(previous.scriptSession, 'analyze');
        const publish = vi.spyOn(previous.scriptSession, 'loadIntoCatalog');
        const compiled = new core.buffers.execution.CompiledVisualizationT('table');
        f.apply({ type: SET_SCRIPT_EXECUTION_VISUALIZATION, value: [previous.scriptKey, { sql: 'select 1', statementId: 0, visualization: compiled }] });

        const next = f.script('1_query.sql');
        const visualizeQuery = { renderer: 'table', sql: 'select 1', statementId: 0, dashboardSpec: null };
        expect(next).toEqual({ ...previous, annotations: { ...previous.annotations, visualizeQuery } });
        expect(next.annotations.tableDefs).toEqual(previous.annotations.tableDefs);
        expect(analyze).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
        expect(f.write).not.toHaveBeenCalled();
        f.apply({ type: SET_SCRIPT_EXECUTION_VISUALIZATION, value: [previous.scriptKey, null] });
        expect(f.script('1_query.sql').annotations.visualizeQuery).toBeNull();
    });

    it('runs an unsupported SET as a barrier in workbook order', async () => {
        const f = fixture([
            ['1_valid.sql', 'select 1;'],
            ['2_set.sql', 'set foo = 1;'],
            ['3_after.sql', 'select 2;'],
        ]);
        await f.run();

        const graph = f.plan();
        expect(graph.valid).toBe(true);
        expect(graph.diagnostics.map(d => [d.error, d.message])).toEqual([
            [false, 'unsupported statement effects; backend session semantics are not guaranteed']]);
        expect(f.calls.map(call => call.sql)).toEqual(['select 1', 'set foo = 1', 'select 2']);
        expect(f.lastState()).toMatchObject({ phase: 'succeeded', completedStatements: 3 });
    });

    it('plans again from edited live workbooks on rerun rather than reusing captured SQL', async () => {
        const f = fixture([['1_query.sql', 'select 1;']]);
        await f.run();
        const previousVersion = f.plan().scripts[0].textVersion;
        f.apply({ type: SET_SCRIPT_TEXT, value: { scriptKey: f.script('1_query.sql').scriptKey, text: 'select 2; select 3;' } });
        await f.run();

        expect(f.plan().scripts[0].textVersion).not.toBe(previousVersion);
        expect(f.plan().scripts[0].textVersion).toBe(f.script('1_query.sql').scriptSession.getTextVersion());
        expect(f.calls.map(call => call.sql)).toEqual(['select 1', 'select 2', 'select 3']);
        expect(f.executeQuery.mock.calls.map(([, args]) => args.analyzeResults)).toEqual([true, false, true]);
        expect(f.script('1_query.sql').latestQueryId).toBe(3);
        expect(f.lastState()).toMatchObject({ phase: 'succeeded', totalStatements: 2, completedStatements: 2 });
    });

    it('fails a plan when the live text changes before its statements run', async () => {
        const f = fixture([['1_query.sql', 'select 1;']]);
        await f.run({
            onState: state => {
                f.states.push(state);
                if (state.phase === 'running' && f.script('1_query.sql').scriptSession.getText() === 'select 1;') {
                    f.apply({ type: SET_SCRIPT_TEXT, value: { scriptKey: f.script('1_query.sql').scriptKey, text: 'select 2;' } });
                }
            },
        });

        expect(f.script('1_query.sql').scriptSession.getText()).toBe('select 2;');
        expect(f.executeQuery).not.toHaveBeenCalled();
        expect(f.script('1_query.sql').latestQueryId).toBeNull();
        expect(f.lastState()).toMatchObject({ phase: 'failed', completedStatements: 0, completedScripts: 0 });
        expect(f.lastState().error).toMatch(/stale execution plan/i);
    });

    it('scans a Parquet attachment of the workbook from the mount of its attachments', async () => {
        const f = fixture([['bar.sql', 'select count(*) from :sales;']]);
        f.apply({ type: SET_WORKBOOK_ATTACHMENTS, value: [{ name: 'sales.parquet', sizeBytes: 10, mtimeMs: 1 }, { name: 'notes.txt', sizeBytes: 3 }] });
        const mountAttachments = vi.fn(async () => {});
        await f.run({ mountAttachments });
        expect(f.lastState()?.error).toBeNull();
        const workbookId = f.getWorkbook().workbookId;
        expect(mountAttachments).toHaveBeenCalledWith(workbookId);
        expect(f.plan().attachments.map(attachment => [attachment.name, attachment.file])).toEqual([['sales', 'sales.parquet']]);
        expect(f.calls.map(call => call.sql)).toEqual([
            `with sales as (select * from external('/mnt/external/attachments/${workbookId}/sales.parquet', format => 'parquet'))\nselect count(*) from sales`,
        ]);
    });

    it('fails a plan that scans an attachment without the compute database', async () => {
        const f = fixture([['bar.sql', 'select count(*) from :sales;']]);
        f.apply({ type: SET_WORKBOOK_ATTACHMENTS, value: [{ name: 'sales.parquet', sizeBytes: 10, mtimeMs: 1 }] });
        await f.run();
        expect(f.calls).toEqual([]);
        expect(f.lastState()).toMatchObject({ phase: 'failed', error: 'Scripts that read attachments need the compute database' });
    });
});
