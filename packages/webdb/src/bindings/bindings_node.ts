// Copyright (c) 2020 The DashQL Authors

import WebDBWasm from './webdb_wasm_node.js';
import { WebDBModule } from './webdb_module';
import { WebDBBindings } from './bindings_base';
import { Logger } from '../common';
import fs from 'fs';
import { WebDBRuntime } from './runtime_base';
import { NodeWebDBRuntime, NodeBlobStream } from './runtime_node';

declare global {
    var WebDBTrampoline: any;
}

/** WebDB bindings for node.js */
export class WebDB extends WebDBBindings {
    protected runtime: WebDBRuntime;
    protected path: string;
    public constructor(logger: Logger, runtime: WebDBRuntime, path: string) {
        super(logger);
        this.runtime = runtime;
        this.runtime.bindings = this;
        this.path = path;
    }

    /// Registers the given URL as a file to be possibly loaded by WebDB. Returns the Blob ID
    public registerURL(url: string): Promise<number> {
        let runtime: typeof NodeWebDBRuntime = <typeof NodeWebDBRuntime>this.runtime;
        try {
            const id = runtime.blobMap.length;
            // TODO: This reads the file already, make asynchronous and only on demand
            runtime.blobMap.push(NodeBlobStream.fromFile(url));
            return Promise.resolve(id);
        } catch (error) {
            return Promise.reject(error);
        }
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

    /** Instantiate the bindings */
    protected instantiate(moduleOverrides: Partial<WebDBModule>): Promise<WebDBModule> {
        return WebDBWasm({
            ...moduleOverrides,
            instantiateWasm: this.instantiateWasm.bind(this),
        });
    }
}
