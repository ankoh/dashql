import type { Logger } from '../logger/logger.js';
import { stringifyError } from '../logger/logger.js';

import { DuckDB } from './duckdb_api.js';
import { NativeDuckDB } from './duckdb_native_api.js';

export async function setupNativeDuckDB(context: string, logger: Logger): Promise<DuckDB> {
    const initStart = performance.now();
    try {
        logger.info("Creating native DuckDB proxy client", { "context": context }, "duckdb");
        const nativeDb = new NativeDuckDB();
        await nativeDb.open();
        const initEnd = performance.now();
        logger.info("Instantiated native DuckDB", {
            "context": context,
            "duration": Math.floor(initEnd - initStart).toString()
        }, "duckdb");
        return nativeDb;
    } catch (e: any) {
        const initEnd = performance.now();
        logger.error("Instantiating native DuckDB failed", {
            "error": stringifyError(e),
            "duration": Math.floor(initEnd - initStart).toString()
        }, "duckdb");
        throw e;
    }
}
