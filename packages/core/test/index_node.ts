import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import { Analyzer, JMESPath } from '../src/index_node';
import Worker from 'web-worker';
import path from 'path';

// Loading debug symbols, especially for WASM take insanely long so we just disable the test timeout
jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

const ANALYZER_WASM = path.resolve(__dirname, '../src/analyzer/analyzer_wasm.wasm');
const JMESPATH_WASM = path.resolve(__dirname, '../src/jmespath/jmespath_wasm.wasm');
const DUCKDB_BUNDLES: duckdb.DuckDBBundles = {
    asyncDefault: {
        mainModule: path.resolve(__dirname, '../../../node_modules/@dashql/duckdb/dist/duckdb.wasm'),
        mainWorker: path.resolve(__dirname, '../../../node_modules/@dashql/duckdb/dist/duckdb-node-async.worker.js'),
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
import { testActionScheduler } from './action_scheduler.test';
import { testActionGraph } from './action_graph.test';
import { testHTTPManager } from './http_manager.test';
import { testNativeMinHeap } from './native_min_heap.test';
import { testVizComposer } from './viz_composer.test';
import { testJMESPath } from './jmespath.test';
import { testProgramEditor } from './program_editor.test';
import { testSyntaxSchema } from './syntax_schema.test';
import { testSemaphore } from './semaphore.test';

testDuckDB(() => db!);
testActionScheduler(
    () => db!,
    () => az!,
    () => jp!,
);
testActionGraph(() => az!);
testHTTPManager();
testNativeMinHeap();
testVizComposer(() => az!);
testJMESPath(() => jp!);
testProgramEditor(() => az!);
testSyntaxSchema(() => az!);
testSemaphore();