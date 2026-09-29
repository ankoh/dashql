import type { Logger } from '../logger/logger.js';
import { stringifyError } from '../logger/logger.js';
import type { SetupProgress } from '../database/embedded_database_provider.js';

import { HyperDB, type HyperDBEngineClient } from './hyperdb_wasm.js';
import { HYPERDB_WASM_ENGINE_SETTINGS } from './hyperdb_settings.js';

declare global {
    var __DASHQL_TEST_HYPERDB_CLIENT__: ((
        onSetupProgress?: (progress: SetupProgress) => void,
    ) => Promise<HyperDBEngineClient>) | undefined;
    var __DASHQL_TEST_HYPERDB_CLIENT_PROMISE__: Promise<HyperDBEngineClient> | undefined;
    var __DASHQL_TEST_HYPERDB_CLIENT_CREATIONS__: number | undefined;
    var __DASHQL_TEST_HYPERDB_UNLOAD_INSTALLED__: boolean | undefined;
    var __DASHQL_TEST_HYPERDB_FACTORY__: ((
        context: string,
        logger: Logger,
        onSetupProgress?: (progress: SetupProgress) => void,
    ) => Promise<HyperDB>) | undefined;
}

// eslint-disable-next-line import/no-unresolved -- package asset resolved by Vite
import engineUrl from '@dashql/hyperdb-wasm-js?url';
// eslint-disable-next-line import/no-unresolved -- package asset resolved by Vite
import workerUrl from '@dashql/hyperdb-wasm-worker?url';
// eslint-disable-next-line import/no-unresolved -- package asset resolved by Bazel/Vite alias
import wasmUrl from '@dashql/hyperdb-wasm?url';

const HYPERDB_ENGINE_URL = new URL(engineUrl as string, import.meta.url);
const HYPERDB_WORKER_URL = new URL(workerUrl as string, import.meta.url);
const HYPERDB_WASM_URL = new URL(wasmUrl as string, import.meta.url);

function createEngineScript(): { url: string; revoke: () => void } {
    const source = `self.HYPERDB_WASM_MODULE=self.Module??{};self.HYPERDB_WASM_MODULE.locateFile=(path,prefix)=>path==='hyperdb-wasm.wasm'?${JSON.stringify(HYPERDB_WASM_URL.href)}:prefix+path;importScripts(${JSON.stringify(HYPERDB_ENGINE_URL.href)});`;
    const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    return { url, revoke: () => URL.revokeObjectURL(url) };
}

export async function createWebHyperDBClient(
    onSetupProgress?: (progress: SetupProgress) => void,
): Promise<HyperDBEngineClient> {
    const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
    const isCrossOriginIsolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
    if (!hasSharedArrayBuffer || !isCrossOriginIsolated) {
        throw new Error('HyperDB requires SharedArrayBuffer and a cross-origin-isolated page');
    }

    const { createBrowserClient } = await import('hyperdb-wasm/raw');
    const engineScript = createEngineScript();
    let client: HyperDBEngineClient;
    try {
        client = createBrowserClient({
            engineUrl: engineScript.url,
            workerUrl: HYPERDB_WORKER_URL,
            wasmUrl: HYPERDB_WASM_URL,
            onSetupProgress,
        }) as HyperDBEngineClient;
    } catch (error) {
        engineScript.revoke();
        throw error;
    }
    const terminate = client.terminate.bind(client);
    client.terminate = async () => {
        try {
            await terminate();
        } finally {
            engineScript.revoke();
        }
    };
    return client;
}

export async function setupWebHyperDB(
    context: string,
    logger: Logger,
    onSetupProgress?: (progress: SetupProgress) => void,
): Promise<HyperDB> {
    if (globalThis.__DASHQL_TEST_HYPERDB_FACTORY__) {
        return await globalThis.__DASHQL_TEST_HYPERDB_FACTORY__(context, logger, onSetupProgress);
    }
    const initStart = performance.now();
    try {
        logger.info('Creating HyperDB WASM client', { context }, 'hyperdb');
        const client = await createWebHyperDBClient(onSetupProgress);
        try {
            const database = await HyperDB.create(
                client,
                HYPERDB_WASM_ENGINE_SETTINGS,
            );

            logger.info('Instantiated HyperDB WASM', {
                context,
                duration: Math.floor(performance.now() - initStart).toString(),
            }, 'hyperdb');
            return database;
        } catch (error) {
            await client.terminate();
            throw error;
        }
    } catch (error) {
        logger.error('Instantiating HyperDB WASM failed', {
            context,
            error: stringifyError(error),
            duration: Math.floor(performance.now() - initStart).toString(),
        }, 'hyperdb');
        throw error;
    }
}
