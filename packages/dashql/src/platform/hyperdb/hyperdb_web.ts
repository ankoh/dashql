// The embedded Hyper of a page: hyperdb-wasm in a worker over the origin private file system. The page has to be
// cross-origin isolated, the engine shares its memory with the worker. The files of the engine are assets of the host,
// it passes their URLs (`HyperDBWebAssets`): a bundler emits them, a deployment may compress them.
import { HyperDB as HyperDBEngine } from 'hyperdb-wasm';

import type { Logger } from '../logger/logger.js';
import { stringifyError } from '../logger/logger.js';
import { HyperDB, type HyperDBSettings } from './hyperdb_wasm.js';
import { EXPERIMENTAL_WASM_BACKEND_SETTING, HYPERDB_WASM_ENGINE_SETTINGS, isUnknownHyperDBSettingError } from './hyperdb_settings.js';
import { cleanupStaleHyperDBOPFSInstances, createHyperDBOPFSInstance } from './hyperdb_opfs_instance.js';

/// The files of hyperdb-wasm that a page serves
export interface HyperDBWebAssets {
    /// The script of the engine, `hyperdb-wasm/dist/hyperdb-wasm.js`
    engine: URL | string;
    /// The WebAssembly of the engine, `hyperdb-wasm/dist/hyperdb-wasm.wasm` or a compressed copy that the server
    /// decodes
    wasm: URL | string;
    /// The script of the worker, `hyperdb-wasm/dist/browser_worker.js`
    worker: URL | string;
    /// A script of the origin of the page that loads the worker script of its `workerUrl` parameter with
    /// `importScripts`: the worker runs on the origin of the page, also when the engine comes from another one.
    /// The app serves `hyperdb_worker_bridge.js`, three lines.
    workerBridge: URL | string;
}

/// How far the engine loaded
export interface SetupProgress {
    readonly bytesLoaded: number;
    readonly bytesTotal: number;
}

/// The startup options of the embedded database, they apply when it is instantiated
export interface EmbeddedDatabaseOptions {
    /// Run the queries on the experimental wasm backend of HyperDB, the default backend if the engine has none
    experimentalWasmBackend?: boolean;
    /// Settings of the engine besides those of DashQL, e.g. the resource usage in the log for the Hyper log demo
    engineSettings?: Readonly<Record<string, string | number | boolean>>;
}

/// What a page needs for the engine
export interface HyperDBWebCapabilities {
    readonly crossOriginIsolated: boolean;
    readonly hasSharedArrayBuffer: boolean;
}

function readWebCapabilities(): HyperDBWebCapabilities {
    return {
        crossOriginIsolated: globalThis.crossOriginIsolated === true,
        hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    };
}

/// Why the engine can't start in this page, null if it can
export function getHyperDBWebSupportError(capabilities: HyperDBWebCapabilities = readWebCapabilities()): string | null {
    if (!capabilities.hasSharedArrayBuffer || !capabilities.crossOriginIsolated) {
        return 'HyperDB requires SharedArrayBuffer and a cross-origin-isolated page.';
    }
    return null;
}

/// The waits before the engine asks for its memory again, about 6 s in all
export const HYPERDB_MEMORY_WAITS_MS: readonly number[] = [100, 200, 400, 800, 1600, 3200];

/// Did WebKit refuse the memory of the engine? The worker fails while it evaluates the engine script, the client of
/// the engine reports the message of that error event, e.g. "RangeError: Out of memory".
export function isOutOfMemoryError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\bOut of memory\b/i.test(message);
}

