/**
 * Jest setup for Bazel (ESM): set DASHQL_WASM_PATH, NODE_PATH, and precompile WASM.
 * Always uses the WASM from runfiles (output of :dist_wasm, built from
 * //packages/dashql-core:dashql_core_wasm).
 */
import path from "path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const runfiles = process.env.RUNFILES || process.env.TEST_SRCDIR;
if (runfiles) {
  const main = path.join(runfiles, "_main");
  process.env.DASHQL_WASM_PATH = path.join(
    main,
    "packages",
    "dashql-core-api",
    "dist",
    "dashql.wasm"
  );
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
