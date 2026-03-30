import * as React from 'react';

import { WebDB } from './api.js';
import { useLogger } from '../platform/logger_provider.js';

// eslint-disable-next-line import/no-unresolved -- resolved by bundler
import webdbWasmUrl from '@dashql/webdb-wasm?url';
const WEBDB_WASM_URL = typeof webdbWasmUrl === 'string' ? webdbWasmUrl : new URL(webdbWasmUrl as string, import.meta.url).href;

const SETUP_CTX = React.createContext<((context: string) => Promise<WebDB>) | null>(null);

interface Props {
    children: React.ReactElement;
}

export const WebDBProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const instantiation = React.useRef<Promise<WebDB> | null>(null);

    const setup = React.useCallback(async (context: string): Promise<WebDB> => {
        if (instantiation.current != null) {
            return await instantiation.current;
        }

        const instantiate = async (): Promise<WebDB> => {
            const initStart = performance.now();
            try {
                logger.info("creating webdb worker", { "context": context }, "webdb");
                const worker = new Worker(new URL('./webdb_worker_init.js', import.meta.url), { type: 'module' });
                const webdb = new WebDB(worker);

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

export type WebDBSetupFn = (context: string) => Promise<WebDB>;
export function useWebDBSetup(): WebDBSetupFn {
    return React.useContext(SETUP_CTX)!;
}
