import * as dashql from '@akohn/dashql';
import * as React from 'react';

import { useLogger } from './logger_provider.js';
import { TracedLogger, stringifyError } from '@akohn/dashql/platform/logger/logger';
import { createTrace } from '@akohn/dashql/platform/logger/trace_context';
import { decodedContentLength } from '../utils/content_length.js';
import { CorePanicOverlay } from './core_panic_overlay.js';
import { HostProvider, useHost, type CoreSetup } from '@akohn/dashql-react/host';

// Load the WebAssembly asset through the core package export.
import coreWasmUrl from '@akohn/dashql/wasm?url';
const DASHQL_WASM_URL = typeof coreWasmUrl === 'string' ? coreWasmUrl : new URL(coreWasmUrl as string, import.meta.url).href;

export interface InstantiationProgress {
    startedAt: Date;
    updatedAt: Date;
    bytesTotal: bigint;
    bytesLoaded: bigint;
}

const PROGRESS_CONTEXT = React.createContext<InstantiationProgress | null>(null);
const CORE_CONTEXT = React.createContext<dashql.DashQL | null>(null);

interface Props {
    children: React.ReactElement;
}

export const DashQLCoreProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const outer = useHost();
    const instantiation = React.useRef<Promise<dashql.DashQL> | null>(null);
    const lifecycle = React.useRef<{ disposed: boolean; core: dashql.DashQL | null }>({ disposed: false, core: null });
    const [progress, setProgress] = React.useState<InstantiationProgress | null>(null);
    // The core once it is instantiated
    const [core, setCore] = React.useState<dashql.DashQL | null>(null);

    const instantiator = React.useCallback(async (context: string): Promise<dashql.DashQL> => {
        const owner = lifecycle.current;
        if (owner.disposed) throw new DOMException('Core provider was disposed', 'AbortError');
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
            const contentLength = decodedContentLength(response);

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
                traced.info("Loading core Wasm", { "context": context }, "core");
                const response = await fetchWithProgress(DASHQL_WASM_URL, traced);
                const wasmBinary = new Uint8Array(await response.arrayBuffer());
                const instance = await dashql.DashQL.create({ wasmBinary });
                owner.core = instance;
                if (owner.disposed) throw new DOMException('Core provider was disposed', 'AbortError');

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
        instantiation.current.then(instance => { if (!owner.disposed) setCore(instance); }, () => { });
        // Await the instantiation
        return await instantiation.current;

    }, [logger, setProgress, setCore]);

    React.useEffect(() => {
        if (lifecycle.current.disposed) lifecycle.current = { disposed: false, core: null };
        const owner = lifecycle.current;
        return () => {
            owner.disposed = true;
            instantiation.current = null;
        };
    }, []);

    // The core is the core of the host of the components
    const host = React.useMemo(() => ({ ...outer, setupCore: instantiator }), [outer, instantiator]);
    return (
        <HostProvider value={host}>
            <PROGRESS_CONTEXT.Provider value={progress}>
                <CORE_CONTEXT.Provider value={core}>
                    {props.children}
                    <CorePanicOverlay />
                </CORE_CONTEXT.Provider>
            </PROGRESS_CONTEXT.Provider>
        </HostProvider>
    );
};

export const useDashQLCoreSetupProgress = (): InstantiationProgress | null => React.useContext(PROGRESS_CONTEXT);

/// Set up the core of the provider, the core of the host of the components
export function useDashQLCoreSetup(): CoreSetup {
    return useHost().setupCore!;
}

/// The core once it is instantiated, null before; the first call starts the instantiation. Without a provider, the core
/// that this copy of the package instantiated already, e.g. in a test.
export function useDashQLCore(): dashql.DashQL | null {
    const setup = useHost().setupCore;
    const core = React.useContext(CORE_CONTEXT);
    const [instantiated] = React.useState(() => setup == null ? dashql.DashQL.instantiated() : null);
    React.useEffect(() => {
        if (setup != null && core == null) void setup('runtime').catch(() => { });
    }, [setup, core]);
    return setup == null ? instantiated : core;
}
