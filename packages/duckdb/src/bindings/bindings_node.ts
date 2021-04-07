// Copyright (c) 2020 The DashQL Authors

import DuckDBWasm from './duckdb_wasm_node.js';
import { DuckDBModule } from './duckdb_module';
import { DuckDBBindings } from './bindings';
import { Logger } from '../log';
import fs from 'fs';
import { DuckDBRuntime } from './runtime_base';
import { NodeBlobHandle } from './runtime_node';

declare global {
    var DuckDBTrampoline: any;
}

/** DuckDB bindings for node.js */
export class DuckDB extends DuckDBBindings {
    protected runtime: DuckDBRuntime;
    protected path: string;
    public constructor(logger: Logger, runtime: DuckDBRuntime, path: string) {
        super(logger);
        this.runtime = runtime;
        this.runtime.bindings = this;
        this.path = path;
    }

    /// Registers the given URL as a file to be possibly loaded by DuckDB. Returns the Blob ID
    public registerURL(url: string): Promise<void> {
        return Promise.resolve(this.runtime.duckdb_web_add_blob_handle(new NodeBlobHandle(url)));
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
            },
        };
        const buf = fs.readFileSync(this.path);
        WebAssembly.instantiate(buf, imports_rt).then(output => {
            let module = output.instance;

            globalThis.DuckDBTrampoline = {};

            for (let func of Object.getOwnPropertyNames(this.runtime)) {
                if (func == 'constructor') continue;
                globalThis.DuckDBTrampoline[func] = <Function>(
                    Object.getOwnPropertyDescriptor(this.runtime, func)!.value
                );
            }
            success(module);
        });
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
