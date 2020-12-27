// Copyright (c) 2020 The DashQL Authors

export * from "./bindings";
export * from "./analyzer_wasm_module";

import dashql_analyzer_wasm from './analyzer_wasm.wasm';
import dashql_core_init from './analyzer_wasm.js';
import { DashQLAnalyzerModule } from './analyzer_wasm_module';
import { AnalyzerBindings, AnalyzerRuntime } from './bindings';

export class Analyzer extends AnalyzerBindings {
    protected runtime: AnalyzerRuntime;
    protected path: string;

    public constructor(runtime: AnalyzerRuntime = {}, path: string | null = null) {
        super();
        this.runtime = runtime;
        this.path = path ?? dashql_analyzer_wasm;
    }

    protected instantiateWasm(imports: any, success: (module: WebAssembly.Module) => void): Emscripten.WebAssemblyExports {
        const imports_rt: WebAssembly.Imports = {
            ...imports,
            env: {
                ...imports.env,
                ...this.runtime
            }
        };
        if (WebAssembly.instantiateStreaming) {
            WebAssembly.instantiateStreaming(fetch(this.path), imports_rt).then((output) => {
                success(output.instance);
            });
        } else {
            fetch(this.path)
                .then(resp => resp.arrayBuffer())
                .then(bytes =>
                    WebAssembly.instantiate(bytes, imports_rt).then((output) => {
                        success(output.instance);
                    })
                )
                .catch((error) => {
                    console.error('Failed to instantiate WASM:', error);
                });
        }
        return [];
    }

    protected instantiate(moduleOverrides: Partial<DashQLAnalyzerModule>): Promise<DashQLAnalyzerModule> {
        return dashql_core_init({
            ...moduleOverrides,
            instantiateWasm: this.instantiateWasm.bind(this)
        });
    }
}
