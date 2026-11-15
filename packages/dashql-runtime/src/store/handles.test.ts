import * as arrow from 'apache-arrow';
import type * as core from '@ankoh/dashql-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { HandleTable, handlesOf } from './handles.js';
import { CatalogUpdateTaskStatus, CatalogUpdateVariant } from '../connections/catalog/catalog_update_state.js';
import type { ConnectionParams } from '../connections/connection_params.js';
import {
    CATALOG_UPDATE_FAILED,
    DELETE_CONNECTION,
    restoreCatalogUpdates,
    UPDATE_CATALOG,
    type ConnectionAction,
    type ConnectionState,
} from '../connections/connection_state.js';
import type { HyperDB } from '../platform/hyperdb/hyperdb_wasm.js';
import {
    createQueryExecutionState,
    createQueryResponseStreamMetrics,
    EXECUTE_QUERY,
    QUERY_RECEIVED_ALL_BATCHES,
    QUERY_SUCCEEDED,
    QueryType,
    type QueryExecutionResponseStream,
} from '../query/query_execution_state.js';
import { ShellQueryExecutionTracker } from '../query/shell_query_execution.js';
import { vectorFromArray } from '../testing/arrow_fixtures.js';
import { createTestConnection, reduceTestConnection } from '../testing/connection_fixtures.js';
import { openTestHyperDB } from '../testing/test_hyperdb.js';
import { createTestRuntime, testCore, type TestRuntime } from '../testing/test_runtime.js';
import { CONNECTOR_INFOS, ConnectorType } from '../connections/connector_info.js';
import { isWorkbookExecutionRunning } from '../workbook/scripts/workbook_execution.js';
import { createWorkbookScripts } from '../workbook/scripts/workbook_scripts.js';
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

    it('is one table per core instance', async () => {
        const instance = await testCore();
        expect(handlesOf(instance)).toBe(handlesOf(instance));
        expect(handlesOf({} as core.DashQL)).not.toBe(handlesOf(instance));
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
        // The browsers run the tests of many files on one core, the table may hold the handles of other tests
        const handles = handlesOf(dql);
        const before = handles.size;

        // A connection online with a channel whose statements finish without a result
        const stream: QueryExecutionResponseStream = {
            cancel: vi.fn(async () => { }),
            getMetrics: createQueryResponseStreamMetrics,
            getSchema: async () => null,
            produce: vi.fn<QueryExecutionResponseStream['produce']>(async () => { }),
        };
        const channel = { executeQuery: vi.fn(async () => stream), close: vi.fn() };
        const connectionId = 'handles-database';
        let connection: ConnectionState = createTestConnection(dql, {
            connectionId,
            params: { hyper: { endpoint: 'http://hyper' } } as ConnectionParams,
            channel,
        });
        // The catalog describes the connection, the runs don't wait for the catalog loader
        connection = restoreCatalogUpdates(connection, true, null);
        const workbook = createWorkbookScripts({
            instance: dql, workbookId: 'handles', name: 'handles', pendingConnection: null, workbookMetadata: createEmptyMetadata(),
            scripts: [{
                name: '1_commands.sql', sql: 'create table a (x int);',
                connection: { connectionId, connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER], catalog: dql.createCatalog() },
            }],
        });
        database = await openTestHyperDB('handles_test');
        const rt = await createTestRuntime({ computeDatabase: database });
        runtime = rt;
        rt.workbooks.store.update(registry => ({ ...registry, workbookScriptsMap: new Map([[workbook.workbookId, workbook]]) }));
        rt.connections.store.update(registry => ({ ...registry, connections: new Map([[connectionId, connection]]) }));

        // A run of the workbook executes its statement on the connection
        rt.execution.start(workbook.workbookId, () => { });
        await vi.waitFor(() => expect(stream.produce).toHaveBeenCalled());
        await vi.waitFor(() => expect(isWorkbookExecutionRunning(workbook.workbookId)).toBe(false));
        connection = rt.connection(connectionId);
        expect(connection.queriesFinished.size).toBeGreaterThan(0);

        // A query with a result, one that stays active and a catalog update that fails
        const reduce = (action: ConnectionAction) => { connection = reduceTestConnection(connection, action); };
        const metadata = { queryType: QueryType.USER_PROVIDED, title: null, description: null, issuer: null, userProvided: true };
        const result = new arrow.Table({ n: vectorFromArray([1, 2], new arrow.Int32()) });
        reduce({ type: EXECUTE_QUERY, value: [1001, createQueryExecutionState(1001, 1, 'select 1', metadata, new AbortController())] });
        reduce({ type: QUERY_RECEIVED_ALL_BATCHES, value: [1001, result, createQueryResponseStreamMetrics()] });
        reduce({ type: QUERY_SUCCEEDED, value: [1001] });
        expect(connection.queriesFinished.get(1001)?.resultTable).toBe(result);
        const active = new AbortController();
        reduce({ type: EXECUTE_QUERY, value: [1002, createQueryExecutionState(1002, 2, 'select 2', metadata, active)] });
        const update = new AbortController();
        reduce({
            type: UPDATE_CATALOG,
            value: [7, {
                taskId: 7, taskVariant: CatalogUpdateVariant.FULL_CATALOG_REFRESH, status: CatalogUpdateTaskStatus.STARTED,
                cancellation: update, queries: [], error: null, startedAt: new Date(), finishedAt: null,
            }],
        });
        const failure = new Error('the catalog failed');
        reduce({ type: CATALOG_UPDATE_FAILED, value: [7, failure] });
        // The objects of the app keep their identity through the handles
        expect(connection.catalogUpdates.tasksFinished.get(7)?.cancellation).toBe(update);
        expect(connection.catalogUpdates.tasksFinished.get(7)?.error).toBe(failure);
        expect(connection.queriesActive.get(1002)?.cancellation).toBe(active);

        // A query of the shell
        const shell = new ShellQueryExecutionTracker(dql);
        shell.dispatch({ type: EXECUTE_QUERY, value: [2001, createQueryExecutionState(2001, 3, 'select 3', metadata, new AbortController())] });
        shell.dispatch({ type: QUERY_RECEIVED_ALL_BATCHES, value: [2001, result, createQueryResponseStreamMetrics()] });
        expect(shell.getSnapshot()[0]?.resultTable).toBe(result);

        // A computation of a result, analyzed in the runtime of the core
        const table = new arrow.Table({
            score: vectorFromArray([42, 10, 10, 30], new arrow.Float64()),
            name: vectorFromArray(['a', 'b', 'a', 'c'], new arrow.Utf8()),
        });
        await rt.coreRuntime.analyzeTable(1, table, { connectionId });
        const computation = rt.coreRuntime.store.get('computation', 1);
        expect(rt.coreRuntime.table(computation?.tableAggregation?.table)?.numRows).toBe(1);
        expect(rt.coreRuntime.handles.size).toBeGreaterThan(0);

        // Everything goes: the computation, the history of the shell, the connection, the runtime
        rt.coreRuntime.deleteComputation(1);
        rt.coreRuntime.flush();
        expect(rt.coreRuntime.store.get('computation', 1)).toBeNull();
        expect(rt.coreRuntime.handles.size).toBe(0);
        shell.release();
        await rt.destroy();
        runtime = null;
        reduce({ type: DELETE_CONNECTION, value: null });
        expect(channel.close).toHaveBeenCalledTimes(1);
        expect(active.signal.aborted).toBe(true);
        expect(handles.size).toBe(before);
    }, 60_000);
});
