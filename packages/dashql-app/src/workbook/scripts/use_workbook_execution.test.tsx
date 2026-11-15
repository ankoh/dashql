import * as React from 'react';
import * as core from '@ankoh/dashql-core';
import type { MockInstance } from 'vitest';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComputeConnectionProvider, useComputeDatabase } from '../../compute/compute_connection_provider.js';
import { EmbeddedDatabaseProvider } from '../../platform/database/embedded_database_provider.js';
import type { EmbeddedComputeDatabase } from '@ankoh/dashql-runtime/platform/database/embedded_database';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { createQueryResponseStreamMetrics, QueryType, type QueryExecutionResponseStream } from '@ankoh/dashql-runtime/query/query_execution_state';
import { ConnectionHealth } from '@ankoh/dashql-runtime/connections/connection_state';
import type { CoreRuntime } from '@ankoh/dashql-runtime/core_runtime';
import { useCoreRuntime } from '../../runtime/runtime_hooks.js';
import { createTestConnection } from '@ankoh/dashql-runtime/testing/connection_fixtures';
import { WorkbookTestBackend } from '@ankoh/dashql-runtime/testing/workbook_test_backend';
import { StorageProvider } from '../../storage/storage_provider.js';
import { useWorkbookExecution } from './use_workbook_execution.js';
import { workbookExecutionIsBusy } from '@ankoh/dashql-runtime/workbook/scripts/workbook_execution_service';
import { isWorkbookExecutionRunning } from '@ankoh/dashql-runtime/workbook/scripts/workbook_execution';
import { analyzeWorkbook } from '@ankoh/dashql-runtime/testing/test_runtime';
import { useRuntime } from '../../runtime/runtime_provider.js';
import { TestRuntime } from '../../tests/test_runtime.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(yes => { resolve = yes; });
    return { promise, resolve };
}

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
beforeAll(async () => { await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

function fixture(workbookId: string, deferStream = false) {
    const acquisition = deferred();
    if (!deferStream) acquisition.resolve();
    const execution = deferred();
    const cancellation = deferred();
    let signal: AbortSignal | undefined;
    const aborted = vi.fn();
    const stream: QueryExecutionResponseStream = {
        cancel: vi.fn(() => cancellation.promise),
        getMetrics: createQueryResponseStreamMetrics,
        getSchema: async () => null,
        produce: vi.fn<QueryExecutionResponseStream['produce']>(async (_batches, _progress, abort) => {
            signal = abort;
            abort?.addEventListener('abort', aborted, { once: true });
            await execution.promise;
            abort?.removeEventListener('abort', aborted);
            abort?.throwIfAborted();
        }),
    };
    const executeQuery = vi.fn(async (_query: unknown, abort?: AbortSignal) => {
        signal = abort;
        await acquisition.promise;
        return stream;
    });
    // The runs of the workbook on the runtime
    const plan = vi.fn();
    // A connection of the runtime of the test, online with a channel, and the workbook on it with two commands that
    // don't depend on each other: a connection without a protocol runs them one at a time
    const database = {
        connectionId: `${workbookId}-database`,
        online: true,
        create(runtime: CoreRuntime) {
            if (runtime.connection(this.connectionId) != null) return;
            const state = createTestConnection(runtime, {
                connectionId: this.connectionId,
                params: { hyper: {} } as any,
                channel: this.online ? { executeQuery } : undefined,
                online: this.online,
            });
            runtime.flush();
            expect(state.connectionHealth).toBe(this.online ? ConnectionHealth.ONLINE : ConnectionHealth.NOT_STARTED);
            runtime.createWorkbook(this.connectionId, workbookId, false, undefined, workbookId);
            runtime.dispatchWorkbook(workbookId, { kind: 'createScript', value: { text: 'create table a (x int);\ncreate table b (x int);', base: '1_commands' } });
        },
    };
    return { workbookId, database, plan, stream, executeQuery, acquisition, execution, cancellation, aborted,
        get signal() { return signal; } };
}

type Fixture = ReturnType<typeof fixture>;
type Execution = ReturnType<typeof useWorkbookExecution>;

function Consumer(props: { workbookId: string; capture: (execution: Execution) => void }) {
    const execution = useWorkbookExecution(props.workbookId);
    const database = useComputeDatabase();
    React.useLayoutEffect(() => { if (database) props.capture(execution); });
    return null;
}

/// Captures the run of a workbook also before the compute database is set up
function EarlyConsumer(props: { capture: (execution: Execution) => void }) {
    const execution = useWorkbookExecution('first');
    React.useLayoutEffect(() => props.capture(execution));
    return null;
}

/// Create the connections and the workbooks of the fixtures in the runtime, the runs of a workbook are counted by its
/// fixture
function SeedRuntime(props: { fixtures: Fixture[]; children: React.ReactNode }) {
    const runtime = useRuntime();
    const coreRuntime = useCoreRuntime();
    const [ready, setReady] = React.useState(false);
    React.useEffect(() => {
        for (const f of props.fixtures) {
            f.database.create(coreRuntime);
            analyzeWorkbook(runtime, f.workbookId);
        }
        const start = coreRuntime.startWorkbookRun.bind(coreRuntime);
        const spy: MockInstance<typeof coreRuntime.startWorkbookRun> = vi.spyOn(coreRuntime, 'startWorkbookRun');
        spy.mockImplementation((workbookId, host, options) => {
            props.fixtures.find(f => f.workbookId === workbookId)?.plan();
            return start(workbookId, host, options);
        });
        setReady(true);
    }, [props.fixtures, runtime, coreRuntime]);
    return ready ? props.children : null;
}

// The runs themselves are tested in the runtime (workbook/scripts/workbook_execution_service.test.ts), these are the
// runtime of the app and the hook on it
describe('the runs of workbooks in the app', () => {
    let container: HTMLDivElement;
    let root: Root;
    let fixtures: Fixture[];
    let current: Execution;
    let observer: Execution;
    let early: Execution | null = null;
    let observerCommits = 0;
    let backend: WorkbookTestBackend;
    let setupDatabase: () => Promise<EmbeddedComputeDatabase>;
    const capture = (execution: Execution) => { current = execution; };
    const captureObserver = (execution: Execution) => { observer = execution; observerCommits += 1; };

    beforeEach(() => {
        fixtures = [fixture('first'), fixture('second')];
        early = null;
        backend = new WorkbookTestBackend();
        setupDatabase = async () => ({ terminate: vi.fn() }) as unknown as EmbeddedComputeDatabase;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        act(() => root.unmount());
        await act(async () => {
            fixtures.forEach(f => { f.acquisition.resolve(); f.execution.resolve(); f.cancellation.resolve(); });
            await vi.waitFor(() => {
                for (const f of fixtures) expect(isWorkbookExecutionRunning(f.workbookId)).toBe(false);
            });
        });
        container.remove();
    });

    async function render(workbookId = 'first', showConsumer = true, showRuntime = true) {
        // The execution value is memoized, count the observer commits instead of comparing identities.
        const previousObserverCommits = observerCommits;
        await act(async () => {
            root.render(<LoggerProvider>
                <StorageProvider backend={backend}>
                    <EmbeddedDatabaseProvider setupDatabase={setupDatabase}>
                        <ComputeConnectionProvider>
                            {showRuntime ? <TestRuntime>
                                <SeedRuntime fixtures={fixtures}>
                                    {showConsumer ? <Consumer key={workbookId} workbookId={workbookId} capture={capture} /> : null}
                                    <Consumer workbookId="first" capture={captureObserver} />
                                    <EarlyConsumer capture={execution => { early = execution; }} />
                                </SeedRuntime>
                            </TestRuntime> : <></>}
                        </ComputeConnectionProvider>
                    </EmbeddedDatabaseProvider>
                </StorageProvider>
            </LoggerProvider>);
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        // A timer turn does not guarantee that async database setup and React commits have finished.
        if (showRuntime) await vi.waitFor(() => expect(observerCommits).toBeGreaterThan(previousObserverCommits));
    }

    async function start(f = fixtures[0]) {
        act(() => current.start());
        await vi.waitFor(() => {
            expect(f.stream.produce).toHaveBeenCalledTimes(1);
            expect(current.state?.phase).toBe('running');
        });
        expect(current.busy).toBe(true);
        expect(current.state?.phase).toBe('running');
    }

    it('waits for delayed compute database setup before starting execution', async () => {
        const setup = deferred();
        setupDatabase = vi.fn(async () => {
            await setup.promise;
            return { terminate: vi.fn() } as unknown as EmbeddedComputeDatabase;
        });
        const rendering = render();
        await vi.waitFor(() => expect(setupDatabase).toHaveBeenCalledTimes(1));
        expect(fixtures[0].executeQuery).not.toHaveBeenCalled();
        setup.resolve();
        await rendering;
        await start();
    });

    it('starts no run before the compute database that reads the cached results is set up', async () => {
        const setup = deferred();
        setupDatabase = vi.fn(async () => {
            await setup.promise;
            return { terminate: vi.fn() } as unknown as EmbeddedComputeDatabase;
        });
        // A run without a connection would find no cached result, it doesn't start
        fixtures[0].database.online = false;
        const rendering = render();
        await vi.waitFor(() => expect(early).not.toBeNull());
        expect(early!.ready).toBe(false);
        act(() => early!.start());
        expect(fixtures[0].plan).not.toHaveBeenCalled();
        expect(early!.state).toBeNull();
        setup.resolve();
        await rendering;
        expect(current.ready).toBe(true);
        act(() => current.start());
        await vi.waitFor(() => expect(current.state?.phase).toBe('succeeded'));
        expect(fixtures[0].plan).toHaveBeenCalled();
    });

    it('retains per-workbook state when route consumers switch ids and remount', async () => {
        await render();
        await start();
        await render('second');
        expect(current.state).toBeNull();
        expect(current.busy).toBe(false);
        expect(observer.state?.phase).toBe('running');
        expect(observer.busy).toBe(true);
        expect(fixtures[0].signal?.aborted).toBe(false);
        await start(fixtures[1]);
        expect(fixtures[1].plan).toHaveBeenCalledTimes(1);

        await render('second', false);
        await act(async () => {
            fixtures[0].execution.resolve();
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        await vi.waitFor(() => expect(observer.state?.phase).toBe('succeeded'));
        const completed = observer.state;
        await render('first');
        expect(current.state).toBe(completed);
        expect(current.busy).toBe(false);
        expect(fixtures[0].plan).toHaveBeenCalledTimes(1);
        await render('second');
        expect(current.state?.phase).toBe('running');
        expect(current.busy).toBe(true);
        expect(fixtures[1].signal?.aborted).toBe(false);
    });

    it('aborts every active run when the runtime unmounts, not when route consumers unmount', async () => {
        await render();
        await start();
        await render('second');
        await start(fixtures[1]);
        await render('second', false, false);
        for (const f of fixtures) {
            expect(f.signal?.aborted).toBe(true);
            expect(f.aborted).toHaveBeenCalledTimes(1);
            expect(f.stream.cancel).toHaveBeenCalledTimes(1);
            expect(f.executeQuery).toHaveBeenCalledTimes(1);
        }
    });

});
