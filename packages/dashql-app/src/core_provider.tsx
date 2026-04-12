import * as dashql from './core/index.js';
import * as React from 'react';

import { useLogger } from './platform/logger/logger_provider.js';
import { globalTraceContext } from './platform/logger/trace_context.js';

// Asset import: dedicated alias so WASM resolves independently from API (Bazel: DASHQL_CORE_WASM_PATH; local: core dist).
// eslint-disable-next-line import/no-unresolved -- resolved by bundler
import coreWasmUrl from '@ankoh/dashql-core-wasm?url';
const DASHQL_WASM_URL = typeof coreWasmUrl === 'string' ? coreWasmUrl : new URL(coreWasmUrl as string, import.meta.url).href;

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
        const fetchWithProgress = async (url: string | URL) => {
            logger.info("fetching core wasm", { "context": context }, "core");

            // Try to determine file size
            const request = new Request(url);
            const response = await fetch(request);
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
            const progressResponse = new Response(response.clone().body?.pipeThrough(ts), response);
            const progressDone = progressResponse.arrayBuffer().then(() => undefined);
            return {
                response,
                progressDone,
            };
        };

        const instantiate = async (): Promise<dashql.DashQL> => {
            globalTraceContext.startTrace();
            try {
                const initStart = performance.now();
                try {
                    // With JS glue code, we can intercept instantiation for progress tracking
                    const instance = await dashql.DashQL.create({
                        // Optional: Console output handlers
                        print: (text: string) => logger.info(text, {}, "core"),
                        printErr: (text: string) => logger.error(text, {}, "core"),

                        // Override WASM instantiation to add progress tracking
                        instantiateWasm: async (imports, successCallback) => {
                            logger.info("instantiating core", { "context": context }, "core");

                            // Fetch WASM with progress
                            const { response, progressDone } = await fetchWithProgress(DASHQL_WASM_URL);

                            // Instantiate with streaming compilation
                            const result = await WebAssembly.instantiateStreaming(response, imports);
                            await progressDone;

                            // Notify Emscripten of successful instantiation
                            successCallback(result.instance, result.module);

                            // Return empty object (Emscripten expects this)
                            return {};
                        },
                    });

                    const initEnd = performance.now();
                    logger.info("instantiated core", {
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
                    logger.error("instantiating core failed", {
                        "error": e.toString(),
                    "duration": Math.floor(initEnd - initStart).toString()
                }, "core");
                console.error(e);
                throw e;
                }
            } finally {
                globalTraceContext.endSpan();
            }
        };
        // Start the instantiation
        instantiation.current = instantiate();
        // Await the instantiation
        return await instantiation.current;

    }, [logger, setProgress]);

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
