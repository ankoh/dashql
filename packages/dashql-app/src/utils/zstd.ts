import * as zstd from "@bokuweb/zstd-wasm";
import zstdWasmUrl from "@bokuweb/zstd-wasm/dist/web/zstd.wasm?url";

let CALLED_INIT = false;

export async function init(): Promise<void> {
    if (CALLED_INIT) {
        return;
    }
    // @ts-expect-error -- TS resolves node export (no args); browser export accepts (path?: string)
    await zstd.init(typeof zstdWasmUrl === 'string' ? zstdWasmUrl : undefined);
    CALLED_INIT = true;
}

export const compress = zstd.compress;
export const decompress = zstd.decompress;
