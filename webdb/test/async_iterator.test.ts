import * as webdb from '../dist/webdb_node_async';
import * as path from 'path';

let worker: Worker;
let db: webdb.AsyncWebDB;

beforeAll(() => {
    worker = webdb.spawnWorker(path.resolve(__dirname, "../dist/webdb_node_async.worker.js"));
    db = new webdb.AsyncWebDB(worker);
});

afterAll(async () => {
    await db.terminate();
});

describe('AsyncWebDB', () => {
    test('ping', async () => {
        await db.ping();
    });
});
