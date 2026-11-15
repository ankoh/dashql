import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as core from '@ankoh/dashql-core';

import { setWorkbookFormatCoreLoader } from '../storage/workbook_format.js';

/// The Wasm of the core, the file next to the package of the core
export async function readDashQLCoreWasm(): Promise<Uint8Array> {
    const require = createRequire(import.meta.url);
    return new Uint8Array(await readFile(require.resolve('@ankoh/dashql-core/wasm')));
}

/// Instantiate the core once, every caller gets the same instance. The workbook format instantiates it too when it
/// needs the core first, e.g. to migrate a workbook folder.
export function createDashQLCoreSetup(): (context: string) => Promise<core.DashQL> {
    let instance: Promise<core.DashQL> | null = null;
    const setup = () => {
        instance ??= readDashQLCoreWasm().then(wasmBinary => core.DashQL.create({ wasmBinary }));
        return instance;
    };
    setWorkbookFormatCoreLoader(setup);
    return setup;
}
