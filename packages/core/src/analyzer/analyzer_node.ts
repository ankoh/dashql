// Copyright (c) 2020 The DashQL Authors

import analyzer_init from './analyzer_wasm';
import { DashQLAnalyzerModule } from './analyzer_wasm_module';
import { AnalyzerBindings, AnalyzerRuntime } from './analyzer_bindings';
import fs from 'fs';

export class Analyzer extends AnalyzerBindings {
    protected runtime: AnalyzerRuntime;
    protected path: string;

    public constructor(runtime: AnalyzerRuntime, path: string) {
        super();
        this.runtime = runtime;
        this.path = path;
    }

    /** Locate a file */
    protected locateFile(path: string, prefix: string): string {
        if (path.endsWith('.wasm')) {
            return this.path;
        }
        throw new Error(`WASM instantiation requested unexpected file: prefix=${prefix} path=${path}`);
    }

    protected instantiateWasm(
        // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
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
        return analyzer_init({
            ...moduleOverrides,
            instantiateWasm: this.instantiateWasm.bind(this),
            locateFile: this.locateFile.bind(this),
        });
    }
}
