import * as duckdb from '@duckdb/duckdb-wasm';
import Worker from 'web-worker';
import path from 'path';
import { Analyzer } from '../analyzer/analyzer_node';
import { JMESPath } from '../jmespath/jmespath_node';

const ANALYZER_WASM = path.resolve(__dirname, '../../src/analyzer/analyzer_wasm.wasm');
const JMESPATH_WASM = path.resolve(__dirname, '../../src/jmespath/jmespath_wasm.wasm');
const DUCKDB_WASM = path.resolve(__dirname, '../../../../node_modules/@duckdb/duckdb-wasm/dist/duckdb-eh.wasm');
const DUCKDB_WORKER = path.resolve(
    __dirname,
    '../../../../node_modules/@duckdb/duckdb-wasm/dist/duckdb-node-eh.worker.cjs',
);

export let DATABASE: duckdb.AsyncDuckDB | null = null;
export let ANALYZER: Analyzer | null = null;
export let JMESPATH: JMESPath | null = null;

beforeAll(async () => {
    const logger = new duckdb.VoidLogger();
    const worker = new Worker(DUCKDB_WORKER);
    DATABASE = new duckdb.AsyncDuckDB(logger, worker);
    await DATABASE.instantiate(DUCKDB_WASM);

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
