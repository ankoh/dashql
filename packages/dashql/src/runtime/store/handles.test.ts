import * as arrow from 'apache-arrow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HandleTable } from './handles.js';
import { appendRowNumbers, createRuntimeTables } from './runtime_tables.js';
import type { ConnectionParams } from '../../platform/connections/connection_params.js';
import type { HyperDB } from '../../platform/platform/hyperdb/hyperdb_wasm.js';
import { createQueryResponseStreamMetrics, QueryType, type QueryExecutionResponseStream } from '../../platform/query/query_execution_state.js';
import { executeTrackedQuery } from '../query/tracked_query_execution.js';
import { vectorFromArray } from '../../platform/testing/arrow_fixtures.js';
import { openTestHyperDB } from '../../platform/testing/test_hyperdb.js';
import { createTestRuntime, type TestRuntime } from '../testing/test_runtime.js';

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

describe('The tables of the platform', () => {
    it('drops a table that streams or builds when its handle is released before it finished', () => {
        const handles = new HandleTable();
        const tables = createRuntimeTables(handles);
        const ipc = arrow.tableToIPC(arrow.tableFromArrays({ n: Int32Array.from([1, 2]) }), 'stream');
        // A partial result of a cancelled query: the runtime releases the table with its run
        const streamed = tables.open();
        tables.push(streamed, ipc.subarray(0, 16));
        expect(tables.stream(streamed)).not.toBeNull();
        const built = tables.begin(ipc);
        expect(handles.size).toBe(2);
        handles.release(streamed);
        handles.release(built);
        expect(handles.size).toBe(0);
        expect(tables.stream(streamed)).toBeNull();
        expect(() => tables.append(built, ipc)).toThrow();
    });

    it('describes a finished table by its rows and its schema, the rows stay with the host', () => {
        const handles = new HandleTable();
        const tables = createRuntimeTables(handles);
        const table = tables.open();
        tables.push(table, arrow.tableToIPC(arrow.tableFromArrays({ n: Int32Array.from([1, 2, 3]) }), 'stream'));
        expect(tables.finish(table).rows).toBe(3);
        const described = tables.describe(table);
        expect(described.rows).toBe(3);
        const schema = arrow.tableFromIPC(described.schema);
        expect(schema.numRows).toBe(0);
        expect(schema.schema.fields.map(field => field.name)).toEqual(['n']);
    });

    it('numbers the rows of a table across its batches', () => {
        const batches = [arrow.tableFromArrays({ s: Int32Array.from([7, 8]) }), arrow.tableFromArrays({ s: Int32Array.from([9]) })].flatMap(table => table.batches);
        const numbered = appendRowNumbers(new arrow.Table(batches), '_rownum');
        expect(numbered.batches.length).toBe(2);
        expect(numbered.schema.fields.map(field => field.name)).toEqual(['s', '_rownum']);
        expect(numbered.schema.fields[1].nullable).toBe(false);
        expect(Array.from(numbered.getChild('_rownum')!.toArray() as BigInt64Array)).toEqual([1n, 2n, 3n]);
        expect(Array.from(numbered.getChild('s')!.toArray() as Int32Array)).toEqual([7, 8, 9]);
    });
});

describe('The handles of a runtime', () => {
    let runtime: TestRuntime | null = null;
    let database: HyperDB | null = null;
    afterEach(async () => {
        await runtime?.destroy();
        runtime = null;
        await database?.terminate();
        database = null;
    });

    it('are all released after a workbook with a run, a connection with queries and a computation went', async () => {
        database = await openTestHyperDB('handles_test');
        const rt = await createTestRuntime({ computeDatabase: database });
        runtime = rt;
        const handles = rt.handles;

        // A connection online with a channel whose statements finish without a result
        const stream: QueryExecutionResponseStream = {
            cancel: vi.fn(async () => { }),
            getMetrics: createQueryResponseStreamMetrics,
            getSchema: async () => null,
            produce: vi.fn<QueryExecutionResponseStream['produce']>(async () => { }),
        };
        const channel = { executeQuery: vi.fn(async () => stream), close: vi.fn() };
        const connectionId = 'handles-database';
        await rt.addConnection({
            connectionId,
            params: { hyper: { protocol: 'V3_GRPC', endpoint: 'http://hyper' } } as ConnectionParams,
            channel,
        });
        // A workbook of the runtime on the connection
        const workbook = rt.addWorkbook(connectionId, [['1_commands.sql', 'create table a (x int);']], { name: 'handles' });

        // A run of the workbook executes its statement on the connection, through the query executor of the runtime
        const run = await rt.runWorkbook(workbook.workbookId);
        expect(run.outcome.refused).toBeNull();
        expect(stream.produce).toHaveBeenCalled();
        expect(rt.store.get('run', workbook.workbookId)?.held).toBeNull();
        expect(rt.connection(connectionId).queriesFinishedOrdered.length).toBeGreaterThan(0);

        // A query that the host runs with a result and one that stays active
        const tracker = { runtime: rt, target: { connection: connectionId } };
        const metadata = { queryType: QueryType.USER_PROVIDED, title: null, description: null, issuer: null, userProvided: true };
        const result = new arrow.Table({ n: vectorFromArray([1, 2], new arrow.Int32()) });
        await executeTrackedQuery({ query: 'select 1', metadata, tracker, execute: async context => context.receivedAllBatches(result) });
        const active = new AbortController();
        const pending = executeTrackedQuery({ query: 'select 2', metadata, tracker, cancellation: active, execute: () => new Promise((_resolve, reject) => {
            active.signal.addEventListener('abort', () => reject(active.signal.reason));
        }) });
        rt.flush();
        const connection = rt.connection(connectionId);
        const finished = rt.store.get('query', connection.queriesFinishedOrdered.at(-1)!);
        expect(rt.table(finished?.resultTable?.id)).toBe(result);

        // A query of the shell
        rt.dispatch({ history: 'shell' }, { kind: 'createHistory', value: { limit: 100 } });
        await executeTrackedQuery({ query: 'select 3', metadata, tracker: { runtime: rt, target: { history: 'shell' } }, execute: async context => context.receivedAllBatches(result) });

        // A computation of a result, analyzed in the runtime
        const table = new arrow.Table({
            score: vectorFromArray([42, 10, 10, 30], new arrow.Float64()),
            name: vectorFromArray(['a', 'b', 'a', 'c'], new arrow.Utf8()),
        });
        await rt.analyzeTable(1, table, { connectionId });
        const computation = rt.store.get('computation', 1);
        expect(rt.table(computation?.tableAggregation?.table)?.numRows).toBe(1);

        // Everything goes: the computation, the history of the shell, the workbook, the connection, the runtime
        rt.dispatch({ computation: 1 }, { kind: 'deleteComputation' });
        rt.deleteWorkbook(workbook.workbookId);
        rt.dispatch({ history: 'shell' }, { kind: 'dropHistory' });
        rt.dispatch({ connection: connectionId }, { kind: 'deleteConnection' });
        rt.flush();
        expect(rt.store.get('computation', 1)).toBeNull();
        expect(channel.close).toHaveBeenCalledTimes(1);
        expect(active.signal.aborted).toBe(true);
        await expect(pending).rejects.toBeInstanceOf(DOMException);
        await rt.destroy();
        runtime = null;
        expect(handles.size).toBe(0);
    }, 60_000);
});
