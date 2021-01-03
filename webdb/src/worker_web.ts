// Copyright (c) 2020 The DashQL Authors

import { WorkerAPI, WorkerAPIRequest, WorkerAPIResponse } from './worker_api';
import { WebDBBindings } from './webdb_bindings';
import { WebDB } from './webdb_bindings_web';

/// The webdb worker API for web workers
class WebWorkerAPI extends WorkerAPI {
    /// Post a response back to the main thread
    protected postMessage(response: WorkerAPIResponse) {
        self.postMessage(response);
    }

    /// Instantiate the wasm module
    protected async open(path: string | null): Promise<WebDBBindings> {
        const bindings = new WebDB({}, path);
        await bindings.open();
        return bindings;
    }
}

/// Forward all requests
const api = new WebWorkerAPI();
self.onmessage = function(event: MessageEvent<WorkerAPIRequest>) {
    api.onMessage(event.data);
};