/// Start the engine, and wait for the memory of the last page if WebKit refuses the memory of this one.
///
/// The engine reserves a shared WebAssembly.Memory with a maximum of 4 GiB, and WebKit charges that maximum against
/// the address space of its process. Right after a reload the worker of the last page is stopped but its memory may not
/// be released yet, and Safari of iOS fails the memory of the new page with "Out of memory". The setup waits and starts
/// the engine again, with the same memory, until the waits run out.
export async function startWaitingForMemory<T>(
    start: () => Promise<T>,
    onWait: (error: unknown, waitMs: number) => void,
    waits: readonly number[] = HYPERDB_MEMORY_WAITS_MS,
): Promise<T> {
    for (let attempt = 0; ; ++attempt) {
        try {
            return await start();
        } catch (error) {
            if (attempt >= waits.length || !isOutOfMemoryError(error)) throw error;
            onWait(error, waits[attempt]);
            await new Promise(resolve => setTimeout(resolve, waits[attempt]));
        }
    }
}

/// The script that the worker loads first: it points the engine at its WebAssembly and loads the engine script. An
/// object URL that must be revoked once the engine terminated.
function createEngineScript(assets: HyperDBWebAssets): { url: string; revoke: () => void } {
    const engine = new URL(assets.engine, globalThis.location?.href).href;
    const wasm = new URL(assets.wasm, globalThis.location?.href).href;
    const source = `self.HYPERDB_WASM_MODULE=self.Module??{};self.HYPERDB_WASM_MODULE.locateFile=(path,prefix)=>path==='hyperdb-wasm.wasm'?${JSON.stringify(wasm)}:prefix+path;importScripts(${JSON.stringify(engine)});`;
    const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    return { url, revoke: () => URL.revokeObjectURL(url) };
}

/// The worker options of a browser engine client.
/// The engine script is an object URL that must be revoked once the engine terminated.
export function createWebHyperDBClientOptions(assets: HyperDBWebAssets): { workerUrl: URL; engineUrl: string; wasmUrl: URL; revoke: () => void } {
    const supportError = getHyperDBWebSupportError();
    if (supportError != null) throw new Error(supportError);
    const engineScript = createEngineScript(assets);
    const workerUrl = new URL(assets.workerBridge, globalThis.location?.href);
    workerUrl.searchParams.set('workerUrl', new URL(assets.worker, globalThis.location?.href).href);
    return { workerUrl, engineUrl: engineScript.url, wasmUrl: new URL(assets.wasm, globalThis.location?.href), revoke: engineScript.revoke };
}

/// Stop the worker of an engine at once.
/// The terminate of the engine shuts it down first and waits for the answers of the worker, a page that unloads doesn't
/// wait for them, and the worker would run on with its memory. hyperdb-wasm has no public call that stops the worker
/// without the shutdown, its client has one.
function stopEngineWorker(engine: HyperDBEngine): void {
    const client = (engine as unknown as { client: { terminate(): Promise<void> } }).client;
    void client.terminate().catch(() => { /* the worker is gone either way */ });
}

/// Start a HyperDB engine in a browser worker.
/// A page that goes away stops the worker of its engine right away. The engine reserves a shared WebAssembly.Memory
/// with a maximum of 4 GiB, and WebKit charges that maximum against the address space of its process. A reload asks
/// for another 4 GiB, and Safari of iOS fails it with "Out of memory" while the worker of the last page still holds
/// its memory. A page that goes to the back-forward cache keeps its engine.
async function createWebHyperDBEngine(
    assets: HyperDBWebAssets,
    settings: HyperDBSettings,
    onSetupProgress?: (progress: SetupProgress) => void,
): Promise<HyperDBEngine> {
    const { revoke, ...options } = createWebHyperDBClientOptions(assets);
    let engine: HyperDBEngine;
    try {
        engine = await HyperDBEngine.create({ ...options, onSetupProgress, settings });
    } catch (error) {
        revoke();
        throw error;
    }
    // A PageTransitionEvent, the module type checks without the DOM
    const stopOnPageHide = (event: Event) => {
        if (!(event as Event & { persisted?: boolean }).persisted) stopEngineWorker(engine);
    };
    globalThis.addEventListener('pagehide', stopOnPageHide);
    const terminate = engine.terminate.bind(engine);
    engine.terminate = async () => {
        globalThis.removeEventListener('pagehide', stopOnPageHide);
        try {
            await terminate();
        } finally {
            revoke();
        }
    };
    return engine;
}

