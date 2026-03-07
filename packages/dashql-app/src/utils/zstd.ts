import * as zstd from "@bokuweb/zstd-wasm";
import zstdWasmUrl from "@bokuweb/zstd-wasm/dist/web/zstd.wasm?url";

const ZSTD_WASM = zstdWasmUrl;

let CALLED_INIT = false;

export async function init(): Promise<void> {
    if (CALLED_INIT) {
        return;
    }
    await zstd.init(ZSTD_WASM.toString());
    CALLED_INIT = true;
}

export const compress = zstd.compress;
export const decompress = zstd.decompress;
