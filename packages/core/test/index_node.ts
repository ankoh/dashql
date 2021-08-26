import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import { Analyzer, JMESPath } from '../src/index_node';
import Worker from 'web-worker';
import path from 'path';

// Loading debug symbols, especially for WASM take insanely long so we just disable the test timeout
jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

const ANALYZER_WASM = path.resolve(__dirname, '../../src/analyzer/analyzer_wasm.wasm');
const JMESPATH_WASM = path.resolve(__dirname, '../../src/jmespath/jmespath_wasm.wasm');
const DUCKDB_BUNDLES: duckdb.DuckDBBundles = {
    asyncDefault: {
        mainModule: path.resolve(__dirname, '../../../../node_modules/@dashql/duckdb/dist/duckdb.wasm'),
        mainWorker: path.resolve(__dirname, '../../../../node_modules/@dashql/duckdb/dist/duckdb-node-async.worker.js'),
    },
};
let DUCKDB_CONFIG: duckdb.DuckDBConfig | null = null;

// Test environment
let db: duckdb.AsyncDuckDB | null = null;
let dbWorker: Worker | null = null;
let az: Analyzer | null = null;
let jp: JMESPath | null = null;

beforeAll(async () => {
    // Setup the database
    DUCKDB_CONFIG = await duckdb.configure(DUCKDB_BUNDLES);
    const logger = new duckdb.VoidLogger();
    dbWorker = new Worker(DUCKDB_CONFIG.mainWorker!);
    db = new duckdb.AsyncDuckDB(logger, dbWorker);
    await db.instantiate(DUCKDB_CONFIG.mainModule, DUCKDB_CONFIG.pthreadWorker);

    // Setup the analyzer module
    az = new Analyzer({}, ANALYZER_WASM);
    await az.init();

    // Setup the jmespath module
    jp = new JMESPath(JMESPATH_WASM);
    await jp.init();
});

afterAll(async () => {
    if (dbWorker) dbWorker.terminate();
});

import { testDuckDB } from './duckdb.test';
import { testTaskLogic } from './task_logic_tester';
import { testTaskGraph } from './task_graph.test';
import { testHTTPClient } from './http_client.test';
import { testNativeMinHeap } from './native_min_heap.test';
import { testVegaComposer } from './vega_composer.test';
import { testJMESPath } from './jmespath.test';
import { testProgramEditor } from './program_editor.test';
import { testSemaphore } from './semaphore.test';
import { testRowProxies } from './row_proxies.test';

testDuckDB(() => db!);
testTaskLogic(
    () => db!,
    () => az!,
    () => jp!,
);
testTaskGraph(() => az!);
testHTTPClient();
testNativeMinHeap();
testVegaComposer(() => az!);
testJMESPath(() => jp!);
testProgramEditor(() => az!);
testSemaphore();
testRowProxies(() => db!);
