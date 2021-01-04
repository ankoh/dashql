import * as webdb from '../dist/webdb_node_async';
import * as path from 'path';

let worker: Worker;

beforeAll(() => {
    worker = webdb.spawnWorker(path.resolve(__dirname, "../dist/webdb_node_async.worker.js"));
});

afterAll(() => {
    worker.terminate();
});

beforeEach(() => {
});

afterEach(() => {
});

describe('AsyncWebDB', () => {
    test('ping', async () => {
        const db = new webdb.AsyncWebDB(worker);
        await db.ping();
    });
});
