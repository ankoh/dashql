import * as duckdb_serial from '../src/targets/duckdb-node-serial';
import * as duckdb_parallel from '../src/targets/duckdb-node-parallel';
import path from 'path';
import Worker from 'web-worker';
import * as tmp from 'temp-write';

let db: duckdb_serial.DuckDB | null = null;
let adb: duckdb_parallel.AsyncDuckDB | null = null;
let worker: Worker | null = null;

beforeAll(async () => {
    db = new duckdb_serial.DuckDB(
        new duckdb_serial.ConsoleLogger(),
        duckdb_serial.DefaultDuckDBRuntime,
        path.resolve(__dirname, './duckdb.wasm'),
    );
    await db.open();

    worker = new Worker(path.resolve(__dirname, './duckdb-node-parallel.worker.js'));
    adb = new duckdb_parallel.AsyncDuckDB(new duckdb_parallel.ConsoleLogger(), worker);
    await adb.open(path.resolve(__dirname, './duckdb.wasm'));
});

import { testProxies } from './proxy.test';
import { testBindings } from './bindings.test';
import { testIterator } from './iterator.test';
import { testFilesystem } from './filesystem.test';
import { testAsyncIterator } from './async_iterator.test';
import { testImportData } from './import_data.test';

// Loading debug symbols, especially for WASM take insanely long so we just disable the test timeout
jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;

// testProxies(() => db!);
// testBindings(() => db!);
// testIterator(() => db!);
// testAsyncIterator(() => adb!);
// testFilesystem(() => adb!, path.resolve(__dirname, '../../../data/uni/out'));
testImportData(
    () => adb!,
    (buf: Uint8Array) => tmp.sync(Buffer.from(buf)),
    path.resolve(__dirname, '../../../data/uni/out'),
);
