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
    DASHQL_PRECOMPILED?: Promise<Uint8Array>;
    WEBDB_PRECOMPILED: Promise<Uint8Array>;
};
if (typeof g.TextEncoder === "undefined") g.TextEncoder = TextEncoder;
if (typeof g.TextDecoder === "undefined") g.TextDecoder = TextDecoder as typeof g.TextDecoder;
if (typeof g.fetch === "undefined") g.fetch = fetch;
if (typeof g.Headers === "undefined") g.Headers = Headers;
if (typeof g.Request === "undefined") g.Request = Request;
if (typeof g.Response === "undefined") g.Response = Response;

const wasmPath = path.resolve(process.cwd(), "dependencies/dashql-core-wasm/dashql_core.wasm");
const webdbWasmPath = path.resolve(process.cwd(), "dependencies/dashql-duckdb/duckdb_web.wasm");

// Pre-load the WASM binary for faster instantiation
// Using wasmBinary is simpler and more compatible with Emscripten than instantiateWasm
let wasmBinaryPromise: Promise<Uint8Array> | null = null;
let webdbWasmBinaryPromise: Promise<Uint8Array> | null = null;

function getWasmBinary(): Promise<Uint8Array> {
    if (!wasmBinaryPromise) {
        wasmBinaryPromise = fs.promises.readFile(wasmPath).then(buf => new Uint8Array(buf));
    }
    return wasmBinaryPromise;
}

function getWebDBWasmBinary(): Promise<Uint8Array> {
    if (!webdbWasmBinaryPromise) {
        webdbWasmBinaryPromise = fs.promises.readFile(webdbWasmPath)
            .then(buf => new Uint8Array(buf));
    }
    return webdbWasmBinaryPromise;
}

// Provide preloaded WASM binary to Emscripten
// This is type-compatible and lets Emscripten handle all the memory setup properly
g.DASHQL_PRECOMPILED = getWasmBinary();

// Provide preloaded WebDB WASM binary for tests
g.WEBDB_PRECOMPILED = getWebDBWasmBinary();
