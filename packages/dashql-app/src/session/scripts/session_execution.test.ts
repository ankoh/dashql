import * as core from '@ankoh/dashql-core';
import { describe, expect, it, vi } from 'vitest';

import type { CancelQuery, QueryExecutor } from '../../connections/query_executor.js';
import { runSessionExecution, type SessionExecutionState } from './session_execution.js';
import { REGISTER_QUERY, REGISTER_SCRIPT_RESULT, type SessionScripts } from './session_scripts.js';
import type { ModifySessionScripts } from './session_scripts_registry.js';
import { tableFromArrays } from '../../tests/arrow_fixtures.js';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function fixture(entries: Array<{ file: string; outputs: boolean[]; connection?: string }> = [
    { file: '10_last.sql', outputs: [true] },
    { file: '2_commands.sql', outputs: [false, true, false] },
    { file: '1_empty.sql', outputs: [] as boolean[] },
]) {
    const preparation: string[] = [];
    let catalogRevision = 0n;
    const scriptSessions = entries.map((entry, index) => ({
        version: 1n,
        getCatalogEntryId: () => index + 100,
        getTextVersion() { return this.version; },
        getCatalogRevision: () => catalogRevision,
        analyze: vi.fn(() => {
            preparation.push(`analyze:${entry.file}`);
            return { status: core.buffers.editor.EditorUpdateStatus.OK, analysisAvailable: true, statusMessage: null };
        }),
        loadIntoCatalog: vi.fn(() => {
            preparation.push(`load:${entry.file}`);
            catalogRevision++;
        }),
    }));
    const ordered = entries.map((entry, index) => ({ ...entry, index }))
        .sort((a, b) => a.file.localeCompare(b.file, undefined, { numeric: true }));
    const graph = {
        valid: true,
        scripts: [] as Array<{ scriptId: number; textVersion: bigint; analyzedTextVersion: bigint; analyzedCatalogRevision: bigint; planned: boolean }>,
        nodes: ordered.flatMap((entry, script) => entry.outputs.map((producesOutput, statementId) => ({
            script, statementId, producesOutput, sql: `${entry.file}:${statementId + 1}`, connection: 0, materialization: 0xffffffff,
        }))),
        edges: [] as Array<{ from: number; to: number }>,
        diagnostics: [] as Array<{ message: string }>,
        materializations: [],
    };
    // Most lifecycle tests model a sequential script. Parallel-scheduler tests replace these
    // explicit planner dependencies with the graph shape they need to exercise.
    graph.edges.push(...graph.nodes.slice(1).map((_node, index) => ({ from: index, to: index + 1 })));
    const unpack = vi.fn(() => graph as unknown as core.buffers.execution.ExecutionGraphT);
    // The plan of the session covers the scripts of every connection
    const plan = vi.fn((request: core.SessionPlanRequest) => {
        graph.scripts = request.scripts.map(({ session: scriptSession }) => ({
            scriptId: scriptSession.getCatalogEntryId(), textVersion: scriptSession.getTextVersion(),
            analyzedTextVersion: scriptSession.getTextVersion(), analyzedCatalogRevision: scriptSession.getCatalogRevision(), planned: true,
        }));
        for (const node of graph.nodes) node.connection = request.scripts[node.script].connection;
        return { unpack };
    });
    const session = {
        sessionId: 'session', connectionId: 'connection', instance: { planSession: plan }, connectionCatalog: {},
        scriptRefs: Object.fromEntries(entries.map((entry, index) => [entry.file, { scriptId: index + 100 }])),
        scriptOrder: ordered.map(entry => entry.file),
        scripts: Object.fromEntries(entries.map((entry, index) => [index + 100, {
            scriptKey: index + 100, fileName: entry.file, scriptSession: scriptSessions[index], latestQueryId: 50 + index,
            latestResultQueryId: 50 + index, connection: { connectionId: entry.connection ?? 'connection' },
        }])),
    } as unknown as SessionScripts;
    let nextQueryId = 0;
    const executeQuery = vi.fn<QueryExecutor>(() => [++nextQueryId, Promise.resolve(null)]);
    const cancelQuery = vi.fn<CancelQuery>(async () => {});
    const modifySessionScripts = vi.fn<ModifySessionScripts>(action => {
        if (action.type === REGISTER_QUERY) session.scripts[action.value[0]].latestQueryId = action.value[1];
        if (action.type === REGISTER_SCRIPT_RESULT) session.scripts[action.value[0]].latestResultQueryId = action.value[1];
    });
    const getSession = vi.fn((): SessionScripts | null => session);
    const controller = new AbortController();
    const states: SessionExecutionState[] = [];
    const onState = vi.fn((state: SessionExecutionState) => { states.push(state); });
    const yieldToBrowser = vi.fn(async () => {});
    const args: Parameters<typeof runSessionExecution>[0] = { session, getSession, executeQuery, cancelQuery, modifySessionScripts,
        signal: controller.signal, onState, yieldToBrowser };
    const lastState = () => states[states.length - 1];
    return { args, session, scriptSessions, graph, plan, unpack, preparation,
        executeQuery, cancelQuery, modifySessionScripts, getSession, controller, states, onState, yieldToBrowser, lastState };
}

