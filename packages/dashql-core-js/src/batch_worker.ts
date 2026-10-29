const coreWasmUrl = new URL('./wasm/dashql_core.wasm', import.meta.url);

import { DashQL, getCorePanic } from './api.js';
import type { BatchWorkerRequest, BatchWorkerResponse } from './batch_worker_protocol.js';

// Only the module survives between jobs. Native scripts and catalogs are job-local.
let core: Promise<DashQL> | undefined;
let queue = Promise.resolve();

self.onmessage = (event: MessageEvent<BatchWorkerRequest>) => {
    const { requestId, request } = event.data;
    queue = queue.then(async () => {
        try {
            core ??= fetch(coreWasmUrl).then(async response => {
                if (!response.ok) throw new Error(`Failed to fetch Core Wasm: ${response.status}`);
                return DashQL.create({ wasmBinary: new Uint8Array(await response.arrayBuffer()) });
            }).catch(error => {
                core = undefined;
                throw error;
            });
            const result = (await core).processBatch(request);
            const transfer: Transferable[] = [];
            for (const script of result.scripts) {
                for (const bytes of [script.scanned, script.parsed, script.analyzed, script.catalogDescriptor]) {
                    if (bytes) transfer.push(bytes.buffer as ArrayBuffer);
                }
            }
            const response: BatchWorkerResponse = { requestId, result };
            (self as unknown as Worker).postMessage(response, transfer);
        } catch (error) {
            // After a panic the module is unusable, the client replaces the worker
            const panic = getCorePanic();
            const response: BatchWorkerResponse = panic != null
                ? { requestId, error: `Core panicked: ${panic}`, fatal: true }
                : { requestId, error: error instanceof Error ? error.message : String(error) };
            (self as unknown as Worker).postMessage(response);
        }
    });
};
