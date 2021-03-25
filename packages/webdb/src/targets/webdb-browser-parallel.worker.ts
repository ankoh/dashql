// Copyright (c) 2020 The DashQL Authors

import { AsyncWebDBDispatcher, AsyncWebDBResponseVariant, AsyncWebDBRequestVariant } from '../parallel';
import { WebDB } from '../bindings/bindings_browser';
import { WebDBBindings } from '../bindings';
import { BrowserWebDBRuntime } from '../bindings/runtime_browser';

/** The webdb worker API for web workers */
class WebWorker extends AsyncWebDBDispatcher {
    /** Post a response back to the main thread */
    protected postMessage(response: AsyncWebDBResponseVariant, transfer: ArrayBuffer[]) {
        try {
            globalThis.postMessage(response, transfer);
        } catch (error) {
            throw Error(error);
        }
    }

    /** Instantiate the wasm module */
    protected async open(path: string): Promise<WebDBBindings> {
        const bindings = new WebDB(this, BrowserWebDBRuntime, path);
        await bindings.open();
        return bindings;
    }
}

/** Register the worker */
export function registerWorker() {
    const api = new WebWorker();
    globalThis.onmessage = async (event: MessageEvent<AsyncWebDBRequestVariant>) => {
        await api.onMessage(event.data);
    };
}

registerWorker();
