/**
 * Jest setup for Bazel (ESM): set DASHQL_CORE_API_DIST (api bundle), DASHQL_WASM_PATH (core WASM), NODE_PATH, and precompile WASM.
 * API bundle and WASM are separate runfiles; WASM lives in packages/dashql-core (core_wasm / core_wasm_opt).
 */
import path from "path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const runfiles = process.env.RUNFILES || process.env.TEST_SRCDIR;
if (runfiles) {
  const main = path.join(runfiles, "_main");
  const apiBundle = path.join(main, "packages", "dashql-core", "api", "bundle");
  const coreOptWasm = path.join(main, "packages", "dashql-core", "dashql_core_opt.wasm");
  const coreWasm = path.join(main, "packages", "dashql-core", "dashql_core.wasm");
  process.env.DASHQL_CORE_API_DIST = apiBundle;
  process.env.DASHQL_WASM_PATH = fs.existsSync(coreOptWasm) ? coreOptWasm : coreWasm;
  const bazelNodeModules = path.join(main, "bazel", "npm", "node_modules");
  process.env.NODE_PATH = process.env.NODE_PATH
    ? `${bazelNodeModules}:${process.env.NODE_PATH}`
    : bazelNodeModules;
}

// Jest does not await setupFilesAfterEnv promises, so we expose a ready promise
// that test beforeAll hooks must await before using DASHQL_PRECOMPILED.
globalThis.DASHQL_PRECOMPILED_READY = (async () => {
  const wasmPath = process.env.DASHQL_WASM_PATH;
  if (!wasmPath) return;
  const buf = await fs.promises.readFile(wasmPath);
  const mod = await WebAssembly.compile(buf);
  globalThis.DASHQL_PRECOMPILED = async (imports) => {
    const instance = await WebAssembly.instantiate(mod, imports);
    return { module: mod, instance };
  };
})();
