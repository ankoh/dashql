/**
 * Jest config for Bazel (ESM). NODE_PATH = npm; @ankoh/* from DASHQL_*_DIST or runfiles paths.
 * Used with node_options = ["--experimental-vm-modules"].
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolvePath(envValue) {
  if (!envValue) return null;
  if (path.isAbsolute(envValue) && fs.existsSync(envValue)) return envValue;
  let d = process.cwd();
  for (let i = 0; i < 15; i++) {
    if (!d || d === path.dirname(d)) return path.resolve(process.cwd(), envValue);
    if (fs.existsSync(path.join(d, "MODULE.bazel")) || fs.existsSync(path.join(d, "WORKSPACE"))) return path.resolve(d, envValue);
    d = path.dirname(d);
  }
  return path.resolve(process.cwd(), envValue);
}

let nodeModules = "";
let tsJestPath = "ts-jest";
let main = "";

if (process.env.DASHQL_NPM_NODE_MODULES) {
  const npm = resolvePath(process.env.DASHQL_NPM_NODE_MODULES);
  if (npm && fs.existsSync(npm)) {
    nodeModules = npm;
    tsJestPath = path.join(npm, "ts-jest");
    process.env.NODE_PATH = npm + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : "");
  }
}

const runfiles = process.env.RUNFILES_DIR || process.env.RUNFILES || process.env.TEST_SRCDIR;
if (runfiles) {
  main = path.join(runfiles, process.env.RUNFILES_MAIN_REPO || "_main");
  if (!nodeModules && fs.existsSync(path.join(main, "node_modules"))) {
    nodeModules = path.join(main, "node_modules");
    tsJestPath = path.join(nodeModules, "ts-jest");
    process.env.NODE_PATH = nodeModules + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : "");
  }
}

// Direct paths for @ankoh (from BUILD env or runfiles). @ankoh/dashql-protobuf → :proto (src/proto/index.ts).
const coreDist = process.env.DASHQL_CORE_DIST || (main ? path.join(main, "packages", "dashql-core-api", "dist_wasm") : "");
const protobufDistRaw = process.env.DASHQL_PROTOBUF_DIST || (main ? path.join(main, "packages", "dashql-app", "proto") : "");
const protobufDist = protobufDistRaw && resolvePath(protobufDistRaw) && fs.existsSync(resolvePath(protobufDistRaw)) ? resolvePath(protobufDistRaw) : path.join(__dirname, "proto");

export default {
  preset: "ts-jest/presets/default-esm",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    ".*\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga|html|wasm)$":
      "<rootDir>/env/file_mock.ts",
    "^.+\\.(css|styl|less|sass|scss)$": "<rootDir>/env/style_mock.ts",
    "react-router-dom":
      nodeModules
        ? path.join(nodeModules, "react-router-dom", "dist", "index.mjs")
        : "<rootDir>/../../node_modules/react-router-dom/dist/index.mjs",
    "^@ankoh/dashql-protobuf/(.*)$": path.join(protobufDist, "$1"),
    "@ankoh/dashql-protobuf": protobufDist,
    "@ankoh/dashql-core": coreDist ? path.join(coreDist, "src", "index.js") : "<rootDir>/../dashql-core-api/dist/dashql.module.js",
  },
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  transform: {
    "^.+\\.(j|t)sx?$": [
      tsJestPath,
      {
        useESM: true,
        tsconfig: "<rootDir>/tsconfig.json",
        diagnostics: { ignoreCodes: [151001] },
      },
    ],
  },
  transformIgnorePatterns: ["node_modules/(?!(@react-hook|@babel/runtime|other-esm-pkg-name)/)"],
  testMatch: ["<rootDir>/src/**/*.test.{js,jsx,ts,tsx}"],
  testPathIgnorePatterns: ["node_modules", "\\.cache"],
  testEnvironment: "<rootDir>/env/wasm_env.ts",
};
