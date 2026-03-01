/**
 * CJS version of wasm_env for Jest under Bazel. Jest loads testEnvironment via
 * require(), so the ESM wasm_env.ts cannot be used there; this file is used by
 * jest.config.bazel.cjs. Same behavior as wasm_env.ts.
 */
const path = require("path");
const fs = require("fs");
// Require from NODE_PATH (set by patch before node) since resolution from this context may not use it
const nodePath = process.env.NODE_PATH || "";
const firstPath = nodePath.split(path.delimiter)[0];
const NodeEnvironmentModule = firstPath
  ? require(path.join(firstPath, "jest-environment-node"))
  : require("jest-environment-node");
const NodeEnvironment = NodeEnvironmentModule.default ?? NodeEnvironmentModule;

const distPath = process.env.DASHQL_WASM_PATH
  ? path.dirname(process.env.DASHQL_WASM_PATH)
  : path.resolve(__dirname, "../dist");
const wasmPath = process.env.DASHQL_WASM_PATH ?? path.resolve(distPath, "./dashql_core.wasm");

class WasmEnv extends NodeEnvironment {
  async setup() {
    await super.setup();
    const buf = await fs.promises.readFile(wasmPath);
    const mod = await WebAssembly.compile(buf);
    this.global.DASHQL_PRECOMPILED = async (imports) => {
      const instance = await WebAssembly.instantiate(mod, imports);
      return { module: mod, instance };
    };
  }
}

module.exports = WasmEnv;
