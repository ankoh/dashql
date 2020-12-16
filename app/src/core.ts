import { DashQLCoreWasm, DashQLCoreWasmRuntime } from '@dashql/core';
import dashql_core_wasm from '@dashql/core/dist/dashql_core.wasm';

const CORE_WASM_RUNTIME: DashQLCoreWasmRuntime = {
    dashql_pong() { console.log("le pong"); return 21; },
    dashql_blob_stream_underflow: () => { return 0; }
}

export function createCore(): DashQLCoreWasm {
    return new DashQLCoreWasm(CORE_WASM_RUNTIME, dashql_core_wasm);
}
