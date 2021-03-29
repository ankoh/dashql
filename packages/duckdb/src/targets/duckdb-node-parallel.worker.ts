// Copyright (c) 2020 The DashQL Authors

import { AsyncDuckDBDispatcher, AsyncDuckDBResponseVariant, AsyncDuckDBRequestVariant } from '../parallel/';
import { DuckDBBindings } from '../bindings';
import { DuckDB } from '../bindings/bindings_node';
import { NodeDuckDBRuntime } from '../bindings/runtime_node';

/** The duckdb worker API for node.js workers */
class NodeWorker extends AsyncDuckDBDispatcher {
    /** Post a response back to the main thread */
    protected postMessage(response: AsyncDuckDBResponseVariant, transfer: ArrayBuffer[]) {
        globalThis.postMessage(response, transfer);
    }

    /** Instantiate the wasm module */
    protected async open(path: string): Promise<DuckDBBindings> {
        const bindings = new DuckDB(this, NodeDuckDBRuntime, path);
        await bindings.open();
        return bindings;
    }
}

/** Register the worker */
export function registerWorker() {
    const api = new NodeWorker();
    globalThis.onmessage = async (event: MessageEvent<AsyncDuckDBRequestVariant>) => {
        await api.onMessage(event.data);
    };
}

registerWorker();
