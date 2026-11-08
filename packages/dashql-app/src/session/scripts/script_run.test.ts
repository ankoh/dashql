import * as core from '@ankoh/dashql-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TestLogger } from '../../platform/logger/test_logger.js';
import { CONNECTOR_INFOS, ConnectorType } from '../../connections/connector_info.js';
import type { QueryExecutor } from '../../connections/query_executor.js';
import type { ParquetDatabase } from '../../platform/hyperdb/hyperdb_parquet_export.js';
import { memoryQueryResultCache } from '../../tests/memory_query_result_cache.js';
import { QueryCacheMissError } from '../../query/query_result_cache.js';
import { SessionTestBackend } from '../../storage/session_test_backend.js';
import { StorageWriter } from '../../storage/storage_writer.js';
import { computeScriptResultKeys, createExecutionMounts, createMountPrefix, isSessionExecutionRunning, planSessionScripts, prepareSessionScripts, subscribeSessionExecutions, type ExecutionMounts } from './session_execution.js';
import { computeScriptResultCacheKey, registerScriptRunServices, runPlannedScript, type ScriptRunOptions, type ScriptRunServices } from './script_run.js';
import { runSessionScript, runSessionScriptForResult } from './rerun_query.js';
import {
    ANALYZE_OUTDATED_SCRIPT, REGISTER_QUERY, REGISTER_SCRIPT_RESULT, SET_SCRIPT_EXECUTION_VISUALIZATION, createEmptyScriptData, reduceSessionScripts,
    scriptResultOwner,
    replaceScriptSessionText, SET_SCRIPT_CONNECTION, type SessionScripts, type SessionScriptsAction,
} from './session_scripts.js';
import type { ModifySessionScripts } from './session_scripts_registry.js';
import { createEmptyMetadata, createScriptRef } from './script_types.js';
import { tableFromArrays } from '../../tests/arrow_fixtures.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL;
const logger = new TestLogger();

beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });
afterEach(() => { vi.restoreAllMocks(); registerScriptRunServices(dql, null); dql.resetUnsafe(); });

