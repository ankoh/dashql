// Copyright (c) 2020 The DashQL Authors

import dataframe_api_wasm from './dataframe_wasm_node.wasm';
import dataframe_api_init from './dataframe_wasm_node.js';
import { DataframeModule } from './dataframe_module';
import { DataframeBindings } from './dataframe_bindings';
import { Logger } from './log';
import fs from 'fs';

/// Dataframe bindings for node.js
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
        const buf = fs.readFileSync(this.path);
        WebAssembly.instantiate(buf, imports_rt).then(output => {
            success(output.instance);
        });
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
