import * as dashql from '@akohn/dashql';
import * as React from 'react';

import { stringifyError, type TracedLogger } from '@akohn/dashql/platform/logger/logger';
import { createTrace } from '@akohn/dashql/platform/logger/trace_context';
import { HostProvider, useHost, type CoreSetup } from '../host.js';
import { useLogger } from '../logger.js';
import { decodedContentLength } from './content_length.js';

/// How far the WebAssembly of the core loaded
export interface InstantiationProgress {
    startedAt: Date;
    updatedAt: Date;
    bytesTotal: bigint;
    bytesLoaded: bigint;
}

const PROGRESS_CONTEXT = React.createContext<InstantiationProgress | null>(null);
const CORE_CONTEXT = React.createContext<dashql.DashQL | null>(null);

interface Props {
    /// The URL of the WebAssembly of the core, `@akohn/dashql/wasm` as an asset of the bundler of the host
    wasmUrl: string | URL;
    children?: React.ReactNode;
}

/// The core module of a page: the first call of `useDashQLCoreSetup()` or `useDashQLCore()` fetches its WebAssembly
/// with progress and instantiates it once. It is the core of the host of the components below (`useHost().setupCore`).
/// Needs a logger above it (`LoggerContext` of `logger.ts`).
export function DashQLCoreProvider(props: Props) {
    const logger = useLogger();
    const outer = useHost();
    const wasmUrl = props.wasmUrl.toString();
    const instantiation = React.useRef<Promise<dashql.DashQL> | null>(null);
    // A new instance owns no native objects and shares the memory of the module, an instance that finishes after the
    // provider was disposed is dropped without a cleanup
    const lifecycle = React.useRef<{ disposed: boolean }>({ disposed: false });
    const [progress, setProgress] = React.useState<InstantiationProgress | null>(null);
    // The core once it is instantiated
    const [core, setCore] = React.useState<dashql.DashQL | null>(null);

    const instantiator = React.useCallback(async (context: string): Promise<dashql.DashQL> => {
        const owner = lifecycle.current;
        if (owner.disposed) throw new DOMException('Core provider was disposed', 'AbortError');
        // Already instantiated?
        if (instantiation.current != null) {
            return await instantiation.current;
        }

        const now = new Date();
        const internal: InstantiationProgress = {
            startedAt: now,
            updatedAt: now,
            bytesTotal: BigInt(0),
            bytesLoaded: BigInt(0),
        };

        // Fetch the WebAssembly and track the bytes of its body
        const fetchWithProgress = async (url: string, traced: TracedLogger) => {
            traced.info("Fetching core wasm", { "context": context }, "core");
            const response = await fetch(new Request(url));
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
            return new Response(response.body?.pipeThrough(new TransformStream(tracker)), response);
        };

        const instantiate = async (): Promise<dashql.DashQL> => {
            const traced = logger.withTrace(createTrace());
            const initStart = performance.now();
            try {
                traced.info("Loading core Wasm", { "context": context }, "core");
                const response = await fetchWithProgress(wasmUrl, traced);
                const wasmBinary = new Uint8Array(await response.arrayBuffer());
                const instance = await dashql.DashQL.create({ wasmBinary });
                if (owner.disposed) throw new DOMException('Core provider was disposed', 'AbortError');

                traced.info("Instantiated core", {
                    "context": context,
                    "duration": Math.floor(performance.now() - initStart).toString()
                }, "core");
                setProgress(_ => ({ ...internal, updatedAt: new Date() }));
                return instance;
            } catch (e) {
                traced.error("Failed to instantiate core", {
                    "error": stringifyError(e),
                    "duration": Math.floor(performance.now() - initStart).toString()
                }, "core");
                throw e;
            }
        };
        instantiation.current = instantiate();
        instantiation.current.then(instance => { if (!owner.disposed) setCore(instance); }, () => { });
        return await instantiation.current;
    }, [logger, wasmUrl]);

    React.useEffect(() => {
        if (lifecycle.current.disposed) lifecycle.current = { disposed: false };
        const owner = lifecycle.current;
        return () => {
            owner.disposed = true;
            instantiation.current = null;
        };
    }, []);

    // The core is the core of the host of the components
    const host = React.useMemo(() => ({ ...outer, setupCore: instantiator }), [outer, instantiator]);
    return React.createElement(HostProvider, { value: host },
        React.createElement(PROGRESS_CONTEXT.Provider, { value: progress },
            React.createElement(CORE_CONTEXT.Provider, { value: core }, props.children)));
}

/// How far the WebAssembly of the core loaded, null before the setup started
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
