import * as duckdb_serial from '../src/targets/duckdb-node-serial';
import * as duckdb_parallel from '../src/targets/duckdb-node-parallel';
import path from 'path';
import Worker from 'web-worker';
import * as tmp from 'temp-write';

let db: duckdb_serial.DuckDB | null = null;
let adb: duckdb_parallel.AsyncDuckDB | null = null;
let worker: Worker | null = null;

beforeAll(async () => {
    const logger = new duckdb_serial.VoidLogger();
    db = new duckdb_serial.DuckDB(logger, duckdb_serial.DefaultDuckDBRuntime, path.resolve(__dirname, './duckdb.wasm'));
    await db.open();

    worker = new Worker(path.resolve(__dirname, './duckdb-node-parallel.worker.js'));
    adb = new duckdb_parallel.AsyncDuckDB(logger, worker);
    await adb.open(path.resolve(__dirname, './duckdb.wasm'));
});

afterAll(() => {});

import { testBindings } from './bindings.test';
import { testBatchStream } from './batch_stream.test';
import { testFilesystem } from './filesystem.test';
import { testAsyncBatchStream } from './batch_stream_async.test';
import { testExtractCSV } from './extract_csv.test';
import { testZip } from './zip.test';

// Loading debug symbols, especially for WASM take insanely long so we just disable the test timeout
jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;

testBindings(() => db!);
testBatchStream(() => db!);
testAsyncBatchStream(() => adb!);
testFilesystem(() => adb!, path.resolve(__dirname, '../../../data/uni/out'));
testZip(() => db!, '/data');
testExtractCSV(
    () => adb!,
    (buf: Uint8Array) => tmp.sync(Buffer.from(buf)),
);
