import * as React from 'react';

import { DuckDB } from './duckdb_api.js';
import { useLogger } from '../platform/logger_provider.js';

// eslint-disable-next-line import/no-unresolved -- resolved by bundler
import webdbWasmUrl from '@dashql/duckdb-wasm?url';
const WEBDB_WASM_URL = typeof webdbWasmUrl === 'string' ? webdbWasmUrl : new URL(webdbWasmUrl as string, import.meta.url).href;

const SETUP_CTX = React.createContext<((context: string) => Promise<DuckDB>) | null>(null);

interface Props {
    children: React.ReactElement;
}

export const DuckDBProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const instantiation = React.useRef<Promise<DuckDB> | null>(null);

    const setup = React.useCallback(async (context: string): Promise<DuckDB> => {
        if (instantiation.current != null) {
            return await instantiation.current;
        }

        const instantiate = async (): Promise<DuckDB> => {
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
                const webdb = new DuckDB(worker);

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
        };

        instantiation.current = instantiate();
        return await instantiation.current;
    }, [logger]);

    return (
        <SETUP_CTX.Provider value={setup}>
            {props.children}
        </SETUP_CTX.Provider>
    );
};

export type DuckDBSetupFn = (context: string) => Promise<DuckDB>;
export function useDuckDBSetup(): DuckDBSetupFn {
    return React.useContext(SETUP_CTX)!;
}
