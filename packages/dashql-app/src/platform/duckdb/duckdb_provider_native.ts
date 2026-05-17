import type { Logger } from '../logger/logger.js';
import { stringifyError } from '../logger/logger.js';

import { DuckDB } from './duckdb_api.js';
import { NativeDuckDB } from './duckdb_native_api.js';

export async function setupNativeDuckDB(context: string, logger: Logger): Promise<DuckDB> {
    const initStart = performance.now();
    try {
        logger.info("Creating native duckdb proxy client", { "context": context }, "webdb");
        const nativeDb = new NativeDuckDB();
        await nativeDb.open();
        const initEnd = performance.now();
        logger.info("Instantiated native duckdb", {
            "context": context,
            "duration": Math.floor(initEnd - initStart).toString()
        }, "webdb");
        return nativeDb;
    } catch (e: any) {
        const initEnd = performance.now();
        logger.error("Instantiating native duckdb failed", {
            "error": stringifyError(e),
            "duration": Math.floor(initEnd - initStart).toString()
        }, "webdb");
        console.error(e);
        throw e;
    }
}
