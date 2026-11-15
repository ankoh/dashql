import * as core from '@ankoh/dashql-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { CancelQuery, QueryExecutor } from '../../connections/query_execution_args.js';
import { ConnectorType } from '../../connections/connector_info.js';
import type { CoreRuntime } from '../../core_runtime.js';
import { testStorageRuntime } from '../../testing/test_runtime.js';
import { runWorkbookExecution, type ScriptRunEvent, type WorkbookExecutionState } from './workbook_execution.js';
import type { ModifyWorkbookScripts, WorkbookAction, WorkbookScripts } from './workbook_scripts.js';
import { tableFromArrays } from '../../testing/arrow_fixtures.js';

// The adapter of the runs of the Rust runtime: the statements reach the query executor of the host, the states and
// the events of the scripts reach the host. The scheduling itself is tested in Rust
// (packages/dashql-core-runtime/tests/workbook_run_test.rs).

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL;
/// The runtimes of the fixtures of a test
const runtimes: CoreRuntime[] = [];

beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });
afterEach(() => {
    vi.restoreAllMocks();
    for (const runtime of runtimes.splice(0)) runtime.destroy();
    dql.resetUnsafe();
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

/// A workbook of a runtime with scripts on connections (`connection` by default), in feed order
function fixture(entries: Array<[string, string, string?]> = [
    ['1_empty.sql', ''],
    ['2_commands.sql', 'create table t (x int);\nselect x from t;\ninsert into t values (1);'],
    ['10_last.sql', 'select x from t;'],
]) {
    const runtime = testStorageRuntime(dql);
    runtimes.push(runtime);
    const connectionOf = (id = 'connection') => {
        if (runtime.connection(id) == null) {
            runtime.createConnection({ connectorType: ConnectorType.HYPER, setupParams: { protocol: 'V3_GRPC', endpoint: `http://${id}` } }, id);
        }
        return id;
    };
    const created = runtime.createWorkbook(connectionOf(entries[0]?.[2]), 'Execution', false);
    const workbookId = created.workbookId;
    for (const [name, sql, connection] of entries) {
        const outcome = runtime.dispatchWorkbook(workbookId, { kind: 'createScript', value: { text: sql, base: name.replace(/\.sql$/, ''), connectionId: connectionOf(connection) } });
        if (!outcome.ok) throw new Error(outcome.error ?? `the script ${name} was not created`);
    }
    runtime.flush();
    /// The workbook as the runtime holds it now
    const workbook = (): WorkbookScripts => {
        runtime.flush();
        return runtime.workbook(workbookId)!;
    };
    const apply = (action: WorkbookAction) => runtime.dispatchWorkbook(workbookId, action);
    const modifyWorkbookScripts = vi.fn<ModifyWorkbookScripts>(action => apply(action));
    let nextQueryId = 0;
    const executeQuery = vi.fn<QueryExecutor>((_connectionId, args) => [++nextQueryId, Promise.resolve(args.analyzeResults ? tableFromArrays({ value: [1] }) : null)]);
    const cancelQuery = vi.fn<CancelQuery>(async () => {});
    const controller = new AbortController();
    const states: WorkbookExecutionState[] = [];
    const onState = vi.fn((state: WorkbookExecutionState) => { states.push(state); });
    const yieldToBrowser = vi.fn(async () => {});
    const args = (): Parameters<typeof runWorkbookExecution>[0] => ({
        workbook: workbook(), runs: runtime, executeQuery, cancelQuery, signal: controller.signal, onState, yieldToBrowser,
    });
    const script = (fileName: string) => runtime.store.get('script', workbook().scriptRefs[fileName].scriptId)!;
    const scripts = () => {
        runtime.flush();
        return runtime.workbookScripts(workbookId);
    };
    const lastState = () => states[states.length - 1];
    const queries = () => executeQuery.mock.calls.map(([connectionId, args]) => [connectionId, args.query]);
    return { runtime, workbookId, args, apply, workbook, script, scripts, executeQuery, cancelQuery, modifyWorkbookScripts, controller, states, onState, yieldToBrowser, lastState, queries };
}

describe('runWorkbookExecution', () => {
    it('analyzes, plans and runs the scripts in the order of the plan, including empty scripts', async () => {
        const f = fixture();
        await runWorkbookExecution(f.args());
        expect(f.queries()).toEqual([
            ['connection', 'create table t (x int)'], ['connection', 'select x from t'],
            ['connection', 'insert into t values (1)'], ['connection', 'select x from t'],
        ]);
        expect(f.lastState()).toEqual({
            phase: 'succeeded', totalScripts: 3, completedScripts: 3,
            totalStatements: 4, completedStatements: 4,
            activeFileName: null,
            activeStatementIndex: null, activeStatementCount: null, error: null, skippedScripts: 0, skippedFiles: [],
        });
        expect(f.states.some(state => state.completedScripts === 1 && state.completedStatements === 0)).toBe(true);
        expect(f.states.filter(state => state.activeFileName === '2_commands.sql').map(state => state.activeStatementIndex))
            .toEqual(expect.arrayContaining([1, 2, 3]));
        // The analyses of the run are the analyses of the scripts
        for (const script of Object.values(f.scripts())) {
            expect(script.analysisOutdated).toBe(false);
            expect(script.editorUpdate?.analysisAvailable).toBe(true);
        }
        // The statements say where they come from
        const [, args] = f.executeQuery.mock.calls[3];
        expect(args).toMatchObject({ cacheable: false, throwOnError: true, analyzeResults: true, publishResults: true });
        expect(args.metadata).toMatchObject({ title: '10_last.sql 1/1', issuer: 'Workbook run', workbookId: f.workbookId });
        expect(args.metadata.planned).toMatchObject({ run: 'workbook', script: '10_last.sql', statement: 1, statements: 1, statementType: 'SELECT', result: true });
    });

    it('runs the scripts that a change of inputs affects', async () => {
        const f = fixture([['1_min.sql', '/* @param :min = 3 */\nselect 1 where 2 > :min;'], ['2_other.sql', 'select 2;']]);
        await runWorkbookExecution({ ...f.args(), inputs: ['min'] });
        expect(f.queries()).toEqual([['connection', 'select 1 where 2 > 3']]);
        expect(f.lastState()).toMatchObject({ phase: 'succeeded', totalScripts: 1 });

        // A change that no script reads runs nothing
        const g = fixture([['1_min.sql', '/* @param :min = 3 */\nselect 1 where 2 > :min;']]);
        await runWorkbookExecution({ ...g.args(), inputs: ['nope'] });
        expect(g.executeQuery).not.toHaveBeenCalled();
        expect(g.lastState()).toEqual(expect.objectContaining({ phase: 'succeeded', totalScripts: 0 }));
    });

    it('yields before planning so the execution status can paint', async () => {
        const f = fixture();
        const firstYield = deferred<void>();
        f.yieldToBrowser.mockImplementationOnce(() => firstYield.promise);
        const run = runWorkbookExecution(f.args());
        await vi.waitFor(() => expect(f.yieldToBrowser).toHaveBeenCalledOnce());
        expect(f.lastState()).toMatchObject({ phase: 'planning', totalScripts: 3 });
        expect(f.executeQuery).not.toHaveBeenCalled();
        firstYield.resolve();
        await run;
        expect(f.lastState().phase).toBe('succeeded');
    });

    it('starts an eligible statement once the result of its predecessor is ready', async () => {
        const f = fixture([['1.sql', 'create table t (x int);\ninsert into t values (1);']]);
        const first = deferred<null>();
        const started = deferred<void>();
        f.executeQuery.mockImplementationOnce((_connection, args) => {
            args.onResultsReady?.();
            started.resolve();
            return [1, first.promise];
        });
        const run = runWorkbookExecution(f.args());
        await started.promise;
        await vi.waitFor(() => expect(f.executeQuery).toHaveBeenCalledTimes(2));
        // The second statement ran before the first one settled
        expect(f.lastState()?.completedStatements).toBeLessThan(2);
        first.resolve(null);
        await run;
        expect(f.lastState()).toMatchObject({ phase: 'succeeded', completedStatements: 2 });
    });

    it('fails a run whose plan is invalid before any statement', async () => {
        const f = fixture([['1_bar.sql', 'select * from :unknown;']]);
        await runWorkbookExecution(f.args());
        expect(f.executeQuery).not.toHaveBeenCalled();
        expect(f.lastState()).toMatchObject({ phase: 'failed' });
        expect(f.lastState().error).toContain('1_bar.sql');
    });

    it('fails a run when the workbook is gone before its statements', async () => {
        const f = fixture();
        f.onState.mockImplementation(state => {
            f.states.push(state);
            if (state.phase === 'running') f.runtime.dispatch('app', { kind: 'deleteWorkbook', value: { workbookId: f.workbookId } });
        });
        await runWorkbookExecution(f.args());
        expect(f.executeQuery).not.toHaveBeenCalled();
        expect(f.lastState()).toMatchObject({ phase: 'failed', error: 'Workbook changed during execution' });
    });

    it('fails fast while retaining the failing query and earlier successful work', async () => {
        const f = fixture();
        f.executeQuery.mockImplementationOnce(() => [1, Promise.resolve(null)])
            .mockImplementationOnce(() => [2, Promise.reject(new Error('Backend failure'))]);
        await expect(runWorkbookExecution(f.args())).resolves.toBeUndefined();
        expect(f.executeQuery).toHaveBeenCalledTimes(2);
        expect(f.script('2_commands.sql').latestQueryId).toBe(2);
        expect(f.lastState()).toMatchObject({ phase: 'failed', error: 'Backend failure', completedStatements: 1, activeStatementIndex: 2 });
    });

    it('analyzes only the last output and restores it after successful trailing commands', async () => {
        const f = fixture([['1_output.sql', 'create table t (x int);\nselect 1;\nselect 2;\ninsert into t values (3);']]);
        f.executeQuery.mockImplementation(() => [f.executeQuery.mock.calls.length, Promise.resolve(tableFromArrays({ value: [1] }))]);
        await runWorkbookExecution(f.args());
        expect(f.executeQuery.mock.calls.map(([, args]) => args.analyzeResults)).toEqual([false, false, true, false]);
        expect(f.script('1_output.sql').latestQueryId).toBe(3);
        expect(f.script('1_output.sql').latestResultQueryId).toBe(3);
    });

    it('keeps the output result after a trailing command fails', async () => {
        const f = fixture([['1_output.sql', 'create table t (x int);\nselect 1;\ninsert into t values (3);']]);
        f.executeQuery.mockImplementationOnce(() => [1, Promise.resolve(null)])
            .mockImplementationOnce(() => [2, Promise.resolve(tableFromArrays({ value: [1] }))])
            .mockImplementationOnce(() => [3, Promise.reject(new Error('Command failed'))]);
        await runWorkbookExecution(f.args());
        expect(f.lastState()?.phase).toBe('failed');
        expect(f.script('1_output.sql').latestQueryId).toBe(3);
        expect(f.script('1_output.sql').latestResultQueryId).toBe(2);
    });

    it('stops queued statements when a workbook script is removed during the run', async () => {
        const f = fixture();
        f.executeQuery.mockImplementationOnce(() => {
            f.apply({ kind: 'deleteScript', value: { fileName: '10_last.sql' } });
            return [1, Promise.resolve(null)];
        });
        await runWorkbookExecution(f.args());
        expect(f.executeQuery).toHaveBeenCalledTimes(1);
        expect(f.lastState()).toMatchObject({ phase: 'failed' });
        expect(f.lastState()?.error).toContain('Workbook changed');
    });

    it('stops a run on abort: cancels the running query on its connection and settles once it is done', async () => {
        const f = fixture([['1_b.sql', 'select 1;', 'b'], ['2_b.sql', 'select 2;', 'b']]);
        const execution = deferred<null>();
        const started = deferred<void>();
        f.executeQuery.mockImplementationOnce((_connection, args) => {
            started.resolve();
            args.abortSignal?.addEventListener('abort', () => execution.reject(new DOMException('Aborted', 'AbortError')));
            return [42, execution.promise];
        });
        const run = runWorkbookExecution(f.args());
        await started.promise;
        f.controller.abort();
        expect(f.lastState()?.phase).toBe('stopping');
        await run;
        expect(f.cancelQuery).toHaveBeenCalledExactlyOnceWith('b', 42);
        expect(f.executeQuery).toHaveBeenCalledTimes(1);
        expect(f.lastState()).toMatchObject({ phase: 'cancelled', error: null, completedStatements: 0 });
    });

    it('fails a run whose executor throws, and launches nothing when it was aborted already', async () => {
        const failed = fixture();
        failed.executeQuery.mockImplementation(() => { throw new Error('Cannot launch'); });
        await expect(runWorkbookExecution(failed.args())).resolves.toBeUndefined();
        expect(failed.lastState()).toMatchObject({ phase: 'failed', error: 'Cannot launch' });
        expect(failed.executeQuery).toHaveBeenCalledTimes(1);

        const aborted = fixture();
        aborted.controller.abort();
        await runWorkbookExecution(aborted.args());
        expect(aborted.executeQuery).not.toHaveBeenCalled();
        expect(aborted.lastState()?.phase).toBe('cancelled');

        // A run that ended ignores a later abort
        const completed = fixture();
        await runWorkbookExecution(completed.args());
        const count = completed.states.length;
        completed.controller.abort();
        expect(completed.states).toHaveLength(count);
        expect(completed.cancelQuery).not.toHaveBeenCalled();
    });

    it('runs the scripts of every connection in one plan, one statement of a connection at a time', async () => {
        const f = fixture([
            ['1_a.sql', 'select 1;', 'a'],
            ['2_a.sql', 'select 2;', 'a'],
            ['3_b.sql', 'select 3;\nselect 4;', 'b'],
            ['4_a.sql', 'select 5;', 'a'],
        ]);
        const running = new Map<string, number>();
        let overlap = false;
        let both = false;
        f.executeQuery.mockImplementation((connection: string) => {
            running.set(connection, (running.get(connection) ?? 0) + 1);
            if (running.get(connection)! > 1) overlap = true;
            if ([...running.values()].filter(count => count > 0).length > 1) both = true;
            const done = new Promise<null>(resolve => setTimeout(() => resolve(null))).then(result => {
                running.set(connection, running.get(connection)! - 1);
                return result;
            });
            return [f.executeQuery.mock.calls.length, done];
        });
        await runWorkbookExecution(f.args());
        const calls = f.queries();
        expect(calls.filter(([connection]) => connection === 'a')).toEqual([['a', 'select 1'], ['a', 'select 2'], ['a', 'select 5']]);
        expect(calls.filter(([connection]) => connection === 'b')).toEqual([['b', 'select 3'], ['b', 'select 4']]);
        expect(overlap).toBe(false);
        expect(both).toBe(true);
        expect(f.lastState()).toMatchObject({ phase: 'succeeded', totalStatements: 5, completedStatements: 5, completedScripts: 4 });
    });

    it('reports what happens to every script', async () => {
        const f = fixture();
        const events: Array<[string, ScriptRunEvent]> = [];
        await runWorkbookExecution({ ...f.args(), onScript: (file, event) => events.push([file, event]) });
        expect(events.slice(0, 3)).toEqual([
            ['1_empty.sql', { type: 'done', key: null, queryId: null }],
            ['2_commands.sql', { type: 'planned', follows: [] }],
            ['10_last.sql', { type: 'planned', follows: ['2_commands.sql'] }],
        ]);
        // A statement releases the statements after it once its result is ready, before it settles
        const of = (file: string) => events.filter(([f]) => f === file).map(([, event]) => event);
        expect(of('2_commands.sql')).toEqual([{ type: 'planned', follows: [] }, { type: 'started' }, { type: 'done', key: null, queryId: 2 }]);
        expect(of('10_last.sql')).toEqual([{ type: 'planned', follows: ['2_commands.sql'] }, { type: 'started' }, { type: 'done', key: null, queryId: 4 }]);
    });

    it('reports the failed script and cancels the scripts that run beside it', async () => {
        const f = fixture([['1_a.sql', 'select 1;', 'a'], ['2_b.sql', 'select 2;', 'b'], ['3_a.sql', 'select 3;', 'a']]);
        const slow = deferred<null>();
        f.executeQuery.mockImplementation((connection: string) => connection === 'a'
            ? [1, slow.promise]
            : [2, Promise.reject(new Error('Backend failure'))]);
        f.cancelQuery.mockImplementation(async () => { slow.reject(new Error('Cancelled')); });
        const events: Array<[string, string]> = [];
        await runWorkbookExecution({ ...f.args(), onScript: (file, event) => events.push([file, event.type]) });
        expect(events).toEqual([
            ['1_a.sql', 'planned'], ['2_b.sql', 'planned'], ['3_a.sql', 'planned'],
            ['1_a.sql', 'started'], ['2_b.sql', 'started'],
            ['2_b.sql', 'failed'], ['1_a.sql', 'cancelled'],
        ]);
        expect(f.lastState()).toMatchObject({ phase: 'failed', error: 'Backend failure' });
    });

    it('sets up the connections at once and skips the scripts of one that fails', async () => {
        const f = fixture([['1_a.sql', 'select 1;', 'a'], ['2_b.sql', 'select 2;', 'b']]);
        const setups: string[] = [];
        const setupB = deferred<void>();
        const prepareConnection = vi.fn(async (connectionId: string) => {
            setups.push(connectionId);
            if (connectionId === 'b') {
                await setupB.promise;
                throw new Error('Unauthorized');
            }
        });
        const events: Array<[string, ScriptRunEvent]> = [];
        const run = runWorkbookExecution({ ...f.args(), prepareConnection, onScript: (file, event) => events.push([file, event]) });
        await vi.waitFor(() => expect(setups).toEqual(['a', 'b']));
        setupB.resolve();
        await run;
        expect(f.executeQuery.mock.calls.map(([connection]) => connection)).toEqual(['a']);
        expect(events).toContainEqual(['2_b.sql', { type: 'skipped', reason: 'its connection could not be set up' }]);
        expect(events).toContainEqual(['1_a.sql', { type: 'done', key: null, queryId: 1 }]);
        expect(f.lastState()).toMatchObject({ phase: 'succeeded', skippedFiles: ['2_b.sql'] });
    });

    it('runs the targets with what they need', async () => {
        const f = fixture([['1_a.sql', 'select 1;'], ['2_b.sql', 'select 2;']]);
        await runWorkbookExecution({ ...f.args(), targets: [1] });
        expect(f.queries()).toEqual([['connection', 'select 2']]);
    });

    it('succeeds on an empty workbook', async () => {
        const f = fixture([]);
        await runWorkbookExecution(f.args());
        expect(f.lastState()).toMatchObject({ phase: 'succeeded', totalScripts: 0, totalStatements: 0 });
        expect(f.executeQuery).not.toHaveBeenCalled();
    });
});