/// A session with scripts on the embedded database, `remote` moves scripts to a Trino connection. `caching` tells
/// whether the connections cache query results, `clientFunctions` is a spec of the Trino connection.
function fixture(entries: Array<[string, string]>, remote: string[] = [], caching = true, clientFunctions?: string) {
    const connection = { connectionId: crypto.randomUUID(), connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER], catalog: dql.createCatalog(), local: true };
    const trino = { connectionId: crypto.randomUUID(), connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], catalog: dql.createCatalog() };
    if (clientFunctions !== undefined) trino.catalog.registerClientFunctions(clientFunctions);
    const scripts: SessionScripts['scripts'] = {};
    const scriptRefs: SessionScripts['scriptRefs'] = {};
    for (const [fileName, text] of entries) {
        const [scriptKey, script] = createEmptyScriptData(dql, connection, fileName);
        replaceScriptSessionText(script.scriptSession, text);
        scripts[scriptKey] = script;
        scriptRefs[fileName] = createScriptRef(scriptKey, fileName);
    }
    let live: SessionScripts = {
        instance: dql, sessionId: crypto.randomUUID(), name: 'References',
        pendingConnection: null, sessionMetadata: createEmptyMetadata(),
        scripts, scriptRefs, scriptOrder: entries.map(([fileName]) => fileName), scriptFocus: { fileName: entries[0][0] }, semanticUserFocus: null,
    };
    const writer = new StorageWriter(logger, new SessionTestBackend());
    const apply = (action: SessionScriptsAction) => { live = reduceSessionScripts(live, action, writer, logger); return live; };
    for (const fileName of remote) apply({ type: SET_SCRIPT_CONNECTION, value: { fileName, connection: trino } });
    const modifySessionScripts = vi.fn<ModifySessionScripts>(action => Promise.resolve(apply(action)));
    const calls: Array<{ connection: 'local' | 'remote'; sql: string; cacheable?: boolean; cacheSignature?: string; refreshCache?: boolean }> = [];
    const executeQuery = vi.fn<QueryExecutor>((connectionId, args) => {
        calls.push({
            connection: connectionId === connection.connectionId ? 'local' : 'remote', sql: args.query, cacheable: args.cacheable, cacheSignature: args.cacheSignature,
            ...(args.refreshCache ? { refreshCache: true } : {}),
        });
        return [calls.length, Promise.resolve(tableFromArrays({ a: [calls.length] }))];
    });
    const cache = memoryQueryResultCache();
    // The mounts of the runs, the memory cache doesn't touch the database
    const mounts: ExecutionMounts[] = [];
    const createMounts = () => {
        const inner = createExecutionMounts(cache, {} as ParquetDatabase);
        const run: ExecutionMounts = {
            prefix: inner.prefix,
            fileName: vi.fn((key: string | null) => inner.fileName(key)),
            writeTable: vi.fn((path: string, table) => inner.writeTable(path, table)),
            use: vi.fn((path: string) => inner.use(path)),
            release: vi.fn(() => inner.release()),
        };
        mounts.push(run);
        return run;
    };
    const services: ScriptRunServices = {
        createMounts,
        cacheKey: async (connectionId, signature) => `${connectionId === connection.connectionId ? 'local' : 'remote'}:${signature}`,
        cachesResults: () => caching,
        cache,
        maxConcurrentQueries: () => 1,
    };
    const script = (fileName: string) => live.scripts[live.scriptRefs[fileName].scriptId];
    const run = (fileName: string, options: ScriptRunOptions = {}) => runPlannedScript(services, live, script(fileName), executeQuery, modifySessionScripts, options);
    /// The target plan of a script after analyzing the session
    const planOf = async (fileName: string) => {
        const scripts = live.scriptOrder.map(file => script(file));
        await prepareSessionScripts(scripts, async () => {});
        return planSessionScripts({
            instance: dql, scripts, files: live.scriptOrder,
            mountPrefix: createMountPrefix(), targets: [live.scriptOrder.indexOf(fileName)],
        }).graph;
    };
    return { session: () => live, script, run, planOf, services, calls, cache, mounts, modifySessionScripts, executeQuery };
}

