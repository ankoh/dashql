import * as duckdb from '@duckdb/duckdb-wasm';
import Worker from 'web-worker';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DUCKDB_WASM_BASE = path.resolve(__dirname, '../../../node_modules/@duckdb/duckdb-wasm/');
const DUCKDB_WASM_MODULE = path.resolve(DUCKDB_WASM_BASE, 'dist', 'duckdb-eh.wasm');
const DUCKDB_WORKER = path.resolve(DUCKDB_WASM_BASE, 'dist', 'duckdb-node-eh.worker.cjs');

export let DUCKDB_WASM: duckdb.AsyncDuckDB | null = null;

beforeAll(async () => {
    const logger = new duckdb.VoidLogger();
    const worker = new Worker(DUCKDB_WORKER);
    DUCKDB_WASM = new duckdb.AsyncDuckDB(logger, worker);
    await DUCKDB_WASM.instantiate(DUCKDB_WASM_MODULE);
});

afterAll(async () => {
    await DUCKDB_WASM.reset();
    await DUCKDB_WASM.terminate();
});
