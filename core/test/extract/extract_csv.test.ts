import { beforeAll, afterAll, beforeEach, afterEach, describe, test, expect } from '@jest/globals';
import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as path from 'path';
import Worker from 'web-worker';
import { NodeBlobStream } from '@dashql/webdb/src/webdb_bindings_node';

const logger = new webdb.ConsoleLogger();
const encoder = new TextEncoder();

let worker: Worker;
let db: webdb.AsyncWebDB;
let conn: webdb.AsyncWebDBConnection;

beforeAll(async () => {
    worker = new Worker(path.resolve(__dirname, '../../../webdb/dist/webdb_node_async.worker.js'));
    db = new webdb.AsyncWebDB(logger, worker);
    await db.open(path.resolve(__dirname, '../../../webdb/dist/webdb.wasm'));
});

beforeEach(async () => {
    conn = await db.connect();
});

afterEach(async () => {
    await conn.disconnect();
    await db.reset();
});

afterAll(async () => {
    await db.terminate();
    worker.terminate();
});

describe('Extract CSV', () => {
    test('SimpleColumns', async () => {
        await conn.importCSV(
            new NodeBlobStream(
                encoder.encode(`1,2,3
4,5,6
7,8,9`),
            ),
            'test_schema',
            'test_table',
        );
    });
});
