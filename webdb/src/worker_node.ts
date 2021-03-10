// Copyright (c) 2020 The DashQL Authors

import { AsyncWebDBDispatcher } from './async_webdb_dispatcher';
import { AsyncWebDBResponseVariant, AsyncWebDBRequestVariant } from './async_webdb_message';
import { WebDBBindings, copyBlobStreamTo } from './webdb_bindings';
import { WebDB } from './webdb_bindings_node';

/// The webdb worker API for node.js workers
class NodeWorker extends AsyncWebDBDispatcher {
    /// Post a response back to the main thread
    protected postMessage(response: AsyncWebDBResponseVariant, transfer: ArrayBuffer[]) {
        globalThis.postMessage(response, transfer);
    }

    /// Instantiate the wasm module
    protected async open(path: string | null): Promise<WebDBBindings> {
        const bindings = new WebDB(
            this,
            {
                dashql_blob_stream_underflow: function (blobId: number, buf: number, size: number): number {
                    let blobStream = bindings.getBlobStreamById(blobId);
                    if (blobStream === undefined) return 0;
                    return copyBlobStreamTo(blobStream, bindings.instance!.HEAPU8, buf, size);
                },
            },
            path,
        );
        await bindings.open();
        return bindings;
    }
}

/// Register the worker
export function registerWorker() {
    const api = new NodeWorker();
    globalThis.onmessage = async (event: MessageEvent<AsyncWebDBRequestVariant>) => {
        await api.onMessage(event.data);
    };
}

registerWorker();
