// Copyright (c) 2020 The DashQL Authors

import { AsyncWebDBDispatcher, AsyncWebDBResponseVariant, AsyncWebDBRequestVariant } from '../parallel/';
import { WebDBBindings } from '../bindings';
import { WebDB } from '../bindings/bindings_node';
import { NodeWebDBRuntime } from '../bindings/runtime_node';

/** The webdb worker API for node.js workers */
class NodeWorker extends AsyncWebDBDispatcher {
    /** Post a response back to the main thread */
    protected postMessage(response: AsyncWebDBResponseVariant, transfer: ArrayBuffer[]) {
        globalThis.postMessage(response, transfer);
    }

    /** Instantiate the wasm module */
    protected async open(path: string): Promise<WebDBBindings> {
        const bindings = new WebDB(this, NodeWebDBRuntime, path);
        await bindings.open();
        return bindings;
    }
}

/** Register the worker */
export function registerWorker() {
    const api = new NodeWorker();
    globalThis.onmessage = async (event: MessageEvent<AsyncWebDBRequestVariant>) => {
        await api.onMessage(event.data);
    };
}

registerWorker();
