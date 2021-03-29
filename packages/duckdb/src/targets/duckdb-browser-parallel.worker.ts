// Copyright (c) 2020 The DashQL Authors

import { AsyncDuckDBDispatcher, AsyncDuckDBResponseVariant, AsyncDuckDBRequestVariant } from '../parallel';
import { DuckDB } from '../bindings/bindings_browser';
import { DuckDBBindings } from '../bindings';
import { BrowserDuckDBRuntime } from '../bindings/runtime_browser';

/** The duckdb worker API for web workers */
class WebWorker extends AsyncDuckDBDispatcher {
    /** Post a response back to the main thread */
    protected postMessage(response: AsyncDuckDBResponseVariant, transfer: ArrayBuffer[]) {
        globalThis.postMessage(response, transfer);
    }

    /** Instantiate the wasm module */
    protected async open(path: string): Promise<DuckDBBindings> {
        const bindings = new DuckDB(this, BrowserDuckDBRuntime, path);
        await bindings.open();
        return bindings;
    }
}

/** Register the worker */
export function registerWorker() {
    const api = new WebWorker();
    globalThis.onmessage = async (event: MessageEvent<AsyncDuckDBRequestVariant>) => {
        await api.onMessage(event.data);
    };
}

registerWorker();