describe('runSessionExecution', () => {
    it('prepares and executes natural committed order, including empty scripts', async () => {
        const f = fixture();
        const run = runSessionExecution(f.args);
        await run;
        expect(f.preparation).toEqual([
            'analyze:1_empty.sql', 'load:1_empty.sql',
            'analyze:2_commands.sql', 'load:2_commands.sql',
            'analyze:10_last.sql', 'load:10_last.sql',
            'analyze:1_empty.sql', 'analyze:2_commands.sql', 'analyze:10_last.sql',
            'analyze:1_empty.sql', 'analyze:2_commands.sql', 'analyze:10_last.sql',
        ]);
        expect(f.plan.mock.calls[0][0].scripts.map(script => script.session)).toEqual([f.scriptSessions[2], f.scriptSessions[1], f.scriptSessions[0]]);
        expect(f.plan.mock.calls[0][0].scripts.map(script => script.name)).toEqual(['1_empty', '2_commands', '10_last']);
        expect(f.executeQuery.mock.calls.map(([connection, args]) => [connection, args.query])).toEqual([
            ['connection', '2_commands.sql:1'], ['connection', '2_commands.sql:2'],
            ['connection', '2_commands.sql:3'], ['connection', '10_last.sql:1'],
        ]);
        expect(f.lastState()).toEqual({
            phase: 'succeeded', totalScripts: 3, completedScripts: 3,
            totalStatements: 4, completedStatements: 4,
            activeFileName: null,
            activeStatementIndex: null, activeStatementCount: null, error: null,
        });
        expect(f.states.some(state => state.completedScripts === 1 && state.completedStatements === 0)).toBe(true);
        expect(f.states.filter(state => state.activeFileName === '2_commands.sql').map(state => state.activeStatementIndex))
            .toEqual(expect.arrayContaining([1, 2, 3]));
        expect(f.unpack).toHaveBeenCalledOnce();
    });

    it('runs the scripts that a change of inputs affects', async () => {
        const f = fixture();
        const EdgeKind = core.buffers.execution.DataflowEdgeKind;
        // The input :min feeds 2_commands, which 10_last reads
        const dataflow = {
            scripts: [], inputs: [{ name: 'min' }, { name: 'other' }],
            edges: [
                { fromScript: 0, fromStatement: 0, toScript: 1, toStatement: 0, kind: EdgeKind.INPUT, name: 'min' },
                { fromScript: 1, fromStatement: 0, toScript: 0, toStatement: 0, kind: EdgeKind.INPUT, name: 'other' },
                { fromScript: 1, fromStatement: 2, toScript: 2, toStatement: 0, kind: EdgeKind.INLINE_REFERENCE, name: '2_commands' },
            ],
        };
        const derive = vi.fn(() => ({ unpack: () => dataflow }));
        (f.session.instance as any).deriveSessionDataflow = derive;
        await runSessionExecution({ ...f.args, inputs: ['min'] });
        expect(derive).toHaveBeenCalledOnce();
        expect(f.plan.mock.calls[0][0].targets).toEqual([1, 2]);
        expect(f.lastState().phase).toBe('succeeded');

        // A change that no script reads runs nothing
        const g = fixture();
        (g.session.instance as any).deriveSessionDataflow = derive;
        await runSessionExecution({ ...g.args, inputs: ['nope'] });
        expect(g.plan).not.toHaveBeenCalled();
        expect(g.executeQuery).not.toHaveBeenCalled();
        expect(g.lastState()).toEqual(expect.objectContaining({ phase: 'succeeded', totalScripts: 0 }));
    });

    it('yields before planning so the execution status can paint', async () => {
        const f = fixture();
        const firstYield = deferred<void>();
        f.yieldToBrowser.mockImplementationOnce(() => firstYield.promise);
        const run = runSessionExecution(f.args);
        expect(f.lastState()).toMatchObject({ phase: 'planning', totalScripts: 3 });
        expect(f.preparation).toEqual([]);
        expect(f.yieldToBrowser).toHaveBeenCalledOnce();
        firstYield.resolve();
        await run;
        expect(f.plan).toHaveBeenCalledOnce();
    });

    it('yields while executing a batch of immediately resolved commands', async () => {
        const f = fixture([{ file: '1_commands.sql', outputs: Array(8).fill(false) }]);
        await runSessionExecution(f.args);
        // Initial status, before graph planning, then after the eighth command.
        expect(f.yieldToBrowser).toHaveBeenCalledTimes(3);
        expect(f.lastState()).toMatchObject({ phase: 'succeeded', completedStatements: 8 });
    });

    it('starts an eligible query after its predecessor result is ready', async () => {
        const f = fixture([{ file: '1.sql', outputs: [false, false] }]);
        f.args.maxConcurrentQueries = () => 4;
        const first = deferred<null>();
        const started = deferred<void>();
        f.executeQuery.mockImplementationOnce((_connection, args) => {
            args.onResultsReady?.();
            started.resolve();
            return [1, first.promise];
        });
        const run = runSessionExecution(f.args);
        await started.promise;
        expect(f.executeQuery).toHaveBeenCalledTimes(2);
        expect(f.lastState()?.completedStatements).toBe(0);
        first.resolve(null);
        await run;
        expect(f.executeQuery).toHaveBeenCalledTimes(2);
    });

    it('waits for result readiness before launching dependent queries', async () => {
        const f = fixture([{ file: '1.sql', outputs: [false, false] }]);
        f.args.maxConcurrentQueries = () => 4;
        f.graph.edges.push({ from: 0, to: 1 });
        const resultsReady = deferred<void>();
        const first = deferred<null>();
        const started = deferred<void>();
        f.executeQuery.mockImplementationOnce((_connection, args) => {
            resultsReady.promise.then(() => args.onResultsReady?.());
            started.resolve();
            return [1, first.promise];
        });
        const run = runSessionExecution(f.args);
        await started.promise;
        expect(f.executeQuery).toHaveBeenCalledTimes(1);
        resultsReady.resolve();
        await new Promise<void>(resolve => setTimeout(resolve));
        expect(f.executeQuery).toHaveBeenCalledTimes(2);
        first.resolve(null);
        await run;
    });

    it.each(['invalid', 'text', 'analysis', 'membership', 'session', 'instance', 'missing'])
        ('rejects %s plans before backend execution', async kind => {
            const f = fixture();
            if (kind === 'invalid') {
                f.graph.valid = false;
                f.graph.diagnostics.push({ message: 'Invalid SQL' });
            }
            f.onState.mockImplementation(state => {
                f.states.push(state);
                if (state.phase !== 'running') return;
                switch (kind) {
                    case 'text': f.scriptSessions[2].version++; break;
                    case 'analysis': f.graph.scripts[0].analyzedTextVersion = 0n; break;
                    case 'membership': delete f.session.scriptRefs['1_empty.sql']; break;
                    case 'session': f.session.scripts[102].scriptSession = f.session.scripts[101].scriptSession; break;
                    case 'instance': f.getSession.mockReturnValue({ ...f.session, instance: {} as core.DashQL }); break;
                    case 'missing': f.getSession.mockReturnValue(null); break;
                }
            });
            await runSessionExecution(f.args);
            expect(f.executeQuery).not.toHaveBeenCalled();
            expect(f.lastState()?.phase).toBe('failed');
            expect(f.lastState()?.error).toBeTruthy();
            expect(f.unpack).toHaveBeenCalledOnce();
        });

    it('runs a plan whose catalog moved on since planning', async () => {
        const f = fixture();
        f.onState.mockImplementation(state => {
            f.states.push(state);
            if (state.phase === 'running') f.graph.scripts[0].analyzedCatalogRevision = 0n;
        });
        await runSessionExecution(f.args);
        expect(f.executeQuery).toHaveBeenCalled();
        expect(f.lastState()?.phase).toBe('succeeded');
    });

    it('checks editor update status before publishing', async () => {
        const f = fixture();
        f.scriptSessions[2].analyze.mockReturnValue({ status: -1 as core.buffers.editor.EditorUpdateStatus,
            analysisAvailable: true, statusMessage: null });
        await runSessionExecution(f.args);
        expect(f.scriptSessions[2].loadIntoCatalog).not.toHaveBeenCalled();
        expect(f.plan).not.toHaveBeenCalled();
        expect(f.executeQuery).not.toHaveBeenCalled();
        expect(f.lastState()?.phase).toBe('failed');
    });

    it('fails fast while retaining the failing query and earlier successful work', async () => {
        const f = fixture();
        f.executeQuery.mockImplementationOnce(() => [1, Promise.resolve(null)])
            .mockImplementationOnce(() => [2, Promise.reject(new Error('Backend failure'))]);
        await expect(runSessionExecution(f.args)).resolves.toBeUndefined();
        expect(f.executeQuery).toHaveBeenCalledTimes(2);
        expect(f.session.scripts[101].latestQueryId).toBe(2);
        expect(f.lastState()).toMatchObject({ phase: 'failed', error: 'Backend failure',
            completedScripts: 1, completedStatements: 1, activeStatementIndex: 2 });
    });

    it('accepts null results for command-only scripts', async () => {
        const f = fixture([{ file: '1_commands.sql', outputs: [false, false] }]);
        await runSessionExecution(f.args);
        expect(f.executeQuery.mock.calls.every(([, args]) => args.analyzeResults === false)).toBe(true);
        expect(f.lastState()).toMatchObject({ phase: 'succeeded', completedScripts: 1, completedStatements: 2 });
        expect(f.session.scripts[100].latestResultQueryId).toBe(50);
        f.graph.nodes[0].producesOutput = true;
        await runSessionExecution(f.args);
        expect(f.modifySessionScripts.mock.calls.some(([action]) => action.type === REGISTER_SCRIPT_RESULT)).toBe(false);
    });

    it('analyzes only the last output and restores it after successful trailing commands', async () => {
        const f = fixture([{ file: '1_output.sql', outputs: [true, false, true, false] }]);
        f.executeQuery.mockImplementation(() => [f.executeQuery.mock.calls.length, Promise.resolve(tableFromArrays({ value: [1] }))]);
        await runSessionExecution(f.args);
        expect(f.executeQuery.mock.calls.map(([, args]) => args.analyzeResults)).toEqual([false, false, true, false]);
        for (const [, args] of f.executeQuery.mock.calls) {
            expect(args).toMatchObject({ cacheable: false, throwOnError: true, abortSignal: f.controller.signal });
        }
        expect(f.modifySessionScripts.mock.calls.filter(([action]) => action.type === REGISTER_QUERY).map(([action]) => action.value)).toEqual([
            [100, 1], [100, 2], [100, 3], [100, 4], [100, 3],
        ]);
        expect(f.session.scripts[100].latestQueryId).toBe(3);
        expect(f.session.scripts[100].latestResultQueryId).toBe(3);
        expect(f.modifySessionScripts).toHaveBeenCalledWith({ type: REGISTER_SCRIPT_RESULT, value: [100, 3] });
    });

    it('keeps the output result after a trailing command fails', async () => {
        const f = fixture([{ file: '1_output.sql', outputs: [true, false] }]);
        f.executeQuery.mockImplementationOnce(() => [1, Promise.resolve(tableFromArrays({ value: [1] }))])
            .mockImplementationOnce(() => [2, Promise.reject(new Error('Command failed'))]);
        await runSessionExecution(f.args);
        expect(f.session.scripts[100].latestQueryId).toBe(2);
        expect(f.modifySessionScripts.mock.calls.filter(([action]) => action.type === REGISTER_QUERY)).toHaveLength(2);
        expect(f.lastState()?.phase).toBe('failed');
        expect(f.session.scripts[100].latestResultQueryId).toBe(1);
        expect(f.modifySessionScripts).toHaveBeenCalledWith({ type: REGISTER_SCRIPT_RESULT, value: [100, 1] });
        await runSessionExecution(f.args);
        expect(f.session.scripts[100].latestResultQueryId).toBe(1);
    });

    it('keeps the output result when a later output fails', async () => {
        const f = fixture([{ file: '1_output.sql', outputs: [true] }]);
        f.executeQuery.mockImplementationOnce(() => [1, Promise.resolve(tableFromArrays({ value: [1] }))])
            .mockImplementationOnce(() => [2, Promise.reject(new Error('Output failed'))]);
        await runSessionExecution(f.args);
        await runSessionExecution(f.args);
        expect(f.session.scripts[100].latestQueryId).toBe(2);
        expect(f.session.scripts[100].latestResultQueryId).toBe(1);
    });

    it('uses captured SQL after execution starts, even when live text changes', async () => {
        const f = fixture();
        f.executeQuery.mockImplementationOnce(() => {
            f.scriptSessions[1].version++;
            return [1, Promise.resolve(null)];
        });
        await runSessionExecution(f.args);
        expect(f.executeQuery.mock.calls[1][1].query).toBe('2_commands.sql:2');
        expect(f.lastState()?.phase).toBe('succeeded');
    });

    it('stops queued SQL when a session script is removed during execution', async () => {
        const f = fixture();
        f.executeQuery.mockImplementationOnce(() => {
            delete f.session.scriptRefs['10_last.sql'];
            return [1, Promise.resolve(null)];
        });
        await runSessionExecution(f.args);
        expect(f.executeQuery).toHaveBeenCalledTimes(1);
        expect(f.lastState()?.phase).toBe('failed');
        expect(f.lastState()?.error).toContain('Session changed');
    });

    it.each(['execution', 'cancellation'])('drains both promises when %s settles first on abort', async first => {
        const f = fixture();
        const execution = deferred<null>();
        const cancellation = deferred<void>();
        const started = deferred<void>();
        f.executeQuery.mockImplementationOnce(() => { started.resolve(); return [42, execution.promise]; });
        f.cancelQuery.mockReturnValue(cancellation.promise);
        const run = runSessionExecution(f.args);
        await started.promise;
        f.controller.abort();
        expect(f.cancelQuery).toHaveBeenCalledExactlyOnceWith('connection', 42);
        expect(f.lastState()?.phase).toBe('stopping');
        if (first === 'execution') {
            execution.resolve(null);
            await execution.promise;
        } else {
            cancellation.resolve();
            await cancellation.promise;
        }
        expect(f.lastState()?.phase).toBe('stopping');
        expect(f.executeQuery).toHaveBeenCalledTimes(1);
        execution.resolve(null);
        cancellation.resolve();
        await run;
        expect(f.lastState()).toMatchObject({ phase: 'cancelled', error: null, completedStatements: 0 });
        expect(f.executeQuery).toHaveBeenCalledTimes(1);
    });

    it('handles cancellation rejection immediately while execution remains pending', async () => {
        const f = fixture();
        const execution = deferred<null>();
        const started = deferred<void>();
        f.executeQuery.mockImplementationOnce(() => { started.resolve(); return [42, execution.promise]; });
        f.cancelQuery.mockRejectedValue(new Error('Cancel failed'));
        const run = runSessionExecution(f.args);
        await started.promise;
        f.controller.abort();
        await f.cancelQuery.mock.results[0].value.catch(() => {});
        expect(f.lastState()?.phase).toBe('stopping');
        execution.reject(new Error('Aborted'));
        await expect(run).resolves.toBeUndefined();
        expect(f.lastState()?.phase).toBe('cancelled');
    });

    it('waits for analysis synchronization and catches synchronous executor errors', async () => {
        const f = fixture();
        const registration = deferred<SessionScripts | null>();
        f.modifySessionScripts.mockReturnValueOnce(registration.promise);
        const run = runSessionExecution(f.args);
        await Promise.resolve();
        expect(f.executeQuery).not.toHaveBeenCalled();
        registration.resolve(f.session);
        await run;
        expect(f.lastState()?.phase).toBe('succeeded');

        const failed = fixture();
        failed.executeQuery.mockImplementation(() => { throw new Error('Cannot launch'); });
        await expect(runSessionExecution(failed.args)).resolves.toBeUndefined();
        expect(failed.lastState()).toMatchObject({ phase: 'failed', error: 'Cannot launch' });
        expect(failed.executeQuery).toHaveBeenCalledTimes(1);
    });

    it('handles synchronous cancellation errors without launching queued work', async () => {
        const f = fixture();
        f.cancelQuery.mockImplementation(() => { throw new Error('Cannot cancel'); });
        f.modifySessionScripts.mockImplementation(action => { if (action.type === REGISTER_QUERY) f.controller.abort(); });
        await expect(runSessionExecution(f.args)).resolves.toBeUndefined();
        expect(f.executeQuery).toHaveBeenCalledTimes(1);
        expect(f.cancelQuery).toHaveBeenCalledTimes(1);
        expect(f.lastState()?.phase).toBe('cancelled');
    });

    it('launches nothing when already aborted and removes its abort listener after finishing', async () => {
        const f = fixture();
        f.controller.abort();
        await runSessionExecution(f.args);
        expect(f.plan).not.toHaveBeenCalled();
        expect(f.executeQuery).not.toHaveBeenCalled();
        expect(f.lastState()?.phase).toBe('cancelled');
        const completed = fixture();
        await runSessionExecution(completed.args);
        const count = completed.states.length;
        completed.controller.abort();
        expect(completed.states).toHaveLength(count);
        expect(completed.cancelQuery).not.toHaveBeenCalled();
    });

    it('runs the scripts of every connection in one plan, one statement of a connection at a time', async () => {
        const f = fixture([
            { file: '1_a.sql', outputs: [true], connection: 'a' },
            { file: '2_a.sql', outputs: [true], connection: 'a' },
            { file: '3_b.sql', outputs: [false, true], connection: 'b' },
            { file: '4_a.sql', outputs: [true], connection: 'a' },
        ]);
        // Independent statements: the connections run side by side
        f.graph.edges.length = 0;
        const running = new Map<string, number>();
        let overlap = false;
        f.executeQuery.mockImplementation((connection: string) => {
            running.set(connection, (running.get(connection) ?? 0) + 1);
            if (running.get(connection)! > 1) overlap = true;
            if ([...running.values()].filter(count => count > 0).length > 1) running.set('both', 1);
            const done = Promise.resolve(null).then(result => { running.set(connection, running.get(connection)! - 1); return result; });
            return [f.executeQuery.mock.calls.length, done];
        });
        await runSessionExecution(f.args);
        expect(f.plan).toHaveBeenCalledOnce();
        expect(f.plan.mock.calls[0][0].connections.map(connection => connection.id)).toEqual(['a', 'b']);
        const calls = f.executeQuery.mock.calls.map(([connection, args]) => [connection, args.query]);
        expect(calls.filter(([connection]) => connection === 'a')).toEqual([['a', '1_a.sql:1'], ['a', '2_a.sql:1'], ['a', '4_a.sql:1']]);
        expect(calls.filter(([connection]) => connection === 'b')).toEqual([['b', '3_b.sql:1'], ['b', '3_b.sql:2']]);
        // A connection runs one statement at a time, the other connection runs meanwhile
        expect(overlap).toBe(false);
        expect(running.has('both')).toBe(true);
        expect(f.lastState()).toMatchObject({ phase: 'succeeded', totalStatements: 5, completedStatements: 5, completedScripts: 4 });
    });

    it('cancels a query on the connection that runs it', async () => {
        const f = fixture([{ file: '1_b.sql', outputs: [true], connection: 'b' }]);
        const started = deferred<void>();
        const execution = deferred<null>();
        f.executeQuery.mockImplementationOnce(() => { started.resolve(); return [42, execution.promise]; });
        const run = runSessionExecution(f.args);
        await started.promise;
        f.controller.abort();
        expect(f.cancelQuery).toHaveBeenCalledExactlyOnceWith('b', 42);
        execution.resolve(null);
        await run;
    });

    it('succeeds on an empty session', async () => {
        const f = fixture([]);
        await runSessionExecution(f.args);
        expect(f.lastState()).toMatchObject({ phase: 'succeeded', totalScripts: 0, totalStatements: 0 });
        expect(f.executeQuery).not.toHaveBeenCalled();
    });
});
