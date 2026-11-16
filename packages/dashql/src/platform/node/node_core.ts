import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as core from '../../core/index.js';

/// The Wasm of the core, the file next to the package of the core
export async function readDashQLCoreWasm(): Promise<Uint8Array> {
    const require = createRequire(import.meta.url);
    return new Uint8Array(await readFile(require.resolve('@akohn/dashql/wasm')));
}

/// Instantiate the core once, every caller gets the same instance
export function createDashQLCoreSetup(): (context: string) => Promise<core.DashQL> {
    let instance: Promise<core.DashQL> | null = null;
    return () => {
        instance ??= readDashQLCoreWasm().then(wasmBinary => core.DashQL.create({ wasmBinary }));
        return instance;
    };
}
