import * as arrow from 'apache-arrow';
import { describe, expect, it, vi } from 'vitest';

import { AsyncConsumerLambdas } from '../../../../utils/async_consumer.js';
import type { EmbeddedConnection } from '../../../../platform/database/embedded_database.js';
import { QueryExecutionStatus } from '../query_execution_state.js';
import { EmbeddedDatabaseChannel } from './embedded_database_channel.js';

describe('EmbeddedDatabaseChannel', () => {
    it('adapts Arrow IPC results to the query response stream', async () => {
        const table = arrow.tableFromArrays({ value: [1, 2, 3] });
        const bytes = arrow.tableToIPC(table, 'stream');
        const connection: EmbeddedConnection = {
            close: vi.fn().mockResolvedValue(undefined),
            query: vi.fn(),
            queryArrowIPC: vi.fn().mockResolvedValue(bytes),
        };
        const channel = new EmbeddedDatabaseChannel(connection);
        const stream = await channel.executeQuery('select 1');
        const batches: arrow.RecordBatch[] = [];

        await stream.produce(new AsyncConsumerLambdas((_stream, batch) => batches.push(batch)), new AsyncConsumerLambdas());

        expect(connection.queryArrowIPC).toHaveBeenCalledWith('select 1', undefined);
        expect(stream.getStatus()).toBe(QueryExecutionStatus.SUCCEEDED);
        expect(stream.getMetrics().totalRowsReceived).toBe(3);
        expect(stream.getMetrics().totalBatchesReceived).toBe(table.batches.length);
        expect(new arrow.Table((await stream.getSchema())!, batches).numRows).toBe(3);
    });

    it('honors an already-aborted query and closes the logical connection', async () => {
        const connection: EmbeddedConnection = {
            close: vi.fn().mockResolvedValue(undefined),
            query: vi.fn(),
            queryArrowIPC: vi.fn(),
        };
        const channel = new EmbeddedDatabaseChannel(connection);
        const abort = new AbortController();
        abort.abort();

        await expect(channel.executeQuery('select 1', abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(connection.queryArrowIPC).not.toHaveBeenCalled();
        await channel.close();
        expect(connection.close).toHaveBeenCalledOnce();
    });

    it('forwards cancellation while a query is running', async () => {
        let signal: AbortSignal | undefined;
        const connection: EmbeddedConnection = {
            close: vi.fn().mockResolvedValue(undefined),
            query: vi.fn(),
            queryArrowIPC: vi.fn((_query, abort): Promise<Uint8Array> => {
                signal = abort;
                return new Promise<Uint8Array>((_resolve, reject) => {
                    abort?.addEventListener('abort', () => reject(abort.reason), { once: true });
                });
            }),
        };
        const channel = new EmbeddedDatabaseChannel(connection);
        const abort = new AbortController();
        const execution = channel.executeQuery('select slow()', abort.signal);

        abort.abort(new DOMException('cancelled', 'AbortError'));

        await expect(execution).rejects.toMatchObject({ name: 'AbortError' });
        expect(signal?.aborted).toBe(true);
    });
});
