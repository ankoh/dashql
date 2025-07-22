import * as dashql from '@ankoh/dashql-core';
import * as React from 'react';

import { useLogger } from './platform/logger_provider.js';

const DASHQL_MODULE_URL = new URL('@ankoh/dashql-core/dist/dashql.wasm', import.meta.url);

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

        // Create instantiation query_status
        const now = new Date();
        const internal: InstantiationProgress = {
            startedAt: now,
            updatedAt: now,
            bytesTotal: BigInt(0),
            bytesLoaded: BigInt(0),
        };
        // Fetch an url with query_status tracking
        const fetchWithProgress = async (url: URL) => {
            logger.info("instantiating core", { "context": context }, "core");

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
                    internal.updatedAt = now;
                    internal.bytesLoaded += BigInt(chunk.byteLength);
                    if (now.getTime() - prevUpdate.getTime() > 20) {
                        setProgress(_ => ({ ...internal }));
                    }
                    ctrl.enqueue(chunk);
                },
            };
            const ts = new TransformStream(tracker);
            return new Response(response.body?.pipeThrough(ts), response);
        };
        const instantiate = async (): Promise<dashql.DashQL> => {
            const initStart = performance.now();
            try {
                const instance = await dashql.DashQL.create(async (imports: WebAssembly.Imports) => {
                    return await WebAssembly.instantiateStreaming(fetchWithProgress(DASHQL_MODULE_URL), imports);
                });
                const initEnd = performance.now();
                logger.info("instantiated core", { "context": context, "duration": Math.floor(initEnd - initStart).toString() }, "core");
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
