import * as duckdb from '@duckdb/duckdb-wasm';
import Worker from 'web-worker';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DUCKDB_WASM_BASE = path.resolve(__dirname, '../../../node_modules/@duckdb/duckdb-wasm/');
const DUCKDB_WASM = path.resolve(DUCKDB_WASM_BASE, 'dist', 'duckdb-eh.wasm');
const DUCKDB_WORKER = path.resolve(DUCKDB_WASM_BASE, 'dist', 'duckdb-node-eh.worker.cjs');

export let DATABASE: duckdb.AsyncDuckDB | null = null;

beforeAll(async () => {
    const logger = new duckdb.VoidLogger();
    const worker = new Worker(DUCKDB_WORKER);
    DATABASE = new duckdb.AsyncDuckDB(logger, worker);
    await DATABASE.instantiate(DUCKDB_WASM);
});

afterAll(async () => {
    await DATABASE.reset();
    await DATABASE.terminate();
});
