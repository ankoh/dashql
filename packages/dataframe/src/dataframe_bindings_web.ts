// Copyright (c) 2020 The DashQL Authors

import dataframe_api_wasm from './dataframe_wasm.wasm';
import dataframe_api_init from './dataframe_wasm.js';
import { DataframeModule } from './dataframe_module';
import { DataframeBindings } from './dataframe_bindings';
import { Logger } from './log';

/// Dataframe bindings for the browser
export class Dataframe extends DataframeBindings {
    protected path: string;

    public constructor(logger: Logger, path: string | null = null) {
        super(logger);
        this.path = path ?? dataframe_api_wasm;
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
        if (WebAssembly.instantiateStreaming) {
            WebAssembly.instantiateStreaming(fetch(this.path), imports_rt).then(output => {
                success(output.instance);
            });
        } else {
            fetch(this.path)
                .then(resp => resp.arrayBuffer())
                .then(bytes =>
                    WebAssembly.instantiate(bytes, imports_rt).then(output => {
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
    protected instantiate(moduleOverrides: Partial<DataframeModule>): Promise<DataframeModule> {
        return dataframe_api_init({
            ...moduleOverrides,
            instantiateWasm: this.instantiateWasm.bind(this),
        });
    }
}
