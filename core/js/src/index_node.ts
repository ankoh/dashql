// Copyright (c) 2020 The DashQL Authors

export * as proto from "@dashql/proto";
export * as actions from "./actions";
export * as error from "./error";
export * as model from "./model";
export * as utils from "./utils";
export * from "./core_bindings";

import dashql_core_wasm from './wasm/core_node.wasm';
import dashql_core_init from './wasm/core_node.js';
import { DashQLCoreModule } from './wasm/core_module';
import { DashQLCoreBindings, DashQLCoreRuntime, DASHQL_CORE_RUNTIME_STUBS } from './core_bindings';
import fs from 'fs';

export class DashQLCore extends DashQLCoreBindings {
    protected runtime: DashQLCoreRuntime;
    protected path: string;

    public constructor(runtime: DashQLCoreRuntime = DASHQL_CORE_RUNTIME_STUBS, path: string | null = null) {
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
