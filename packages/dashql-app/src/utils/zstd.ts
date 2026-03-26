import * as zstd from "@bokuweb/zstd-wasm";

let CALLED_INIT = false;

export async function init(): Promise<void> {
    if (CALLED_INIT) {
        return;
    }
    await zstd.init();
    CALLED_INIT = true;
}

export const compress = zstd.compress;
export const decompress = zstd.decompress;
