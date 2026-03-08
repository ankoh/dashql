import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import * as path from "node:path";

const PROTOBUF_PATH = "__PROTOBUF_PATH__";
const COMPUTE_PATH = "__COMPUTE_PATH__";
const CORE_API_PATH = "__CORE_API_PATH__";
const CORE_WASM_PATH = "__CORE_WASM_PATH__";

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: {
    rollupOptions: {
      input: "./oauth.html",
    },
    outDir: "dist",
  },
  resolve: {
    alias: [
      {
        // Matches "@ankoh/dashql-core-wasm" AND "@ankoh/dashql-core-wasm?url" and preserves the query string
        find: /^@ankoh\/dashql-core-wasm(\?.*)?$/,
        replacement: path.resolve(__dirname, CORE_WASM_PATH) + "$1",
      },
      { find: "@ankoh/dashql-protobuf", replacement: path.resolve(__dirname, PROTOBUF_PATH) },
      { find: "@ankoh/dashql-compute", replacement: path.resolve(__dirname, COMPUTE_PATH) },
      { find: "@ankoh/dashql-core", replacement: path.resolve(__dirname, CORE_API_PATH) },
    ],
  },
});