/// Start a HyperDB engine in a browser worker, on the experimental wasm backend if requested.
/// A build of hyperdb-wasm without the backend rejects its setting, the engine then starts on the default backend.
async function createWebHyperDBEngineWithOptions(
    context: string,
    logger: Logger,
    assets: HyperDBWebAssets,
    settings: HyperDBSettings,
    options: EmbeddedDatabaseOptions,
    onSetupProgress?: (progress: SetupProgress) => void,
): Promise<HyperDBEngine> {
    if (!options.experimentalWasmBackend) {
        return await createWebHyperDBEngine(assets, settings, onSetupProgress);
    }
    try {
        const engine = await createWebHyperDBEngine(assets, { ...settings, [EXPERIMENTAL_WASM_BACKEND_SETTING]: true }, onSetupProgress);
        logger.info('Started HyperDB on the experimental wasm backend', { context }, 'hyperdb');
        return engine;
    } catch (error) {
        if (!isUnknownHyperDBSettingError(error, EXPERIMENTAL_WASM_BACKEND_SETTING)) throw error;
        logger.warn('HyperDB has no experimental wasm backend, starting the default backend', {
            context,
            error: stringifyError(error),
        }, 'hyperdb');
        return await createWebHyperDBEngine(assets, settings, onSetupProgress);
    }
}

/// Set up the embedded Hyper of a page: an instance in the origin private file system, the engine in a worker and the
/// databases of DashQL. Terminating the database stops the engine and removes the instance.
export async function setupWebHyperDB(
    context: string,
    logger: Logger,
    assets: HyperDBWebAssets,
    onSetupProgress?: (progress: SetupProgress) => void,
    options: EmbeddedDatabaseOptions = {},
): Promise<HyperDB> {
    const initStart = performance.now();
    try {
        logger.info('Creating HyperDB WASM engine', { context }, 'hyperdb');
        // The steps of the setup, in the debug log
        let stepStart = performance.now();
        const step = (name: string) => {
            const now = performance.now();
            logger.debug('Set up a step of HyperDB WASM', { context, step: name, durationMs: (now - stepStart).toFixed(1) }, 'hyperdb');
            stepStart = now;
        };
        await cleanupStaleHyperDBOPFSInstances();
        step('remove stale OPFS instances');
        const instance = await createHyperDBOPFSInstance();
        step('create OPFS instance');
        let engine: HyperDBEngine | null = null;
        try {
            engine = await startWaitingForMemory(
                () => createWebHyperDBEngineWithOptions(
                    context,
                    logger,
                    assets,
                    { ...HYPERDB_WASM_ENGINE_SETTINGS, ...options.engineSettings, log_file_path: instance.logDirectoryPath },
                    options,
                    onSetupProgress,
                ),
                (error, waitMs) => logger.warn('HyperDB WASM got no memory, waiting for the memory of the last page', {
                    context,
                    error: stringifyError(error),
                    waitMs: waitMs.toString(),
                }, 'hyperdb'),
            );
            step('start engine');
            const database = await HyperDB.create(engine, {
                computeDatabasePath: instance.computeDatabasePath,
                defaultDatabasePath: instance.userDatabasePath,
                snippetsDatabasePath: instance.snippetsDatabasePath,
                logger,
            });
            step('create databases');
            const terminate = database.terminate.bind(database);
            database.terminate = async () => {
                await terminate();
                await instance.dispose();
            };

            logger.info('Instantiated HyperDB WASM', {
                context,
                duration: Math.floor(performance.now() - initStart).toString(),
            }, 'hyperdb');
            return database;
        } catch (error) {
            try {
                await engine?.terminate();
                await instance.dispose();
            } catch (cleanupError) {
                logger.warn('Cleaning up failed HyperDB setup failed', {
                    context,
                    error: stringifyError(cleanupError),
                }, 'hyperdb');
            }
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
