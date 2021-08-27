import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import Worker from 'web-worker';
import path from 'path';
import { Analyzer } from '../analyzer/analyzer_node';
import { JMESPath } from '../jmespath/jmespath_node';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_WASM = path.resolve(__dirname, '../../src/analyzer/analyzer_wasm.wasm');
const JMESPATH_WASM = path.resolve(__dirname, '../../src/jmespath/jmespath_wasm.wasm');
const DUCKDB_BUNDLES: duckdb.DuckDBBundles = {
    asyncDefault: {
        mainModule: path.resolve(__dirname, '../../../../node_modules/@dashql/duckdb/dist/duckdb.wasm'),
        mainWorker: path.resolve(__dirname, '../../../../node_modules/@dashql/duckdb/dist/duckdb-node-async.worker.js'),
    },
};

export async function initDuckDB(): Promise<duckdb.AsyncDuckDB> {
    const config = await duckdb.configure(DUCKDB_BUNDLES);
    const logger = new duckdb.VoidLogger();
    const worker = new Worker(config.mainWorker!);
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(config.mainModule, config.pthreadWorker);
    return db;
}

export async function initAnalyzer(): Promise<Analyzer> {
    const az = new Analyzer({}, ANALYZER_WASM);
    await az.init();
    return az;
}

export async function initJMESPath(): Promise<JMESPath> {
    const jp = new JMESPath(JMESPATH_WASM);
    await jp.init();
    return jp;
}
