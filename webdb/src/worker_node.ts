// Copyright (c) 2020 The DashQL Authors

export * from './iterator';
export * from './value';
export * from './webdb_bindings';

import webdb_api_wasm from './webdb_wasm_node.wasm';
import webdb_api_init from './webdb_wasm_node.js';
import { WorkerAPI, WorkerAPIRequest, WorkerAPIResponse } from './worker_api';
import { WebDBModule } from './webdb_module';
import { WebDBBindings, WebDBRuntime } from './webdb_bindings';
import fs from 'fs';

/// WebDB bindings for node.js
export class WebDB extends WebDBBindings {
    protected runtime: WebDBRuntime;
    protected path: string;

    public constructor(runtime: WebDBRuntime = {}, path: string | null = null) {
        super();
        this.runtime = runtime;
        this.path = path ?? webdb_api_wasm;
    }

    /// Instantiate the wasm module
    protected instantiateWasm(
        imports: any,
        success: (module: WebAssembly.Module) => void,
    ): Emscripten.WebAssemblyExports {
        const imports_rt: WebAssembly.Imports = {
            ...imports,
            env: {
                ...imports.env,
                ...this.runtime,
            },
        };
        const buf = fs.readFileSync(this.path);
        WebAssembly.instantiate(buf, imports_rt).then(output => {
            success(output.instance);
        });
        return [];
    }

    /// Instantiate the bindings
    protected instantiate(moduleOverrides: Partial<WebDBModule>): Promise<WebDBModule> {
        return webdb_api_init({
            ...moduleOverrides,
            instantiateWasm: this.instantiateWasm.bind(this),
        });
    }
}

/// The webdb worker API for node.js workers
class NodeWorkerAPI extends WorkerAPI {
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
const api = new NodeWorkerAPI();
self.onmessage = function(event: MessageEvent<WorkerAPIRequest>) {
    api.onMessage(event.data);
};
