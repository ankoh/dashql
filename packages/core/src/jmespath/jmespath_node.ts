// Copyright (c) 2020 The DashQL Authors

import '../utils/emscripten_node_es6';
import jmespath_init from './jmespath_wasm';
import { JMESPathModule } from './jmespath_wasm_module';
import { JMESPathBindings } from './jmespath_bindings';
import fs from 'fs';

export class JMESPath extends JMESPathBindings {
    protected path: string;

    public constructor(path: string) {
        super();
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
            },
        };
        const buf = fs.readFileSync(this.path);
        WebAssembly.instantiate(buf, imports_rt).then(output => {
            success(output.instance);
        });
        return [];
    }

    protected instantiate(moduleOverrides: Partial<JMESPathModule>): Promise<JMESPathModule> {
        return jmespath_init({
            ...moduleOverrides,
            instantiateWasm: this.instantiateWasm.bind(this),
            locateFile: this.locateFile.bind(this),
        });
    }
}
