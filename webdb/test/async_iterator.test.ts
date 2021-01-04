import * as webdb from '../dist/webdb_node_async';
import * as path from 'path';

let worker: Worker;
let db: webdb.AsyncWebDB;
var conn: webdb.AsyncWebDBConnection;
const testRows = 3000;

beforeAll(async () => {
    worker = webdb.spawnWorker(path.resolve(__dirname, "../dist/webdb_node_async.worker.js"));
    db = new webdb.AsyncWebDB(worker);
    await db.open(path.resolve(__dirname, "../src/webdb_wasm.wasm"));
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

describe('QueryResultRowIterator', () => {
    describe('single column', () => {
        test('TINYINT', async () => {
            let result = await conn.sendQuery(`
                SELECT (v & 127)::TINYINT FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            let iter = await webdb.QueryResultRowIterator.iterate(chunks);
            let value = new webdb.Value();
            for (let i = 0; i <= testRows; ++i) {
                expect(iter.isEnd()).toBe(false);
                expect(iter.getValue(0, value).i8).toBe(i & 127);
                await iter.next();
            }
            expect(iter.isEnd()).toBe(true);
        });
    });
});
