import { beforeAll, afterAll, beforeEach, afterEach, describe, test, expect, jest } from '@jest/globals';
import Worker from 'web-worker';
import * as webdb from '../src/index_async';
import * as path from 'path';

let worker: Worker;
let db: webdb.AsyncWebDB;
const logger = new webdb.ConsoleLogger();

beforeAll(async () => {
    worker = new Worker(path.resolve(__dirname, '../dist/webdb_node_async.worker.js'));
    db = new webdb.AsyncWebDB(logger, worker);
    await db.open(path.resolve(__dirname, '../src/webdb_wasm.wasm'));
});

afterAll(async () => {
    await db.terminate();
});

describe('FileSystem', () => {
    test('SimpleRead', async () => {
        jest.setTimeout(30000);
        await db.fsTest();
    });
});
