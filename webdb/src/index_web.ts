// Copyright (c) 2020 The DashQL Authors

export * from "./iterator";
export * from "./value";
export * from "./webdb_bindings";
export * from "./webdb_buffer";

import webdb_api_wasm from './webdb_wasm.wasm';
import webdb_api_init from './webdb_wasm.js';
import { WebDBModule } from './webdb_module';
import { WebDBBindings, WebDBRuntime } from './webdb_bindings';

export class WebDB extends WebDBBindings {
    protected runtime: WebDBRuntime;
    protected path: string;

    public constructor(runtime: WebDBRuntime = {}, path: string | null = null) {
        super();
        this.runtime = runtime;
        this.path = path ?? webdb_api_wasm;
    }

    protected instantiateWasm(imports: any, success: (module: WebAssembly.Module) => void): Emscripten.WebAssemblyExports {
        const imports_rt: WebAssembly.Imports = {
            ...imports,
            env: {
                ...imports.env,
                ...this.runtime
            }
        };
        if (WebAssembly.instantiateStreaming) {
            WebAssembly.instantiateStreaming(fetch(this.path), imports_rt).then((output) => {
                success(output.instance);
            });
        } else {
            fetch(this.path)
                .then(resp => resp.arrayBuffer())
                .then(bytes =>
                    WebAssembly.instantiate(bytes, imports_rt).then((output) => {
                        success(output.instance);
                    })
                )
                .catch((error) => {
                    console.error('Failed to instantiate WASM:', error);
                });
        }
        return [];
    }

    protected instantiate(moduleOverrides: Partial<WebDBModule>): Promise<WebDBModule> {
        return webdb_api_init({
            ...moduleOverrides,
            instantiateWasm: this.instantiateWasm.bind(this)
        });
    }
}
