import type { Logger } from '../logger/logger.js';
import { stringifyError } from '../logger/logger.js';

import { HyperDB } from './hyperdb_wasm.js';

// eslint-disable-next-line import/no-unresolved -- package asset resolved by Vite
import engineUrl from '@dashql/hyperdb-wasm-js?url';
// eslint-disable-next-line import/no-unresolved -- package asset resolved by Vite
import workerUrl from '@dashql/hyperdb-wasm-worker?url';
// eslint-disable-next-line import/no-unresolved -- package asset resolved by Bazel/Vite alias
import wasmUrl from '@dashql/hyperdb-wasm?url';

const HYPERDB_ENGINE_URL = new URL(engineUrl as string, import.meta.url);
const HYPERDB_WORKER_URL = new URL(workerUrl as string, import.meta.url);
const HYPERDB_WASM_URL = new URL(wasmUrl as string, import.meta.url);

const HYPERDB_SETTINGS = {
    identifier_resolution: 'case_insensitive',
    experimental_view_creation: true,
    experimental_persisted_view_creation: true,
    hyper_introspection_functions: true,
    log_json_export: true,
    log_rotation_size: 1024,
    log_rotation_age: 60,
    log_file_max_count: 10,
} as const;

function createEngineScript(): { url: string; revoke: () => void } {
    const source = `self.HYPERDB_WASM_MODULE=self.Module??{};self.HYPERDB_WASM_MODULE.locateFile=(path,prefix)=>path==='hyperdb-wasm.wasm'?${JSON.stringify(HYPERDB_WASM_URL.href)}:prefix+path;importScripts(${JSON.stringify(HYPERDB_ENGINE_URL.href)});`;
    const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    return { url, revoke: () => URL.revokeObjectURL(url) };
}

export async function setupWebHyperDB(context: string, logger: Logger): Promise<HyperDB> {
    const initStart = performance.now();
    try {
        const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
        const isCrossOriginIsolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
        if (!hasSharedArrayBuffer || !isCrossOriginIsolated) {
            throw new Error('HyperDB requires SharedArrayBuffer and a cross-origin-isolated page');
        }

        logger.info('Creating HyperDB WASM client', { context }, 'hyperdb');
        const { createBrowserClient } = await import('hyperdb-wasm/raw');
        const engineScript = createEngineScript();
        try {
            const database = await HyperDB.create(
                createBrowserClient({
                    engineUrl: engineScript.url,
                    workerUrl: HYPERDB_WORKER_URL,
                }),
                HYPERDB_SETTINGS,
            );
            const terminate = database.terminate.bind(database);
            database.terminate = async () => {
                try {
                    await terminate();
                } finally {
                    engineScript.revoke();
                }
            };

            logger.info('Instantiated HyperDB WASM', {
                context,
                duration: Math.floor(performance.now() - initStart).toString(),
            }, 'hyperdb');
            return database;
        } catch (error) {
            engineScript.revoke();
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
