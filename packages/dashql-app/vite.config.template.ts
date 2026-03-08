import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import * as path from "node:path";

const PROTOBUF_PATH = path.resolve(__dirname, "__PROTOBUF_PATH__");
const COMPUTE_PATH = path.resolve(__dirname, "__COMPUTE_PATH__");
const CORE_API_PATH = path.resolve(__dirname, "__CORE_API_PATH__");
const CORE_WASM_PATH = path.resolve(__dirname, "__CORE_WASM_PATH__");
const ZSTD_WASM_PATH = path.resolve(__dirname, "__ZSTD_WASM_PATH__");

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: {
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, "index.html"),
        oauth_redirect: path.resolve(__dirname, "oauth.html"),
      },
    },
    outDir: "dist",
  },
  resolve: {
    alias: [
      { find: "@ankoh/dashql-protobuf", replacement: PROTOBUF_PATH },
      { find: "@ankoh/dashql-compute", replacement: COMPUTE_PATH },
      { find: "@ankoh/dashql-core", replacement: CORE_API_PATH },
      {
        find: /^@ankoh\/dashql-core-wasm(\?.*)?$/,
        replacement: CORE_WASM_PATH + "$1",
      },
      {
        find: /^@bokuweb\/zstd-wasm\/dist\/web\/zstd.wasm(\?.*)?$/,
        replacement: ZSTD_WASM_PATH + "$1",
      },
    ],
  },
});
