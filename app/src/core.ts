import { DashQLCore, DashQLCoreRuntime } from '@dashql/core';
import dashql_core_wasm from '@dashql/core/dist/dashql_core.wasm';

const CORE_RUNTIME: DashQLCoreRuntime = {
    dashql_pong() { console.log("le pong"); return 21; },
    dashql_blob_stream_underflow: () => { return 0; }
}

export function createCore(): DashQLCore {
    return new DashQLCore(CORE_RUNTIME, dashql_core_wasm);
}
