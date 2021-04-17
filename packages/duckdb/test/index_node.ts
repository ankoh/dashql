import * as duckdb_serial from '../src/targets/duckdb-node-serial';
import * as duckdb_parallel from '../src/targets/duckdb-node-parallel';
import path from 'path';
import Worker from 'web-worker';
import fs from 'fs';

// Loading debug symbols, especially for WASM take insanely long so we just disable the test timeout
// jasmine.DEFAULT_TIMEOUT_INTERVAL = 1000;

// Resolve a buffer by fetching from disk
const dataDir = path.resolve(__dirname, '../../../');
const resolveBuffer = async (url: string) => {
    const p = path.join(dataDir, url);
    if (!fs.existsSync(p)) return null;
    return new Uint8Array(fs.readFileSync(p));
};

// Test environment
let db: duckdb_serial.DuckDB | null = null;
let adb: duckdb_parallel.AsyncDuckDB | null = null;
let worker: Worker | null = null;

beforeAll(async () => {
    const logger = new duckdb_serial.VoidLogger();
    db = new duckdb_serial.DuckDB(logger, duckdb_serial.NodeRuntime, path.resolve(__dirname, './duckdb.wasm'));
    await db.open();

    worker = new Worker(path.resolve(__dirname, './duckdb-node-parallel.worker.js'));
    adb = new duckdb_parallel.AsyncDuckDB(logger, worker);
    await adb.open(path.resolve(__dirname, './duckdb.wasm'));
});

import { testBindings } from './bindings.test';
import { testBatchStream } from './batch_stream.test';
import { testFilesystem } from './filesystem.test';
import { testAsyncBatchStream } from './batch_stream_async.test';
import { testZip } from './zip.test';

testBindings(() => db!);
testBatchStream(() => db!);
testAsyncBatchStream(() => adb!);
testFilesystem(() => adb!, resolveBuffer);
testZip(() => db!, resolveBuffer);
