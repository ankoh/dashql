/**
 * Jest config for Bazel (ESM). NODE_PATH = overlay/node_modules + npm (from env when set).
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

if (process.env.DASHQL_ANKOH_OVERLAY && process.env.DASHQL_NPM_NODE_MODULES) {
  const overlay = resolvePath(process.env.DASHQL_ANKOH_OVERLAY);
  const npm = resolvePath(process.env.DASHQL_NPM_NODE_MODULES);
  const overlayNodeModules = overlay ? path.join(overlay, "node_modules") : null;
  const entries = [overlayNodeModules, npm].filter(Boolean);
  if (entries.length) {
    nodeModules = npm;
    tsJestPath = path.join(npm, "ts-jest");
    process.env.NODE_PATH = entries.join(path.delimiter) + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : "");
  }
  if (overlay) {
    main = path.dirname(overlay);
    if (!process.env.DASHQL_CORE_DIST) process.env.DASHQL_CORE_DIST = path.join(resolvePath(process.env.DASHQL_ANKOH_OVERLAY), "node_modules", "@ankoh", "dashql-core");
  }
} else {
  const runfiles = process.env.RUNFILES || process.env.TEST_SRCDIR;
  if (runfiles) {
    main = path.join(runfiles, "_main");
    nodeModules = path.join(main, "bazel", "npm", "node_modules");
    tsJestPath = path.join(nodeModules, "ts-jest");
    process.env.NODE_PATH = process.env.NODE_PATH ? `${nodeModules}${path.delimiter}${process.env.NODE_PATH}` : nodeModules;
    if (!process.env.DASHQL_CORE_DIST) process.env.DASHQL_CORE_DIST = path.join(main, "packages", "dashql-core-api", "dist_wasm");
  }
}

const coreDist = process.env.DASHQL_CORE_DIST || (main ? path.join(main, "packages", "dashql-core-api", "dist_wasm") : "");
const protobufFromNpm = nodeModules ? path.join(nodeModules, "@ankoh", "dashql-protobuf", "dist", "dashql-proto.module.js") : "";
const protobufPath =
  (nodeModules && protobufFromNpm && fs.existsSync(protobufFromNpm))
    ? protobufFromNpm
    : main
      ? path.join(main, "packages", "dashql-protobuf", "dist", "dashql-proto.module.js")
      : "<rootDir>/../dashql-protobuf/dist/dashql-proto.module.js";

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
    "@ankoh/dashql-protobuf": protobufPath,
    "@ankoh/dashql-core": coreDist ? path.join(coreDist, "dashql.module.js") : "<rootDir>/../dashql-core-api/dist/dashql.module.js",
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
