import * as webdb_serial from '../../src/targets/webdb-browser-serial';
import * as webdb_parallel from '../../src/targets/webdb-browser-parallel';

let db: webdb_serial.WebDB | null = null;
let adb: webdb_parallel.AsyncWebDB | null = null;
let worker: Worker | null = null;

beforeAll(async () => {
    const logger = new webdb_serial.ConsoleLogger();
    db = new webdb_serial.WebDB(logger, webdb_serial.DefaultWebDBRuntime, '/static/webdb.wasm');
    await db.open();

    worker = new Worker('/static/webdb-browser-parallel.worker.js');
    adb = new webdb_parallel.AsyncWebDB(logger, worker);
    await adb.open('/static/webdb.wasm');
});

import { testProxies } from './proxy.test';
import { testBindings } from './bindings.test';
import { testIterator } from './iterator.test';
import { testAsyncIterator } from './async_iterator.test';
import { testExtractCSV } from './extract_csv.test';

testProxies(() => db!);
testBindings(() => db!);
testIterator(() => db!);
testAsyncIterator(() => adb!, '/data');
testExtractCSV(
    () => adb!,
    (buf: Uint8Array) => URL.createObjectURL(new Blob([buf.buffer], { type: 'text/plain' })),
);
