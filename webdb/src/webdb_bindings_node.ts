// Copyright (c) 2020 The DashQL Authors

import webdb_api_wasm from './webdb_wasm_node.wasm';
import webdb_api_init from './webdb_wasm_node.js';
import { WebDBModule } from './webdb_module';
import { WebDBBindings, WebDBRuntime, DefaultWebDBRuntime, BlobStream } from './webdb_bindings';
import { Logger } from './log';
import fs from 'fs';

export class NodeBlobStream implements BlobStream {
    buffer: Uint8Array;
    position: number;

    public constructor(file: string) {
        this.buffer = new Uint8Array(fs.readFileSync(file));
        this.position = 0;
    }
}

declare global {
    var WebDBTrampoline: any;
}

/// WebDB bindings for node.js
export class WebDB extends WebDBBindings {
    protected runtime: WebDBRuntime;
    protected path: string;

    public constructor(logger: Logger, runtime: WebDBRuntime = DefaultWebDBRuntime, path: string | null = null) {
        super(logger);
        this.runtime = runtime;
        this.runtime.bindings = this;
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
            },
        };
        const buf = fs.readFileSync(this.path);
        WebAssembly.instantiate(buf, imports_rt).then(output => {
            let module = output.instance;

            var global: any = typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};
            global.WebDBTrampoline = {};

            for (let func of Object.getOwnPropertyNames(this.runtime)) {
                if (func == 'constructor') continue;
                global.WebDBTrampoline[func] = <Function>Object.getOwnPropertyDescriptor(this.runtime, func)!.value;
            }
            success(module);
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
