let wasmBinary: Promise<Uint8Array> | undefined;

export function loadCoreWasm(): Promise<Uint8Array> {
    return wasmBinary ??= (async () => {
        const url = new URL('./wasm/dashql_core.wasm', import.meta.url);
        if (url.protocol === 'file:') {
            const { readFile } = await import('node:fs/promises');
            return new Uint8Array(await readFile(url));
        }
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load Core Wasm: ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
    })();
}

let dataflowWasmBinary: Promise<Uint8Array> | undefined;

export function loadDataflowWasm(): Promise<Uint8Array> {
    return dataflowWasmBinary ??= (async () => {
        const url = new URL('./wasm/dashql_dataflow.wasm', import.meta.url);
        if (url.protocol === 'file:') {
            const { readFile } = await import('node:fs/promises');
            return new Uint8Array(await readFile(url));
        }
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load Dataflow Wasm: ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
    })();
}
