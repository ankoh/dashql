// Copyright (c) 2020 The DashQL Authors

export * from "./core_wasm_bindings";
export * from "./core_wasm_module";

import dashql_core_wasm from './core_wasm_node.wasm';
import dashql_core_init from './core_wasm_node.js';
import { DashQLCoreModule } from './core_wasm_module';
import { DashQLCoreWasmBindings, DashQLCoreWasmRuntime, DASHQL_CORE_WASM_RUNTIME_STUBS } from './core_wasm_bindings';
import fs from 'fs';

export class DashQLCoreWasm extends DashQLCoreWasmBindings {
    protected runtime: DashQLCoreWasmRuntime;
    protected path: string;

    public constructor(runtime: DashQLCoreWasmRuntime = DASHQL_CORE_WASM_RUNTIME_STUBS, path: string | null = null) {
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
        const buf = fs.readFileSync(this.path);
        WebAssembly.instantiate(buf, imports_rt).then((output) => {
            success(output.instance);
        });
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
