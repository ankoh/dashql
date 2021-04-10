// Copyright (c) 2020 The DashQL Authors

import DuckDBWasm from './duckdb_wasm.js';
import { DuckDBModule } from './duckdb_module';
import { DuckDBBindings } from './bindings';
import { Logger } from '../log';
import { DuckDBRuntime } from './runtime_base';

declare global {
    var DuckDBTrampoline: any;
}

/** DuckDB bindings for the browser */
export class DuckDB extends DuckDBBindings {
    protected runtime: DuckDBRuntime;
    protected path: string;

    public constructor(logger: Logger, runtime: DuckDBRuntime, path: string) {
        super(logger);
        this.runtime = runtime;
        this.runtime.bindings = this;
        this.path = path;
    }

    /// Registers the given URL as a file to be possibly loaded by DuckDB.
    public registerURL(url: string): Promise<void> {
        return fetch(url)
            .then(r => r.blob())
            .then(b => this.runtime.duckdb_web_add_blob_handle({ url: url, blob: b }));
    }

    /// Open a file previously registered by the given URL. Returns the Blob ID
    public openURL(url: string): number {
        return this.runtime.duckdb_web_blob_stream_open(url);
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
                globalThis.DuckDBTrampoline = {};

                for (let func of Object.getOwnPropertyNames(this.runtime)) {
                    if (func == 'constructor') continue;
                    globalThis.DuckDBTrampoline[func] = <Function>(
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
                        globalThis.DuckDBTrampoline = {};

                        for (let func of Object.getOwnPropertyNames(this.runtime)) {
                            if (func == 'constructor') continue;
                            globalThis.DuckDBTrampoline[func] = <Function>(
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
    protected instantiate(moduleOverrides: Partial<DuckDBModule>): Promise<DuckDBModule> {
        return DuckDBWasm({
            ...moduleOverrides,
            instantiateWasm: this.instantiateWasm.bind(this),
        });
    }
}
