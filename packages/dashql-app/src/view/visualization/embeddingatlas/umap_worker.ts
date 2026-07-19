/// UMAP web worker: runs the vendored Rust→wasm UMAP projection off the main
/// thread. See umap_worker_request.ts for the message protocol and umap_projector.ts
/// for the main-thread driver.
///
/// The wasm CPU path is single-threaded (rayon degrades to sequential on wasm32),
/// so a projection of a large embedding table is seconds-scale and MUST NOT block
/// the UI. Progress is streamed back so the notebook AI-bar/log can show it.

// eslint-disable-next-line import/no-unresolved -- resolved by the bundler alias to dependencies/umap-wasm/index.js
import { createUMAP } from '@dashql/umap-wasm';

import {
    UMAPWorkerRequest,
    UMAPWorkerRequestType,
    UMAPWorkerResponse,
    UMAPWorkerResponseType,
} from './umap_worker_request.js';

/// The currently running projection, if any. Only one runs at a time; a CANCEL
/// flips `cancelled` so the driver stops caring about a late RESULT, and the UMAP
/// instance is destroyed as soon as run() settles.
let active: { requestId: number; cancelled: boolean } | null = null;

function post(msg: UMAPWorkerResponse, transfer?: Transferable[]): void {
    // eslint-disable-next-line no-restricted-globals
    (self as unknown as Worker).postMessage(msg, transfer ?? []);
}

async function run(requestId: number, params: UMAPWorkerRequest & { type: UMAPWorkerRequestType.RUN }): Promise<void> {
    const state = { requestId, cancelled: false };
    active = state;

    const { data, count, dimension, options } = params.params;
    let umap: Awaited<ReturnType<typeof createUMAP>> | null = null;
    try {
        umap = await createUMAP(count, dimension, 2, data, {
            ...options,
            progress: (progress: number, stage: string) => {
                if (state.cancelled) return;
                post({ requestId, type: UMAPWorkerResponseType.PROGRESS, progress, stage });
            },
        });
        if (state.cancelled) return;

        // Anneal the layout to completion.
        await umap.run();
        if (state.cancelled) return;

        // Copy the embedding out of the reused wasm buffer into a transferable one.
        const embedding = new Float32Array(umap.embedding);
        post(
            { requestId, type: UMAPWorkerResponseType.RESULT, embedding, count },
            [embedding.buffer],
        );
    } catch (e: unknown) {
        if (!state.cancelled) {
            post({ requestId, type: UMAPWorkerResponseType.ERROR, error: e instanceof Error ? e.message : String(e) });
        }
    } finally {
        umap?.destroy();
        if (active === state) active = null;
    }
}

// eslint-disable-next-line no-restricted-globals
self.onmessage = (event: MessageEvent<UMAPWorkerRequest>) => {
    const req = event.data;
    switch (req.type) {
        case UMAPWorkerRequestType.RUN:
            void run(req.messageId, req);
            break;
        case UMAPWorkerRequestType.CANCEL:
            if (active && active.requestId === req.runId) {
                active.cancelled = true;
            }
            break;
    }
};
