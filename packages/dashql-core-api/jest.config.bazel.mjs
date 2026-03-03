/**
 * Jest config for Bazel (ESM). NODE_PATH set from runfiles so ts-jest resolves.
 * Used with node_options = ["--experimental-vm-modules"].
 */
import path from "path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const runfiles = process.env.RUNFILES || process.env.TEST_SRCDIR;
let nodeModules = "";
let tsJestPath = "ts-jest";
let main = "";
if (runfiles) {
  main = path.join(runfiles, "_main");
  nodeModules = path.join(main, "bazel", "npm", "node_modules");
  tsJestPath = path.join(nodeModules, "ts-jest");
  process.env.NODE_PATH = process.env.NODE_PATH
    ? `${nodeModules}${path.delimiter}${process.env.NODE_PATH}`
    : nodeModules;
}

// FlatBuffer buffer names (must match src/buffers.ts and proto/fb output)
const DASHQL_BUFFER_NAMES = [
  "algebra",
  "analyzer",
  "catalog",
  "completion",
  "cursor",
  "parser",
  "registry",
  "snippet",
  "statistics",
  "status",
  "view",
];

// Use runfiles-based paths so config works from both packages/dashql-core-api and pnpm-linked @ankoh/dashql-core
const buffersDir = main
  ? path.join(main, "proto", "fb", "dashql_buffers_ts", "dashql", "buffers")
  : "<rootDir>/../../proto/fb/dashql_buffers_ts/dashql/buffers";
const flatbuffersPath = main
  ? path.join(nodeModules, "flatbuffers")
  : "<rootDir>/../../bazel/npm/node_modules/flatbuffers";
const flatbufMappers = Object.fromEntries(
  DASHQL_BUFFER_NAMES.map((name) => [
    `^(.*)gen/dashql/buffers/${name}\\.js$`,
    `${buffersDir}/${name}`,
  ])
);

// Omit preset: Jest requires it to be under rootDir; in Bazel runfiles ts-jest lives in
// bazel/npm/node_modules. We inline default-esm (extensionsToTreatAsEsm + transform) below.
export default {
  moduleNameMapper: {
    // FlatBuffer TS from Bazel: //proto/fb:dashql_buffers_ts_gen → runfiles proto/fb/dashql_buffers_ts/dashql/buffers
    ...flatbufMappers,
    // Generated FlatBuffer .ts files import 'flatbuffers'; resolve from Bazel npm node_modules
    "^flatbuffers$": flatbuffersPath,
    "^(\\.{1,2}/.*)\\.js$": "$1",
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
  testMatch: ["<rootDir>/test/**/*.test.{js,jsx,ts,tsx}"],
  testPathIgnorePatterns: ["node_modules", "\\.cache"],
  coverageReporters: ["lcov"],
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/env/jest_bazel_setup.mjs"],
};
