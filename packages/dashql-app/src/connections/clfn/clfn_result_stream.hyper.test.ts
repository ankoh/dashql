import * as arrow from 'apache-arrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { analyzeTable } from '../../compute/analyze_table.js';
import { processTask } from '../../compute/computation_scheduler.js';
import { SCHEDULE_TASK, type ComputationAction } from '../../compute/computation_state.js';
import { HyperDB, HyperDBEngine, type HyperDBClient, type HyperDBConnection } from '../../platform/hyperdb/hyperdb_wasm.js';
import { TestLogger } from '../../platform/logger/test_logger.js';
import { getTestHyperDBClient, testDatabasePath } from '../../tests/hyperdb_test_client.js';
import { consumeQueryResponseStream } from '../query_execution.js';
import { ClientFunctionResultStream } from './clfn_result_stream.js';
import { runClientFunctionCall } from './clfn_runtime.js';
import type { ClientFunctionSpec } from './clfn_spec.js';

const logger = new TestLogger();

/// A function with a column of every type
const SPEC: ClientFunctionSpec = {
    format: 1,
    namespace: 't',
    hosts: { api: {} },
    functions: [{
        name: 'list', method: 'GET', host: 'api', path: '/items', rows: '/items',
        paging: { kind: 'url', from: { body: '/next' } },
        columns: [
            { name: 'text', type: 'VARCHAR' },
            { name: 'small', type: 'INTEGER' },
            { name: 'big', type: 'BIGINT' },
            { name: 'real', type: 'DOUBLE' },
            { name: 'flag', type: 'BOOLEAN' },
            { name: 'day', type: 'DATE' },
            { name: 'at', type: 'TIMESTAMPTZ' },
            { name: 'json', type: 'JSON' },
        ],
    }],
};

/// The table that the query executor gets for a response
async function resultOf(items: unknown[]): Promise<arrow.Table> {
    const result = await runClientFunctionCall(SPEC, { namespace: 't', function: 'list', effect: 'read', explain: false, options: {} }, {
        http: { fetch: async () => new Response(JSON.stringify({ items, total: items.length })) },
        resolveHost: async () => ({ baseUrl: new URL('https://svc.example.com'), headers: {} }),
    });
    const table = await consumeQueryResponseStream({
        stream: new ClientFunctionResultStream(logger, result), publishResults: true, onProgress: () => {},
    });
    return table!;
}

describe('The result of a client function call', () => {
    let client: HyperDBClient;
    let sharedClient = false;
    let database: HyperDB;
    let connection: HyperDBConnection;

    beforeAll(async () => {
        ({ client, shared: sharedClient } = await getTestHyperDBClient());
        const id = crypto.randomUUID();
        database = await HyperDB.create(new HyperDBEngine(client), {
            computeDatabasePath: await testDatabasePath(`dashql-clfn-compute-${id}.hyper`),
            defaultDatabasePath: await testDatabasePath(`dashql-clfn-${id}.hyper`),
            terminateEngine: false,
        });
        connection = await database.connect();
    }, 60_000);
    afterAll(async () => {
        await connection?.close();
        await database?.terminate();
        if (!sharedClient) await client?.terminate();
    });

    // Like the query executor, every result is analyzed in the compute database
    it.each([
        ['with rows', [
            { text: 'a', small: 1, big: '9007199254740993', real: 1.5, flag: true, day: '2026-01-02', at: '2026-01-02T03:04:05.000Z', json: { a: 1 }, extra: 'x' },
            { text: null, small: 'no number', big: null, real: null, flag: null, day: null, at: null, json: null },
        ]],
        ['without rows', []],
    ])('can be analyzed in Hyper %s', async (_name, items) => {
        const table = await resultOf(items);
        expect(table.numRows).toBe(items.length);
        expect(table.schema.fields.map(field => field.name)).toEqual(['text', 'small', 'big', 'real', 'flag', 'day', 'at', 'json', '_status', '_next', '_meta', '_raw']);
        let nextTaskId = 1;
        const dispatch = (action: ComputationAction) => {
            if (action.type === SCHEDULE_TASK) void processTask({ ...action.value, taskId: nextTaskId++ }, dispatch, logger);
        };
        await analyzeTable(1, table, dispatch, database, logger);
    }, 60_000);
});