describe('script runs', () => {
    it('derives the cache key of a script from the keys of the scripts it references', async () => {
        const f = fixture([['base.sql', 'select 1 as a;'], ['writes.sql', 'create table t (a int);\nselect a from t;'], ['bar.sql', 'select * from :base;'], ['baz.sql', 'create table u as select * from :base;\nselect a from u;']]);
        const session = f.session();
        const scripts = session.scriptOrder.map(file => f.script(file));
        await prepareSessionScripts(scripts, async () => {});
        const { graph } = planSessionScripts({ instance: dql, scripts, files: session.scriptOrder, mountPrefix: createMountPrefix() });
        const keys = await computeScriptResultKeys(graph, async (index, signature) => `${index}:${signature}`, () => true);
        expect(keys[0]).toEqual({ key: `0:${graph.scripts[0].signature}`, signature: graph.scripts[0].signature, reusable: true });
        // A script that references a cacheable script covers the key of that script
        expect(keys[2]).toEqual({ key: `2:${graph.scripts[2].signature}\n${keys[0]!.key}`, signature: `${graph.scripts[2].signature}\n${keys[0]!.key}`, reusable: true });
        // A script with other statements than queries has a key, its results are not reused
        expect(keys[1]).toEqual({ key: `1:${graph.scripts[1].signature}`, signature: graph.scripts[1].signature, reusable: false });
        expect(keys[3]).toEqual({ key: `3:${graph.scripts[3].signature}\n${keys[0]!.key}`, signature: `${graph.scripts[3].signature}\n${keys[0]!.key}`, reusable: false });
        // The results of a script on a connection that doesn't cache are not reused, nor are those of its consumers
        const uncached = await computeScriptResultKeys(graph, async (index, signature) => `${index}:${signature}`, index => index !== 0);
        expect(uncached[0]).toEqual({ ...keys[0], reusable: false });
        expect(uncached[2]).toEqual({ ...keys[2], reusable: false });
    });

    it('runs a script without references through a plan of its own and caches its result', async () => {
        const f = fixture([['foo.sql', 'select 1 as a;'], ['bar.sql', "select ':foo' as text;"]]);
        const graph = await f.planOf('bar.sql');
        const table = await f.run('bar.sql');
        expect(table?.numRows).toBe(1);
        // The key of a script without references is the key of its AST signature
        // The cache was read already, the executor writes the result of the key
        expect(f.calls).toEqual([{ connection: 'local', sql: "select ':foo' as text", cacheable: true, cacheSignature: graph.scripts[1].signature, refreshCache: true }]);
        expect(await computeScriptResultCacheKey(f.services, f.session(), f.script('bar.sql'))).toBe(`local:${graph.scripts[1].signature}`);
    });

    it('serves a cached result of a script without references without running its other statements', async () => {
        const f = fixture([['foo.sql', 'select 1 as a;\nselect 2 as b;']]);
        await f.run('foo.sql');
        expect(f.calls.map(call => call.sql)).toEqual(['select 1 as a', 'select 2 as b']);

        const graph = await f.planOf('foo.sql');
        f.cache.put(`local:${graph.scripts[0].signature}`);
        f.calls.length = 0;
        await f.run('foo.sql');
        // The executor serves the terminal query from the cache
        expect(f.calls).toEqual([expect.objectContaining({ sql: 'select 2 as b', cacheable: true, cacheSignature: graph.scripts[0].signature })]);
    });

    it('does not cache results of connections that do not cache them', async () => {
        const f = fixture([['foo.sql', 'select 1 as a;']], [], false);
        await f.run('foo.sql');
        expect(f.calls).toEqual([expect.objectContaining({ cacheable: false, cacheSignature: undefined })]);
        expect(await computeScriptResultCacheKey(f.services, f.session(), f.script('foo.sql'))).toBeNull();
    });

    it('returns the last output of a script whose output is not the last statement', async () => {
        const f = fixture([['foo.sql', 'select 1 as a;\ncreate table t (a int);']]);
        const table = await f.run('foo.sql');
        expect(f.calls.map(call => call.sql)).toEqual(['select 1 as a', 'create table t (a int)']);
        // The select is the result of the script
        expect(table?.getChild('a')?.get(0)).toBe(1);
        expect(f.modifySessionScripts).toHaveBeenCalledWith({ type: REGISTER_SCRIPT_RESULT, value: [f.script('foo.sql').scriptKey, 1] });
        expect(f.script('foo.sql').latestQueryId).toBe(1);
        expect(f.script('foo.sql').latestResultQueryId).toBe(1);
    });

    it('runs the SQL of a query with @vis tags as written', async () => {
        const f = fixture([['foo.sql', '/* @vis table */\nSELECT   1   AS a']]);
        await f.run('foo.sql');
        expect(f.calls.map(call => call.sql)).toEqual(['SELECT   1   AS a']);
        expect(f.modifySessionScripts).toHaveBeenCalledWith({
            type: SET_SCRIPT_EXECUTION_VISUALIZATION,
            value: [f.script('foo.sql').scriptKey, expect.objectContaining({ renderer: 'table', sql: 'SELECT   1   AS a' })],
        });
    });

    it('inlines the query of a referenced script without running the scripts that write its relations', async () => {
        const f = fixture([['setup.sql', 'create table t (a int);'], ['foo.sql', 'select a from t;'], ['bar.sql', 'select count(*) from :foo;']]);
        const table = await f.run('bar.sql');
        expect(table?.numRows).toBe(1);
        // bar reads t as the backend has it, setup is no part of the plan
        expect(f.calls.map(call => [call.connection, call.sql])).toEqual([
            ['local', 'with foo as (\nselect a from t\n)\nselect count(*) from foo'],
        ]);
        expect(f.calls[0].cacheable).toBe(true);
    });

    it('rejects a reference to a script that is no single query', async () => {
        const f = fixture([['foo.sql', 'create table t (a int);\nselect a from t;'], ['bar.sql', 'select count(*) from :foo;']]);
        await expect(f.run('bar.sql')).rejects.toThrow('bar.sql: foo.sql is no single SELECT that bar.sql could read');
        expect(f.executeQuery.mock.calls.map(([, args]) => args.failure?.message)).toEqual(['bar.sql: foo.sql is no single SELECT that bar.sql could read']);
    });

    it('materializes the result of a call that a script of the embedded database reads', async () => {
        const spec = `{ "format": 1, "namespace": "t", "functions": [{ "name": "list", "method": "GET", "columns": [{ "name": "id" }] }] }`;
        const f = fixture([['foo.sql', 'call t.list ();'], ['bar.sql', 'select count(*) from :foo;']], ['foo.sql'], true, spec);
        await f.run('bar.sql');
        const [[, call], [, scan]] = f.executeQuery.mock.calls;
        expect(f.calls.map(c => c.connection)).toEqual(['remote', 'local']);
        expect(call.clientFunctionCall).toMatchObject({ namespace: 't', function: 'list', effect: 'read' });
        // A call asks a service, its result is never a cached result, not even with caching connections
        expect(call.cacheable).toBe(false);
        const [path] = vi.mocked(f.mounts[0].writeTable).mock.calls[0];
        expect(path).toMatch(/^\/mnt\/external\/cache\/[0-9a-f-]{36}\.transient\.parquet$/);
        expect(scan.query).toContain(`external('${path}', format => 'parquet')`);
        expect(scan.cacheable).toBeFalsy();
    });

    it('sends a write in a run of an agent', async () => {
        const spec = JSON.stringify({ format: 1, namespace: 't', functions: [{ name: 'remove', method: 'DELETE', effect: 'write' }] });
        const f = fixture([['remove.sql', 'call t.remove ();']], ['remove.sql'], true, spec);
        await runSessionScriptForResult(() => f.session(), f.script('remove.sql').scriptKey, f.executeQuery, f.modifySessionScripts, logger);
        expect(f.executeQuery).toHaveBeenCalledTimes(1);
        expect(f.executeQuery.mock.calls[0][1].clientFunctionCall).toMatchObject({ function: 'remove', effect: 'write' });
    });

    it('reuses the cached result of a materialized script of another connection', async () => {
        const f = fixture([['foo.sql', 'select 1 as a;'], ['bar.sql', 'select count(*) from :foo;']], ['foo.sql']);
        const graph = await f.planOf('bar.sql');
        const fooKey = `remote:${graph.scripts[0].signature}`;
        // The first run executes foo remotely and writes its result as the cache entry of its key, bar scans it
        await f.run('bar.sql');
        expect(f.calls.map(call => call.connection)).toEqual(['remote', 'local']);
        const entry = await f.cache.lookup(fooKey);
        expect(entry).not.toBeNull();
        expect(f.mounts[0].writeTable).toHaveBeenCalledWith(`/mnt/external/cache/${entry!.name}`, expect.anything());
        expect(f.calls[1].sql).toContain(`external('/mnt/external/cache/${entry!.name}', format => 'parquet')`);
        expect(f.mounts[0].release).toHaveBeenCalledOnce();

        // Without a cached result of bar, the second run serves the cached result of foo and bar scans it
        f.calls.length = 0;
        // The executor caches the result of bar, the fake executor doesn't
        expect(await f.cache.has(`local:${graph.scripts[1].signature}\n${fooKey}`)).toBe(false);
        await f.run('bar.sql');
        expect(f.calls.map(call => [call.connection, call.sql])).toEqual([['remote', 'select 1 as a'], ['local', expect.stringContaining(entry!.name)]]);
        expect(f.mounts[1].use).toHaveBeenCalledWith(`/mnt/external/cache/${entry!.name}`);
        // The file is pinned from the lookup on
        expect(f.cache.retain).toHaveBeenCalledWith(fooKey);
        expect(f.mounts[1].writeTable).not.toHaveBeenCalled();
        expect(f.calls[1]).toMatchObject({ cacheable: true });
    });

    it('writes a materialized result that is not reused as a transient file and removes it once the run ended', async () => {
        const f = fixture([['foo.sql', 'select 1 as a;'], ['bar.sql', 'select count(*) from :foo;']], ['foo.sql'], false);
        await f.run('bar.sql');
        expect(f.calls.map(call => call.connection)).toEqual(['remote', 'local']);
        const [path] = vi.mocked(f.mounts[0].writeTable).mock.calls[0];
        const name = path.slice('/mnt/external/cache/'.length);
        expect(name).toMatch(/^[0-9a-f-]{36}\.transient\.parquet$/);
        expect(f.calls[1].sql).toContain(name);
        // The file is no cached result and goes once the run released it
        expect(f.cache.remove).toHaveBeenCalledWith(name);
        expect([...f.cache.files.keys()]).toEqual([]);
        // The next run runs foo again
        f.calls.length = 0;
        await f.run('bar.sql');
        expect(f.calls.map(call => call.connection)).toEqual(['remote', 'local']);
        expect(f.mounts[1].use).not.toHaveBeenCalled();
    });

    it('refreshes a script and the cached results of the scripts it references', async () => {
        const f = fixture([['foo.sql', 'select 1 as a;'], ['bar.sql', 'select count(*) from :foo;']], ['foo.sql']);
        const graph = await f.planOf('bar.sql');
        const fooKey = `remote:${graph.scripts[0].signature}`;
        const barKey = `local:${graph.scripts[1].signature}\n${fooKey}`;
        const fooFile = f.cache.put(fooKey);
        f.cache.put(barKey);
        await f.run('bar.sql', { refresh: true });
        // Neither the result of bar nor the one of foo is read from the cache, foo runs and replaces its file
        expect(f.cache.has).not.toHaveBeenCalled();
        expect(f.mounts[0].use).not.toHaveBeenCalled();
        expect(f.calls.map(call => call.connection)).toEqual(['remote', 'local']);
        const fresh = (await f.cache.lookup(fooKey))!.name;
        expect(fresh).not.toBe(fooFile);
        expect(f.calls[1].sql).toContain(fresh);
        // The executor writes the result of bar as the newest file of its key without reading the older one
        expect(f.calls[1]).toMatchObject({ cacheable: true, refreshCache: true, cacheSignature: `${graph.scripts[1].signature}\n${fooKey}` });
    });

    it('serves the cached results of the script and of the scripts it references', async () => {
        const f = fixture([['foo.sql', 'select 1 as a;'], ['bar.sql', 'select count(*) from :foo;']], ['foo.sql']);
        const graph = await f.planOf('bar.sql');
        // The key of bar covers the remote key of foo
        const fooKey = `remote:${graph.scripts[0].signature}`;
        const key = `local:${graph.scripts[1].signature}\n${fooKey}`;
        expect(await computeScriptResultCacheKey(f.services, f.session(), f.script('bar.sql'))).toBe(key);
        f.cache.put(fooKey);
        f.cache.put(key);
        const table = await f.run('bar.sql');
        expect(table?.numRows).toBe(1);
        // Nothing runs, both results are read from the cache
        expect(f.calls).toEqual([expect.objectContaining({ connection: 'remote', cacheable: true }), expect.objectContaining({ connection: 'local', cacheable: true })]);
        expect(f.executeQuery.mock.calls.every(([, args]) => args.cacheOnly)).toBe(true);
        expect(f.cache.writeTable).not.toHaveBeenCalled();
    });

    it('runs the script if a script it references runs', async () => {
        const f = fixture([['foo.sql', 'select 1 as a;'], ['bar.sql', 'select count(*) from :foo;']], ['foo.sql']);
        const graph = await f.planOf('bar.sql');
        // Only the result of bar is cached, foo runs and so does bar
        f.cache.put(`local:${graph.scripts[1].signature}\nremote:${graph.scripts[0].signature}`);
        await f.run('bar.sql');
        expect(f.calls.map(call => call.connection)).toEqual(['remote', 'local']);
        expect(f.executeQuery.mock.calls.some(([, args]) => args.cacheOnly)).toBe(false);
    });

    it('runs the plan if the cached result of the script is gone', async () => {
        const f = fixture([['foo.sql', 'select 1 as a;'], ['bar.sql', 'select count(*) from :foo;']], ['foo.sql']);
        const graph = await f.planOf('bar.sql');
        const fooKey = `remote:${graph.scripts[0].signature}`;
        const fooFile = f.cache.put(fooKey);
        f.cache.put(`local:${graph.scripts[1].signature}\n${fooKey}`);
        // The file of bar is evicted before the executor reads it, the query of bar runs and scans the file of foo
        const fallback = f.executeQuery.getMockImplementation()!;
        f.executeQuery.mockImplementation((connectionId, args) => {
            if (args.cacheOnly && connectionId === f.script('bar.sql').connection.connectionId) return [99, Promise.reject(new QueryCacheMissError())];
            return fallback(connectionId, args);
        });
        const table = await f.run('bar.sql');
        expect(table?.numRows).toBe(1);
        expect(f.calls.map(call => call.connection)).toEqual(['remote', 'local']);
        expect(f.calls[1].sql).toContain(`external('/mnt/external/cache/${fooFile}', format => 'parquet')`);
        // The script shows the result of the plan, not the miss
        expect(f.modifySessionScripts).not.toHaveBeenCalledWith({ type: REGISTER_QUERY, value: [f.script('bar.sql').scriptKey, 99] });
        expect(f.script('bar.sql').latestResultQueryId).toBe(2);
    });

    it('cancels the other statements once a statement failed and releases the files after they are done', async () => {
        const f = fixture([['a.sql', 'select 1 as a;'], ['b.sql', 'select 2 as b;'], ['c.sql', 'select * from :a, :b;']], ['a.sql', 'b.sql']);
        f.services.maxConcurrentQueries = () => 2;
        let aSettled = false;
        let aSignal: AbortSignal | undefined;
        f.executeQuery.mockImplementation((_connectionId, args) => {
            if (args.query === 'select 1 as a') {
                aSignal = args.abortSignal;
                // A late result after the cancellation, the run must not write it
                return [1, new Promise(resolve => args.abortSignal!.addEventListener('abort', () => setTimeout(() => {
                    aSettled = true;
                    resolve(tableFromArrays({ a: [1] }));
                }, 0)))];
            }
            return [2, Promise.reject(new Error('b failed'))];
        });
        await expect(f.run('c.sql')).rejects.toThrow('b failed');
        expect(aSignal?.aborted).toBe(true);
        expect(aSettled).toBe(true);
        expect(f.mounts[0].writeTable).not.toHaveBeenCalled();
        expect(f.mounts[0].release).toHaveBeenCalledOnce();
        expect([...f.cache.files.keys()]).toEqual([]);
    });

    it('refuses a run while another run holds the session', async () => {
        const f = fixture([['foo.sql', 'select 1 as a;'], ['bar.sql', 'select 2 as b;']]);
        let finish: () => void = () => {};
        f.executeQuery.mockImplementation((_connectionId, args) => {
            f.calls.push({ connection: 'local', sql: args.query });
            return [f.calls.length, new Promise(resolve => { finish = () => resolve(tableFromArrays({ a: [1] })); })];
        });
        const listener = vi.fn();
        const unsubscribe = subscribeSessionExecutions(listener);
        const foo = f.run('foo.sql');
        expect(isSessionExecutionRunning(f.session())).toBe(true);
        expect(listener).toHaveBeenCalledOnce();
        await expect(f.run('bar.sql')).rejects.toThrow('Another script of the session is running');
        await vi.waitFor(() => expect(f.calls.map(call => call.sql)).toEqual(['select 1 as a']));
        finish();
        expect((await foo)?.numRows).toBe(1);
        expect(isSessionExecutionRunning(f.session())).toBe(false);
        expect(listener).toHaveBeenCalledTimes(2);
        unsubscribe();
    });

    it('refuses to write or read the files of a run after its release', async () => {
        const cache = memoryQueryResultCache();
        const mounts = createExecutionMounts(cache, {} as ParquetDatabase);
        const name = mounts.fileName(null);
        await mounts.release();
        await expect(mounts.use(`${mounts.prefix}/${name}`)).rejects.toThrow('The run ended');
        await expect(mounts.writeTable(`${mounts.prefix}/${name}`, tableFromArrays({ a: [1] }))).rejects.toThrow('The run ended');
        expect(cache.mount).not.toHaveBeenCalled();
        expect(cache.pin).not.toHaveBeenCalled();
    });

    it('describes where the statements of a plan come from in the query metadata and the logs', async () => {
        const f = fixture([['base.sql', 'select 1 as a;'], ['foo.sql', 'select * from :base;'], ['bar.sql', 'select count(*) from :foo;']], ['base.sql']);
        const logger = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() };
        await f.run('bar.sql', { logger });
        const metadata = f.executeQuery.mock.calls.map(([, args]) => args.metadata);
        // base runs remotely and is materialized, bar inlines the query of foo, which scans the result of base
        expect(metadata[0]).toMatchObject({
            title: 'base.sql 1/1 · materialized', issuer: 'Run of bar.sql',
            planned: { run: 'script', target: 'bar.sql', node: 0, script: 'base.sql', result: true, inlined: [], materializes: expect.stringMatching(/^\/mnt\/external\/cache\//) },
        });
        expect(metadata[1]).toMatchObject({
            title: 'bar.sql 1/1 · inlines foo.sql · scans base.sql', issuer: 'Run of bar.sql',
            planned: {
                node: 1, script: 'bar.sql', statementType: 'SELECT', result: true, inlined: ['foo.sql'],
                scans: [{ script: 'base.sql', path: metadata[0].planned!.materializes, cached: false }],
                after: [{ node: 0, reason: 'MATERIALIZATION' }], materializes: null,
            },
            resultOwner: scriptResultOwner(f.session().sessionId, f.script('bar.sql').scriptKey),
        });
        expect(metadata[1].description).toContain('inlines the queries of foo.sql');
        const statements = logger.info.mock.calls.filter(([message]) => message === 'Running a planned statement').map(([, fields]) => fields);
        expect(statements).toEqual([
            expect.objectContaining({ query: '1', script: 'base.sql', statement: '1/1', inlined: '', materializes: metadata[0].planned!.materializes }),
            expect.objectContaining({ query: '2', script: 'bar.sql', inlined: 'foo.sql', after: '0 MATERIALIZATION', cacheable: 'true' }),
        ]);
        expect(logger.info).toHaveBeenCalledWith('Running a plan of session scripts', expect.objectContaining({ run: 'script bar.sql', nodes: '2', inlined: '1 bar.sql inlines foo.sql' }), 'session_execution');
        expect(logger.info).toHaveBeenCalledWith('Wrote a materialized script result', expect.objectContaining({ script: 'base.sql', rows: '1' }), 'session_execution');
    });

    it('fails a run when the scripts of the session change meanwhile', async () => {
        const f = fixture([['foo.sql', 'select 1 as a;\nselect 2 as b;']]);
        let changed = false;
        // The script is removed from the session while its first statement runs
        f.services.liveSession = () => changed ? { ...f.session(), scriptOrder: [] } : f.session();
        f.executeQuery.mockImplementation(() => {
            changed = true;
            return [1, Promise.resolve(tableFromArrays({ a: [1] }))];
        });
        await expect(f.run('foo.sql')).rejects.toThrow('Session changed during execution');
        expect(f.executeQuery).toHaveBeenCalledOnce();
    });

    it('shows an error that stops a run before its statements on the script', async () => {
        const f = fixture([['foo.sql', 'select 1 as a;'], ['bar.sql', 'select count(*) from :foo;']], ['foo.sql']);
        // Without the compute database, nothing scans the result of foo
        f.services.createMounts = () => null;
        await expect(f.run('bar.sql')).rejects.toThrow('Scripts of other connections need the compute database');
        expect(f.executeQuery.mock.calls.map(([, args]) => [args.metadata.resultOwner, args.failure?.message])).toEqual([
            [scriptResultOwner(f.session().sessionId, f.script('bar.sql').scriptKey), expect.stringContaining('need the compute database')],
        ]);
        expect(f.modifySessionScripts).toHaveBeenCalledWith({ type: REGISTER_QUERY, value: [f.script('bar.sql').scriptKey, 1] });
    });

    it('reports the errors of the plan of a script', async () => {
        const f = fixture([['bar.sql', 'select * from :missing;'], ['empty.sql', '-- nothing']]);
        await expect(f.run('bar.sql')).rejects.toThrow('bar.sql: unknown script or attachment :missing');
        await expect(f.run('empty.sql')).rejects.toThrow('empty.sql holds no statement');
        // Nothing runs, the scripts record the errors as failed queries that show where their results would be
        expect(f.executeQuery.mock.calls.map(([, args]) => [args.metadata.resultOwner, args.failure?.message])).toEqual([
            [scriptResultOwner(f.session().sessionId, f.script('bar.sql').scriptKey), 'bar.sql: unknown script or attachment :missing'],
            [scriptResultOwner(f.session().sessionId, f.script('empty.sql').scriptKey), 'empty.sql holds no statement'],
        ]);
        expect(f.modifySessionScripts).toHaveBeenCalledWith({ type: REGISTER_QUERY, value: [f.script('bar.sql').scriptKey, 1] });
        expect(f.modifySessionScripts).toHaveBeenCalledWith({ type: REGISTER_QUERY, value: [f.script('empty.sql').scriptKey, 2] });
    });

    it.each([true, false])('runs an outdated script after analyzing it with the registered services (caching %s)', async caching => {
        const f = fixture([['foo.sql', 'select 1 as a']], [], caching);
        registerScriptRunServices(dql, f.services);
        expect(f.script('foo.sql').analysisOutdated).toBe(true);
        await runSessionScript(f.session(), f.script('foo.sql'), f.executeQuery, f.modifySessionScripts, logger);
        expect(f.modifySessionScripts).toHaveBeenNthCalledWith(1, { type: ANALYZE_OUTDATED_SCRIPT, value: f.script('foo.sql').scriptKey });
        expect(f.calls).toEqual([expect.objectContaining({ sql: 'select 1 as a', cacheable: caching })]);
        expect(f.script('foo.sql').latestResultQueryId).toBe(1);
    });

    it('runs scripts without cache and mounts without a session execution provider', async () => {
        const f = fixture([['foo.sql', 'select 1 as a']]);
        await runSessionScript(f.session(), f.script('foo.sql'), f.executeQuery, f.modifySessionScripts, logger);
        expect(f.calls).toEqual([expect.objectContaining({ sql: 'select 1 as a', cacheable: false })]);
    });
});
