// Copyright (c) 2020 The DashQL Authors

import { AsyncWebDBDispatcher } from './async_webdb_dispatcher';
import { AsyncWebDBResponse, AsyncWebDBRequest } from './async_webdb_message';
import { WebDBBindings } from './webdb_bindings';
import { WebDB } from './webdb_bindings_web';

/// The webdb worker API for web workers
class WebWorker extends AsyncWebDBDispatcher {
    /// Post a response back to the main thread
    protected postMessage(response: AsyncWebDBResponse, transfer: ArrayBuffer[]) {
        self.postMessage(response, transfer);
    }

    /// Instantiate the wasm module
    protected async open(path: string | null): Promise<WebDBBindings> {
        const bindings = new WebDB({}, path);
        await bindings.open();
        return bindings;
    }
}

/// Forward all requests
const api = new WebWorker();
self.onmessage = function(event: MessageEvent<AsyncWebDBRequest>) {
    api.onMessage(event.data);
};
