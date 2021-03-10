// Copyright (c) 2020 The DashQL Authors

import webdb_api_wasm from './webdb_wasm_node.wasm';
import webdb_api_init from './webdb_wasm_node.js';
import { WebDBModule } from './webdb_module';
import { WebDBBindings, WebDBRuntime, DefaultWebDBRuntime, BlobStream } from './webdb_bindings';
import { Logger } from './log';
import fs from 'fs';

export class NodeBlobStream extends BlobStream {
    public constructor(file: string) {
        super(new Uint8Array(fs.readFileSync(file)));
    }
}

/// WebDB bindings for node.js
export class WebDB extends WebDBBindings {
    protected runtime: WebDBRuntime;
    protected path: string;

    public constructor(logger: Logger, runtime: WebDBRuntime = new DefaultWebDBRuntime(), path: string | null = null) {
        super(logger);
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
