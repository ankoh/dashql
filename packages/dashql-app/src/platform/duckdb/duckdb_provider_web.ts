import type { Logger } from '../logger/logger.js';

import { DuckDB } from './duckdb_api.js';
import { WebDuckDB } from './duckdb_web_api.js';

// eslint-disable-next-line import/no-unresolved -- resolved by bundler
import webdbWasmUrl from '@dashql/duckdb-wasm?url';

const WEBDB_WASM_URL = typeof webdbWasmUrl === 'string' ? webdbWasmUrl : new URL(webdbWasmUrl as string, import.meta.url).href;

export async function setupWebDuckDB(context: string, logger: Logger): Promise<DuckDB> {
    const initStart = performance.now();
    try {
        // Check for multi-threading support
        const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
        const isCrossOriginIsolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;

        if (hasSharedArrayBuffer && isCrossOriginIsolated) {
            logger.info("multi-threading enabled", {
                "context": context,
                "SharedArrayBuffer": "available",
                "crossOriginIsolated": "true"
            }, "webdb");
        } else {
            logger.warn("multi-threading disabled - running single-threaded", {
                "context": context,
                "SharedArrayBuffer": hasSharedArrayBuffer ? "available" : "unavailable",
                "crossOriginIsolated": isCrossOriginIsolated ? "true" : "false",
                "reason": !hasSharedArrayBuffer ? "SharedArrayBuffer not available" : "missing COOP/COEP headers"
            }, "webdb");
        }

        logger.info("creating webdb worker", { "context": context }, "webdb");
        const worker = new Worker(new URL('./duckdb_worker_init.js', import.meta.url), { type: 'module' });
        const webdb = new WebDuckDB(worker);

        await webdb.ping();
        await webdb.instantiate(WEBDB_WASM_URL);
        await webdb.open();

        const initEnd = performance.now();
        logger.info("instantiated webdb", {
            "context": context,
            "duration": Math.floor(initEnd - initStart).toString()
        }, "webdb");

        return webdb;
    } catch (e: any) {
        const initEnd = performance.now();
        logger.error("instantiating webdb failed", {
            "error": e.toString(),
            "duration": Math.floor(initEnd - initStart).toString()
        }, "webdb");
        console.error(e);
        throw e;
    }
}
