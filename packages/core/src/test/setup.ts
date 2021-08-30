import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import Worker from 'web-worker';
import path from 'path';
import { Analyzer } from '../analyzer/analyzer_node';
import { JMESPath } from '../jmespath/jmespath_node';

const ANALYZER_WASM = path.resolve(__dirname, '../../src/analyzer/analyzer_wasm.wasm');
const JMESPATH_WASM = path.resolve(__dirname, '../../src/jmespath/jmespath_wasm.wasm');
const DUCKDB_BUNDLES: duckdb.DuckDBBundles = {
    asyncDefault: {
        mainModule: path.resolve(__dirname, '../../../../node_modules/@dashql/duckdb/dist/duckdb.wasm'),
        mainWorker: path.resolve(__dirname, '../../../../node_modules/@dashql/duckdb/dist/duckdb-node-async.worker.js'),
    },
};

export let DATABASE: duckdb.AsyncDuckDB | null = null;
export let ANALYZER: Analyzer | null = null;
export let JMESPATH: JMESPath | null = null;

beforeAll(async () => {
    const config = await duckdb.selectBundle(DUCKDB_BUNDLES);
    const logger = new duckdb.VoidLogger();
    const worker = new Worker(config.mainWorker!);
    DATABASE = new duckdb.AsyncDuckDB(logger, worker);
    await DATABASE.instantiate(config.mainModule, config.pthreadWorker);

    ANALYZER = new Analyzer({}, ANALYZER_WASM);
    await ANALYZER.init();

    JMESPATH = new JMESPath(JMESPATH_WASM);
    await JMESPATH.init();
});

afterAll(async () => {
    await DATABASE.terminate();
    await DATABASE.reset();
    await ANALYZER.reset();
});
