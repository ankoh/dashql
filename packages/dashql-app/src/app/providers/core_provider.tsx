import * as dashql from '../../core/index.js';
import * as React from 'react';

import { useLogger } from '../../platform/logger/logger_provider.js';
import { TracedLogger, stringifyError } from '../../platform/logger/logger.js';
import { createTrace } from '../../platform/logger/trace_context.js';

// Asset import: dedicated alias so WASM resolves independently from API (Bazel: DASHQL_CORE_WASM_PATH; local: core dist).
// eslint-disable-next-line import/no-unresolved -- resolved by bundler
import coreWasmUrl from '@ankoh/dashql-core-wasm?url';
// Emscripten pthread workers reload the generated Core module itself.
// eslint-disable-next-line import/no-unresolved -- resolved by bundler
import coreWorkerUrl from '@ankoh/dashql-core-js?url';
const DASHQL_WASM_URL = typeof coreWasmUrl === 'string' ? coreWasmUrl : new URL(coreWasmUrl as string, import.meta.url).href;
const DASHQL_WORKER_URL = typeof coreWorkerUrl === 'string' ? coreWorkerUrl : new URL(coreWorkerUrl as string, import.meta.url).href;

export function logCoreStderr(traced: TracedLogger, text: string): void {
    // Emscripten prints an "Aborted(...)" line immediately before it throws the same failure. The
    // operation that invoked Wasm logs the thrown exception with context, so treating this duplicate
    // stderr line as an error only produces a context-free toast (often just "Aborted()").
    if (text === 'Aborted()') {
        traced.warn(text, {}, "core");
    } else {
        traced.error(text, {}, "core");
    }
}

export interface InstantiationProgress {
    startedAt: Date;
    updatedAt: Date;
    bytesTotal: bigint;
    bytesLoaded: bigint;
}

const INSTANTIATOR_CONTEXT = React.createContext<((context: string) => Promise<dashql.DashQL>) | null>(null);
const PROGRESS_CONTEXT = React.createContext<InstantiationProgress | null>(null);

interface Props {
    children: React.ReactElement;
}

export const DashQLCoreProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const instantiation = React.useRef<Promise<dashql.DashQL> | null>(null);
    const [progress, setProgress] = React.useState<InstantiationProgress | null>(null);

    const instantiator = React.useCallback(async (context: string): Promise<dashql.DashQL> => {
        /// Already instantiated?
        if (instantiation.current != null) {
            return await instantiation.current;
        }

        // Create instantiation progress
        const now = new Date();
        const internal: InstantiationProgress = {
            startedAt: now,
            updatedAt: now,
            bytesTotal: BigInt(0),
            bytesLoaded: BigInt(0),
        };

        // Fetch an url with progress tracking (url is string from ?url import or URL)
        const fetchWithProgress = async (url: string | URL, traced: TracedLogger) => {
            traced.info("Fetching core wasm", { "context": context }, "core");

            // Try to determine file size
            const request = new Request(url);
            const response = await fetch(request);
            if (!response.ok) {
                throw new Error(`Failed to fetch core wasm: ${response.status} ${response.statusText}`);
            }
            const contentLengthHdr = response.headers.get('content-length');
            const contentLength = contentLengthHdr ? parseInt(contentLengthHdr, 10) || 0 : 0;

            const now = new Date();
            internal.startedAt = now;
            internal.updatedAt = now;
            internal.bytesTotal = BigInt(contentLength) || BigInt(0);
            internal.bytesLoaded = BigInt(0);

            const tracker = {
                transform(chunk: Uint8Array, ctrl: TransformStreamDefaultController) {
                    const prevUpdate = internal.updatedAt;
                    internal.updatedAt = new Date();
                    internal.bytesLoaded += BigInt(chunk.byteLength);
                    if (internal.updatedAt.getTime() - prevUpdate.getTime() > 20) {
                        setProgress(_ => ({ ...internal }));
                    }
                    ctrl.enqueue(chunk);
                },
            };
            const ts = new TransformStream(tracker);
            return new Response(response.body?.pipeThrough(ts), response);
        };

        const instantiate = async (): Promise<dashql.DashQL> => {
            const traced = logger.withTrace(createTrace());
            const initStart = performance.now();
            try {
                const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
                const isCrossOriginIsolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
                if (!hasSharedArrayBuffer || !isCrossOriginIsolated) {
                    throw new Error('DashQL Core requires SharedArrayBuffer and a cross-origin-isolated page');
                }
                traced.info("Loading core Wasm", { "context": context }, "core");
                const response = await fetchWithProgress(DASHQL_WASM_URL, traced);
                const wasmBinary = new Uint8Array(await response.arrayBuffer());
                const instance = await dashql.DashQL.create({
                    // Optional: Console output handlers
                    print: (text: string) => traced.info(text, {}, "core"),
                    printErr: (text: string) => logCoreStderr(traced, text),
                    mainScriptUrlOrBlob: DASHQL_WORKER_URL,
                    wasmBinary,
                });

                const initEnd = performance.now();
                traced.info("Instantiated core", {
                    "context": context,
                    "duration": Math.floor(initEnd - initStart).toString()
                }, "core");

                setProgress(_ => ({
                    ...internal,
                    updatedAt: new Date(),
                }));

                return instance;
            } catch (e: any) {
                const initEnd = performance.now();
                traced.error("Failed to instantiate core", {
                    "error": stringifyError(e),
                    "duration": Math.floor(initEnd - initStart).toString()
                }, "core");
                throw e;
            }
        };
        // Start the instantiation
        instantiation.current = instantiate();
        // Await the instantiation
        return await instantiation.current;

    }, [logger, setProgress]);

    React.useEffect(() => {
        return () => {
            const pending = instantiation.current;
            instantiation.current = null;
            // Swallow any instantiation rejection - nothing to clean up in that case.
            // Dropping the ref lets the WASM module become GC-eligible so a remount
            // (e.g. from Vite HMR) does not stack multiple live core instances.
            pending?.catch(() => { /* noop */ });
        };
    }, []);

    return (
        <INSTANTIATOR_CONTEXT.Provider value={instantiator}>
            <PROGRESS_CONTEXT.Provider value={progress}>
                {props.children}
            </PROGRESS_CONTEXT.Provider>
        </INSTANTIATOR_CONTEXT.Provider>
    );
};

export const useDashQLCoreSetupProgress = (): InstantiationProgress | null => React.useContext(PROGRESS_CONTEXT);

export type DashQLSetupFn = (context: string) => Promise<dashql.DashQL>;
export function useDashQLCoreSetup(): DashQLSetupFn {
    return React.useContext(INSTANTIATOR_CONTEXT)!;
};
