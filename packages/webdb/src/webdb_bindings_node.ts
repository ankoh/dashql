// Copyright (c) 2020 The DashQL Authors

import WebDBWasm from './webdb_wasm_node';
import WebDBModule from './webdb_module';
import { WebDBBindings, BlobStream } from './webdb_bindings';
import { Logger } from './log';
import fs from 'fs';
import { DefaultWebDBRuntime, WebDBRuntime } from './webdb_runtime';

export class NodeBlobStream implements BlobStream {
    buffer: Uint8Array;
    position: number;
    path: string | null;

    public constructor(buffer: Uint8Array) {
        this.buffer = buffer;
        this.position = 0;
        this.path = null;
    }

    public static fromFile(file: string): NodeBlobStream {
        let stream = new NodeBlobStream(new Uint8Array(fs.readFileSync(file)));
        stream.path = file;
        return stream;
    }
}

declare global {
    var WebDBTrampoline: any;
}

/// WebDB bindings for node.js
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
    public registerURL(url: string): Promise<null> {
        // For node we can fetch any file using the file system, so explicit registration of files is not needed.
        return Promise.resolve(null);
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

            globalThis.WebDBTrampoline = {};
            for (let func of Object.getOwnPropertyNames(this.runtime)) {
                if (func == 'constructor') continue;
                globalThis.WebDBTrampoline[func] = <Function>Object.getOwnPropertyDescriptor(this.runtime, func)!.value;
            }
            success(module);
        });
        return [];
    }

    /// Instantiate the bindings
    protected instantiate(moduleOverrides: Partial<WebDBModule>): Promise<WebDBModule> {
        return WebDBWasm({
            ...moduleOverrides,
            instantiateWasm: this.instantiateWasm.bind(this),
        });
    }
}
