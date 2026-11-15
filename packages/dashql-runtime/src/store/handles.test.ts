import * as arrow from 'apache-arrow';
import type * as core from '@ankoh/dashql-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { HandleTable } from './handles.js';
import { CatalogUpdateTaskStatus, CatalogUpdateVariant } from '../connections/catalog/catalog_update_state.js';
import type { ConnectionParams } from '../connections/connection_params.js';
import { DELETE_CONNECTION } from '../connections/connection_state.js';
import type { HyperDB } from '../platform/hyperdb/hyperdb_wasm.js';
import { createQueryResponseStreamMetrics, QueryType, type QueryExecutionResponseStream } from '../query/query_execution_state.js';
import { executeTrackedQuery } from '../query/tracked_query_execution.js';
import { vectorFromArray } from '../testing/arrow_fixtures.js';
import { openTestHyperDB } from '../testing/test_hyperdb.js';
import { createTestRuntime, testCore, type TestRuntime } from '../testing/test_runtime.js';
import { isWorkbookExecutionRunning } from '../workbook/scripts/workbook_execution.js';
import { createWorkbookScripts, scriptConnectionOf } from '../workbook/scripts/workbook_scripts.js';
import { createEmptyMetadata } from '../workbook/scripts/script_types.js';

describe('HandleTable', () => {
    it('keeps an object under a new handle until it is released', () => {
        const handles = new HandleTable();
        const object = { name: 'a table' };
        const first = handles.register(object);
        const second = handles.register(object);
        expect(second).not.toBe(first);
        expect(handles.get(first)).toBe(object);
        expect(handles.size).toBe(2);
        handles.release(first);
        expect(handles.get(first)).toBeUndefined();
        expect(handles.get(second)).toBe(object);
        // Releasing again and reading none change nothing
        handles.release(first);
        expect(handles.get(null)).toBeUndefined();
        expect(handles.size).toBe(1);
    });

    it('runs the effects on handles in order and returns the others', () => {
        const handles = new HandleTable();
        const channel = { close: vi.fn() };
        const cancellation = new AbortController();
        const channelHandle = handles.register(channel);
        const cancellationHandle = handles.register(cancellation);
        const rest = handles.apply([
            { type: 'cancelSetup' as const },
            { type: 'abort' as const, handle: cancellationHandle, reason: 'Connection was reset' },
            { type: 'close' as const, handle: channelHandle },
            { type: 'release' as const, handle: cancellationHandle },
        ]);
        expect(rest).toEqual([{ type: 'cancelSetup' }]);
        expect(channel.close).toHaveBeenCalledTimes(1);
        expect(cancellation.signal.aborted).toBe(true);
        expect((cancellation.signal.reason as DOMException).name).toBe('AbortError');
        expect((cancellation.signal.reason as DOMException).message).toBe('Connection was reset');
        expect(handles.size).toBe(0);
    });
});

