/// Load a Wasm module next to its glue: its URL, or its bytes in Node, where fetch doesn't take file URLs
export async function loadWasmNextToGlue(url: URL): Promise<Uint8Array | URL> {
    if (url.protocol === 'file:') {
        // The specifier is not static to keep bundlers away
        const fs = 'node:fs/promises';
        const { readFile } = await import(/* @vite-ignore */ fs);
        return new Uint8Array(await readFile(url));
    }
    return url;
}
