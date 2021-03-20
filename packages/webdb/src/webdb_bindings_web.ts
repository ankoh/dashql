// Copyright (c) 2020 The DashQL Authors

import WebDBWasm from './webdb_wasm.js';
import WebDBModule from './webdb_module';
import { WebDBBindings, BlobStream } from './webdb_bindings';
import { Logger } from './log';
import { DefaultWebDBRuntime, WebDBRuntime } from './webdb_runtime';

declare global {
    var WebDBTrampoline: any;
}

export class WebBlobStream implements BlobStream {
    buffer: Uint8Array;
    position: number;

    public constructor(blob: Blob) {
        const reader = new FileReaderSync();
        this.buffer = new Uint8Array(reader.readAsArrayBuffer(blob));
        this.position = 0;
    }
}

/// WebDB bindings for the browser
export class WebDB extends WebDBBindings {
    protected runtime: WebDBRuntime;
    protected path: string;
    protected _blobs: Map<string, Blob>;

    public constructor(logger: Logger, runtime: WebDBRuntime, path: string) {
        super(logger);
        this.runtime = runtime;
        this.runtime.bindings = this;
        this.path = path;
        this._blobs = new Map<string, Blob>();
    }

    /// Registers the given URL as a file to be possibly loaded by WebDB and fetches the blob.
    public async registerURL(url: string) {
        let blob = await fetch(url).then(r => r.blob());
        this._blobs.set(url, blob);
    }

    /// Get the URLs currently registered.
    public get blobs() {
        return this._blobs;
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

    /// Instantiate the bindings
    protected instantiate(moduleOverrides: Partial<WebDBModule>): Promise<WebDBModule> {
        return WebDBWasm({
            ...moduleOverrides,
            instantiateWasm: this.instantiateWasm.bind(this),
        });
    }
}
