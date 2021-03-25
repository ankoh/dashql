import * as webdb_serial from '../../src/targets/webdb-node-serial';
import * as webdb_parallel from '../../src/targets/webdb-node-parallel';
import path from 'path';
import Worker from 'web-worker';
import * as tmp from 'temp-write';

let db: webdb_serial.WebDB | null = null;
let adb: webdb_parallel.AsyncWebDB | null = null;
let worker: Worker | null = null;

beforeAll(async () => {
    db = new webdb_serial.WebDB(
        new webdb_serial.ConsoleLogger(),
        webdb_serial.DefaultWebDBRuntime,
        path.resolve(__dirname, './webdb.wasm'),
    );
    await db.open();

    worker = new Worker(path.resolve(__dirname, './webdb-node-parallel.worker.js'));
    adb = new webdb_parallel.AsyncWebDB(new webdb_parallel.ConsoleLogger(), worker);
    await adb.open(path.resolve(__dirname, './webdb.wasm'));
});

afterAll(() => {});

import { testProxies } from './proxy.test';
import { testBindings } from './bindings.test';
import { testIterator } from './iterator.test';
import { testAsyncIterator } from './async_iterator.test';
import { testExtractCSV } from './extract_csv.test';

testProxies(() => db!);
testBindings(() => db!);
testIterator(() => db!);
testAsyncIterator(() => adb!, path.resolve(__dirname, '../../../data/uni/out'));
testExtractCSV(
    () => adb!,
    (buf: Uint8Array) => tmp.sync(Buffer.from(buf)),
);
