// The embedded Hyper of the app: `setupWebHyperDB` of @akohn/dashql with the files of hyperdb-wasm that the app serves,
// and the engines that the browser tests share.
import type { Logger } from '@akohn/dashql/platform/logger/logger';
import type { HyperDB, HyperDBClient } from '@akohn/dashql/platform/hyperdb/hyperdb_wasm';
import {
    createWebHyperDBClientOptions as createClientOptions,
    setupWebHyperDB as setupWebHyperDBOf,
    type EmbeddedDatabaseOptions,
    type HyperDBWebAssets,
    type SetupProgress,
} from '@akohn/dashql/platform/hyperdb/hyperdb_web';

declare global {
    var __DASHQL_TEST_HYPERDB_CLIENT__: ((
        onSetupProgress?: (progress: SetupProgress) => void,
    ) => Promise<HyperDBClient>) | undefined;
    var __DASHQL_TEST_HYPERDB_CLIENT_PROMISE__: Promise<HyperDBClient> | undefined;
    var __DASHQL_TEST_HYPERDB_CLIENT_CREATIONS__: number | undefined;
    var __DASHQL_TEST_HYPERDB_UNLOAD_INSTALLED__: boolean | undefined;
    var __DASHQL_TEST_HYPERDB_FACTORY__: ((
        context: string,
        logger: Logger,
        onSetupProgress?: (progress: SetupProgress) => void,
    ) => Promise<HyperDB>) | undefined;
}

import engineUrl from '@dashql/hyperdb-wasm-js?url';
import workerUrl from '@dashql/hyperdb-wasm-worker?url';
import workerBridgeUrl from './hyperdb_worker_bridge.js?url&no-inline';
import wasmUrl from '@dashql/hyperdb-wasm?url';

/// The files of hyperdb-wasm that the app serves, the WebAssembly compressed with Brotli in the pages build
export const HYPERDB_WEB_ASSETS: HyperDBWebAssets = {
    engine: new URL(engineUrl as string, import.meta.url),
    wasm: new URL(wasmUrl as string, import.meta.url),
    worker: new URL(workerUrl as string, import.meta.url),
    workerBridge: new URL(workerBridgeUrl as string, import.meta.url),
};

/// The worker options of a browser engine client of the app
export function createWebHyperDBClientOptions(): ReturnType<typeof createClientOptions> {
    return createClientOptions(HYPERDB_WEB_ASSETS);
}

/// Set up the embedded Hyper of the app, the one of the browser tests if they installed a factory
export async function setupWebHyperDB(
    context: string,
    logger: Logger,
    onSetupProgress?: (progress: SetupProgress) => void,
    options: EmbeddedDatabaseOptions = {},
): Promise<HyperDB> {
    if (globalThis.__DASHQL_TEST_HYPERDB_FACTORY__) {
        return await globalThis.__DASHQL_TEST_HYPERDB_FACTORY__(context, logger, onSetupProgress);
    }
    return await setupWebHyperDBOf(context, logger, HYPERDB_WEB_ASSETS, onSetupProgress, options);
}
