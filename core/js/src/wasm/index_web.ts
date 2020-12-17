// Copyright (c) 2020 The DashQL Authors

export * from "./bindings";
export * from "./core_wasm_module";

import dashql_core_wasm from './core_wasm_web.wasm';
import dashql_core_init from './core_wasm_web.js';
import { DashQLCoreModule } from './core_wasm_module';
import { CoreWasmBindings, CoreWasmRuntime, CORE_WASM_RUNTIME_STUBS } from './bindings';

export class DashQLCoreWasm extends CoreWasmBindings {
    protected runtime: CoreWasmRuntime;
    protected path: string;

    public constructor(runtime: CoreWasmRuntime = CORE_WASM_RUNTIME_STUBS, path: string | null = null) {
        super();
        this.runtime = runtime;
        this.path = path ?? dashql_core_wasm;
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

    protected instantiate(moduleOverrides: Partial<DashQLCoreModule>): Promise<DashQLCoreModule> {
        return dashql_core_init({
            ...moduleOverrides,
            instantiateWasm: this.instantiateWasm.bind(this),
            locateFile: (path: string) => {
                if (path.endsWith('dashql_core_node.wasm'))
                    return this.path;
                return path;
            }
        });
    }
}
