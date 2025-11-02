import NodeEnvironment from "jest-environment-node";

import * as path from 'path';
import * as fs from 'fs';

import { fileURLToPath } from 'node:url';

const distPath = path.resolve(fileURLToPath(new URL('../../dashql-core-api/dist', import.meta.url)));
const wasmPath = path.resolve(distPath, './dashql.wasm');

class WasmEnv extends NodeEnvironment {
    async setup() {
        await super.setup();

        // Precompile the wasm module
        const buf = await fs.promises.readFile(wasmPath);
        const mod = await WebAssembly.compile(buf);

        // Helper to instantiate the wasm module
        this.global.DASHQL_PRECOMPILED = async (imports: WebAssembly.Imports) => {
            const instance = await WebAssembly.instantiate(mod, imports);
            // WebAssembly.instantiate with a precompiled module returns just the instance.
            // WebAssembly.instantiate with a buffer returns the module and instance.
            return { module: mod, instance };
        };
    }
}

export default WasmEnv as any;
