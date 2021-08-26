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
let DUCKDB_CONFIG: duckdb.DuckDBConfig | null = null;

let GLOBAL_DB: duckdb.AsyncDuckDB | null = null;
let GLOBAL_DB_PROMISE: Promise<duckdb.AsyncDuckDB> | null = null;
let GLOBAL_AZ: Analyzer | null = null;
let GLOBAL_AZ_PROMISE: Promise<Analyzer> | null = null;
let GLOBAL_JP: JMESPath | null = null;
let GLOBAL_JP_PROMISE: Promise<JMESPath> | null = null;

export async function initDuckDB(): Promise<duckdb.AsyncDuckDB> {
    if (GLOBAL_DB != null) return null;
    if (GLOBAL_DB_PROMISE != null) return await GLOBAL_DB_PROMISE;
    DUCKDB_CONFIG = await duckdb.configure(DUCKDB_BUNDLES);
    GLOBAL_DB_PROMISE = (async () => {
        const logger = new duckdb.VoidLogger();
        const worker = new Worker(DUCKDB_CONFIG.mainWorker!);
        const db = new duckdb.AsyncDuckDB(logger, worker);
        await db.instantiate(DUCKDB_CONFIG.mainModule, DUCKDB_CONFIG.pthreadWorker);
        GLOBAL_DB = db;
        return db;
    })();
    return await GLOBAL_DB_PROMISE;
}

export async function initAnalyzer(): Promise<Analyzer> {
    if (GLOBAL_AZ != null) return null;
    if (GLOBAL_AZ_PROMISE != null) return await GLOBAL_AZ_PROMISE;
    GLOBAL_AZ_PROMISE = (async () => {
        const az = new Analyzer({}, ANALYZER_WASM);
        await az.init();
        GLOBAL_AZ = az;
        return az;
    })();
    return await GLOBAL_AZ_PROMISE;
}

export async function initJMESPath(): Promise<JMESPath> {
    if (GLOBAL_JP != null) return null;
    if (GLOBAL_JP_PROMISE != null) return await GLOBAL_JP_PROMISE;
    GLOBAL_JP_PROMISE = (async () => {
        const jp = new JMESPath(JMESPATH_WASM);
        await jp.init();
        GLOBAL_JP = jp;
        return jp;
    })();
    return await GLOBAL_JP_PROMISE;
}
