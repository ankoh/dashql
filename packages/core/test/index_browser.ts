import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import { Analyzer, JMESPath } from '../src/index_browser';

const JMESPATH_WASM = '/static/jmespath_wasm.wasm';
const ANALYZER_WASM = '/static/analyzer_wasm.wasm';
const DUCKDB_BUNDLES: duckdb.DuckDBBundles = {
    asyncDefault: {
        mainModule: '/static/duckdb/duckdb.wasm',
        mainWorker: '/static/duckdb/duckdb-browser-async.worker.js',
    },
    asyncNext: {
        mainModule: '/static/duckdb/duckdb-next.wasm',
        mainWorker: '/static/duckdb/duckdb-browser-async-next.worker.js',
    },
    asyncNextCOI: {
        mainModule: '/static/duckdb/duckdb-next-coi.wasm',
        mainWorker: '/static/duckdb/duckdb-browser-async-next-coi.worker.js',
        pthreadWorker: '/static/duckdb/duckdb-browser-async-next-coi.pthread.worker.js',
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