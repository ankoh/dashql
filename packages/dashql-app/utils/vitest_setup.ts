/**
 * Vitest setup: jsdom-like globals and precompiled DashQL Core WASM for tests.
 * Replaces the former Jest custom environment (env/wasm_env.ts).
 */
import * as path from "node:path";
import * as fs from "node:fs";

// Ensure globals needed by app code and jsdom are available (Node 18+ has most)
const g = globalThis as typeof globalThis & {
    TextEncoder?: typeof TextEncoder;
    TextDecoder?: typeof TextDecoder;
    fetch?: typeof fetch;
    Headers?: typeof Headers;
    Request?: typeof Request;
    Response?: typeof Response;
    DASHQL_PRECOMPILED?: (imports: WebAssembly.Imports, successCallback: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) => WebAssembly.Exports | Promise<WebAssembly.Exports>;
};
if (typeof g.TextEncoder === "undefined") g.TextEncoder = TextEncoder;
if (typeof g.TextDecoder === "undefined") g.TextDecoder = TextDecoder as typeof g.TextDecoder;
if (typeof g.fetch === "undefined") g.fetch = fetch;
if (typeof g.Headers === "undefined") g.Headers = Headers;
if (typeof g.Request === "undefined") g.Request = Request;
if (typeof g.Response === "undefined") g.Response = Response;

const wasmPath = path.resolve(process.cwd(), "dependencies/dashql-core-wasm/dashql_core.wasm");

// Pre-load the WASM binary for faster instantiation
// Using wasmBinary is simpler and more compatible with Emscripten than instantiateWasm
let wasmBinaryPromise: Promise<Uint8Array> | null = null;

function getWasmBinary(): Promise<Uint8Array> {
    if (!wasmBinaryPromise) {
        wasmBinaryPromise = fs.promises.readFile(wasmPath).then(buf => new Uint8Array(buf));
    }
    return wasmBinaryPromise;
}

// Provide preloaded WASM binary to Emscripten
// This is type-compatible and lets Emscripten handle all the memory setup properly
g.DASHQL_PRECOMPILED = getWasmBinary();
