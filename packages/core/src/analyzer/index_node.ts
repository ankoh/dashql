// Copyright (c) 2020 The DashQL Authors

export * from './bindings';
export * from './analyzer_wasm_module';

import dashql_core_init from './analyzer_wasm_node.js';
import { DashQLAnalyzerModule } from './analyzer_wasm_module';
import { AnalyzerBindings, AnalyzerRuntime } from './bindings';
import fs from 'fs';

export class Analyzer extends AnalyzerBindings {
    protected runtime: AnalyzerRuntime;
    protected path: string;

    public constructor(runtime: AnalyzerRuntime, path: string) {
        super();
        this.runtime = runtime;
        this.path = path;
    }

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

    protected instantiate(moduleOverrides: Partial<DashQLAnalyzerModule>): Promise<DashQLAnalyzerModule> {
        return dashql_core_init({
            ...moduleOverrides,
            instantiateWasm: this.instantiateWasm.bind(this),
        });
    }
}
