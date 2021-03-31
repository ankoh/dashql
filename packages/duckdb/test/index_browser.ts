import * as duckdb_serial from '../src/targets/duckdb-browser-serial';
import * as duckdb_parallel from '../src/targets/duckdb-browser-parallel';

let db: duckdb_serial.DuckDB | null = null;
let adb: duckdb_parallel.AsyncDuckDB | null = null;
let worker: Worker | null = null;

beforeAll(async () => {
    const logger = new duckdb_serial.ConsoleLogger();
    db = new duckdb_serial.DuckDB(logger, duckdb_serial.DefaultDuckDBRuntime, '/static/duckdb.wasm');
    await db.open();

    worker = new Worker('/static/duckdb-browser-parallel.worker.js');
    adb = new duckdb_parallel.AsyncDuckDB(logger, worker);
    await adb.open('/static/duckdb.wasm');
});

import { testProxies } from './proxy.test';
import { testBindings } from './bindings.test';
import { testIterator } from './iterator.test';
import { testAsyncIterator } from './async_iterator.test';
import { testFilesystem } from './filesystem.test';
import { testExtractCSV } from './extract_csv.test';

// Loading debug symbols, especially for WASM take insanely long so we just disable the test timeout
jasmine.DEFAULT_TIMEOUT_INTERVAL = 999999999;

testProxies(() => db!);
testBindings(() => db!);
testIterator(() => db!);
testAsyncIterator(() => adb!);
testFilesystem(() => adb!, '/data');
testExtractCSV(
    () => adb!,
    (buf: Uint8Array) => URL.createObjectURL(new Blob([buf.buffer], { type: 'text/plain' })),
);
