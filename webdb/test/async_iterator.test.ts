import { beforeAll, afterAll, beforeEach, afterEach, describe, test, expect } from '@jest/globals';
import Worker from 'web-worker';
import * as webdb from '../src/index_async';
import * as path from 'path';
import { NodeBlobStream } from '../src/webdb_bindings_node';

let worker: Worker;
let db: webdb.AsyncWebDB;
var conn: webdb.AsyncWebDBConnection;
const logger = new webdb.ConsoleLogger();
const testRows = 3000;

beforeAll(async () => {
    worker = new Worker(path.resolve(__dirname, '../dist/webdb_node_async.worker.js'));
    db = new webdb.AsyncWebDB(logger, worker);
    await db.open(path.resolve(__dirname, '../src/webdb_wasm.wasm'));
});

afterAll(async () => {
    await db.terminate();
});

beforeEach(async () => {
    conn = await db.connect();
});

afterEach(async () => {
    await conn.disconnect();
});

describe('AsyncWebDB', () => {
    test('ping', async () => {
        await db.ping();
    });
});

describe('AsyncWebDB', () => {
    test('blob stream', async () => {
        await db.ingestBlobStream(NodeBlobStream.fromFile('./test/blob.txt'));
    });
});

describe('QueryResultRowIterator', () => {
    describe('single column', () => {
        test('TINYINT', async () => {
            let result = await conn.sendQuery(`
                SELECT (v & 127)::TINYINT FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            let i = 0;
            while (await chunks.nextAsync()) {
                chunks.iterateNumberColumn(0, (_row: number, v: number | null) => {
                    expect(v).toBe(i++ & 127);
                });
            }
            expect(i).toBe(testRows + 1);
        });
    });
});
