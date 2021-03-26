// Copyright (c) 2020 The DashQL Authors

import WebDBWasm from './webdb_wasm.js';
import { WebDBModule } from './webdb_module';
import { WebDBBindings } from './bindings_base';
import { Logger } from '../common';
import { WebDBRuntime } from './runtime_base';
import { WebBlobHandle } from 'src/targets/webdb-browser-serial.js';

declare global {
    var WebDBTrampoline: any;
}

/** WebDB bindings for the browser */
export class WebDB extends WebDBBindings {
    protected runtime: WebDBRuntime;
    protected path: string;

    public constructor(logger: Logger, runtime: WebDBRuntime, path: string) {
        super(logger);
        this.runtime = runtime;
        this.runtime.bindings = this;
        this.path = path;
    }

    /// Registers the given URL as a file to be possibly loaded by WebDB.
    public registerURL(url: string): Promise<void> {
        return fetch(url)
            .then(r => r.blob())
            .then(b => this.runtime.dashql_add_blob_handle(new WebBlobHandle(b, url)));
    }

    /// Open a file previously registered by the given URL. Returns the Blob ID
    public openURL(url: string): number {
        return this.runtime.dashql_blob_stream_open(url);
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
        if (WebAssembly.instantiateStreaming) {
            WebAssembly.instantiateStreaming(fetch(this.path), imports_rt).then(output => {
                globalThis.WebDBTrampoline = {};

                for (let func of Object.getOwnPropertyNames(this.runtime)) {
                    if (func == 'constructor') continue;
                    globalThis.WebDBTrampoline[func] = <Function>(
                        Object.getOwnPropertyDescriptor(this.runtime, func)!.value
                    );
                }
                success(output.instance);
            });
        } else {
            fetch(this.path)
                .then(resp => resp.arrayBuffer())
                .then(bytes =>
                    WebAssembly.instantiate(bytes, imports_rt).then(output => {
                        globalThis.WebDBTrampoline = {};

                        for (let func of Object.getOwnPropertyNames(this.runtime)) {
                            if (func == 'constructor') continue;
                            globalThis.WebDBTrampoline[func] = <Function>(
                                Object.getOwnPropertyDescriptor(this.runtime, func)!.value
                            );
                        }
                        success(output.instance);
                    }),
                )
                .catch(error => {
                    console.error('Failed to instantiate WASM:', error);
                });
        }
        return [];
    }

    /** Instantiate the bindings */
    protected instantiate(moduleOverrides: Partial<WebDBModule>): Promise<WebDBModule> {
        return WebDBWasm({
            ...moduleOverrides,
            instantiateWasm: this.instantiateWasm.bind(this),
        });
    }
}