describe('The handles of a runtime', () => {
    let dql: core.DashQL;
    let runtime: TestRuntime | null = null;
    let database: HyperDB | null = null;
    beforeAll(async () => { dql = await testCore(); });
    afterEach(async () => {
        await runtime?.destroy();
        runtime = null;
        await database?.terminate();
        database = null;
    });

    it('are all released after a connection with queries, a computation and a workbook run went', async () => {
        database = await openTestHyperDB('handles_test');
        const rt = await createTestRuntime({ computeDatabase: database });
        runtime = rt;
        const handles = rt.coreRuntime.handles;

        // A connection online with a channel whose statements finish without a result
        const stream: QueryExecutionResponseStream = {
            cancel: vi.fn(async () => { }),
            getMetrics: createQueryResponseStreamMetrics,
            getSchema: async () => null,
            produce: vi.fn<QueryExecutionResponseStream['produce']>(async () => { }),
        };
        const channel = { executeQuery: vi.fn(async () => stream), close: vi.fn() };
        const connectionId = 'handles-database';
        rt.addConnection({
            connectionId,
            params: { hyper: { protocol: 'V3_GRPC', endpoint: 'http://hyper' } } as ConnectionParams,
            channel,
        });
        // The catalog describes the connection, the runs don't wait for the catalog loader
        rt.coreRuntime.dispatch({ connection: connectionId }, { kind: 'restoreCatalogUpdates', value: { described: true } });
        rt.coreRuntime.flush();
        const workbook = createWorkbookScripts({
            instance: dql, workbookId: 'handles', name: 'handles', pendingConnection: null, workbookMetadata: createEmptyMetadata(),
            scripts: [{ name: '1_commands.sql', sql: 'create table a (x int);', connection: scriptConnectionOf(rt.coreRuntime, rt.connection(connectionId)) }],
        });
        rt.workbooks.store.update(registry => ({ ...registry, workbookScriptsMap: new Map([[workbook.workbookId, workbook]]) }));

        // A run of the workbook executes its statement on the connection, through the query executor of the runtime
        rt.execution.start(workbook.workbookId, () => { });
        await vi.waitFor(() => expect(stream.produce).toHaveBeenCalled());
        await vi.waitFor(() => expect(isWorkbookExecutionRunning(workbook.workbookId)).toBe(false));
        expect(rt.connection(connectionId).queriesFinishedOrdered.length).toBeGreaterThan(0);

        // A query that the host runs with a result, one that stays active and a catalog update that fails
        const tracker = { runtime: rt.coreRuntime, target: { connection: connectionId } };
        const metadata = { queryType: QueryType.USER_PROVIDED, title: null, description: null, issuer: null, userProvided: true };
        const result = new arrow.Table({ n: vectorFromArray([1, 2], new arrow.Int32()) });
        await executeTrackedQuery({ query: 'select 1', metadata, tracker, execute: async context => context.receivedAllBatches(result) });
        const active = new AbortController();
        const pending = executeTrackedQuery({ query: 'select 2', metadata, tracker, cancellation: active, execute: () => new Promise((_resolve, reject) => {
            active.signal.addEventListener('abort', () => reject(active.signal.reason));
        }) });
        const update = new AbortController();
        rt.coreRuntime.dispatch({ connection: connectionId }, {
            kind: 'updateCatalog',
            value: { taskId: 7, handle: handles.register({ abort: (reason: unknown) => update.abort(reason) }), variant: CatalogUpdateVariant.FULL_CATALOG_REFRESH },
        });
        rt.coreRuntime.dispatch({ connection: connectionId }, { kind: 'catalogUpdateFinished', value: { taskId: 7, status: CatalogUpdateTaskStatus.FAILED, error: { message: 'the catalog failed' } } });
        rt.coreRuntime.flush();
        const connection = rt.connection(connectionId);
        expect(connection.catalogUpdates.tasksFinished.find(task => task.taskId === 7)?.error).toEqual({ message: 'the catalog failed' });
        const finished = rt.coreRuntime.store.get('query', connection.queriesFinishedOrdered.at(-1)!);
        expect(rt.coreRuntime.table(finished?.resultTable?.id)).toBe(result);

        // A query of the shell
        rt.coreRuntime.dispatch({ history: 'shell' }, { kind: 'createHistory', value: { limit: 100 } });
        await executeTrackedQuery({ query: 'select 3', metadata, tracker: { runtime: rt.coreRuntime, target: { history: 'shell' } }, execute: async context => context.receivedAllBatches(result) });

        // A computation of a result, analyzed in the runtime
        const table = new arrow.Table({
            score: vectorFromArray([42, 10, 10, 30], new arrow.Float64()),
            name: vectorFromArray(['a', 'b', 'a', 'c'], new arrow.Utf8()),
        });
        await rt.coreRuntime.analyzeTable(1, table, { connectionId });
        const computation = rt.coreRuntime.store.get('computation', 1);
        expect(rt.coreRuntime.table(computation?.tableAggregation?.table)?.numRows).toBe(1);

        // Everything goes: the computation, the history of the shell, the connection, the runtime
        rt.coreRuntime.deleteComputation(1);
        rt.coreRuntime.dispatch({ history: 'shell' }, { kind: 'dropHistory' });
        rt.coreRuntime.dispatchConnection(connectionId, { type: DELETE_CONNECTION, value: null });
        rt.coreRuntime.flush();
        expect(rt.coreRuntime.store.get('computation', 1)).toBeNull();
        expect(channel.close).toHaveBeenCalledTimes(1);
        expect(active.signal.aborted).toBe(true);
        await expect(pending).rejects.toBeInstanceOf(DOMException);
        await rt.destroy();
        runtime = null;
        expect(handles.size).toBe(0);
    }, 60_000);
});
