// Copyright (c) 2020 The DashQL Authors

import DuckDBWasm from './duckdb_wasm_node.js';
import { DuckDBModule } from './duckdb_module';
import { DuckDBBindings } from './bindings';
import { Logger } from '../log';
import fs from 'fs';
import { DuckDBRuntime } from './runtime_base';

declare global {
    var DuckDBTrampoline: any;
}

/** DuckDB bindings for node.js */
export class DuckDB extends DuckDBBindings {
    protected path: string;
    public constructor(logger: Logger, runtime: DuckDBRuntime, path: string) {
        super(logger, runtime);
        this.path = path;
    }

    /// Registers the given URL as a file to be possibly loaded by DuckDB. Returns the Blob ID
    public registerURL(url: string): Promise<void> {
        return Promise.resolve(
            this._runtime.duckdb_web_add_handle(url, {
                url: url,
                handle: fs.openSync(url, 'r'),
                stat: fs.statSync(url),
            }),
        );
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

            for (let func of Object.getOwnPropertyNames(this._runtime)) {
                if (func == 'constructor') continue;
                globalThis.DuckDBTrampoline[func] = <Function>(
                    Object.getOwnPropertyDescriptor(this._runtime, func)!.value
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
