/**
 * Vite sandboxed launcher for Bazel (one-shot runs with VITE_OUT_DIR and package cwd).
 *
 * Used by: the custom _vite_build rule when building targets like
 * `bazel build //packages/dashql-app:reloc` and `//packages/dashql-app:pages`. The rule runs this script with
 * env set (VITE_OUT_DIR, DASHQL_VITE_PACKAGE_DIR, DASHQL_*_DIST) and passes the Vite command line
 * as argv (e.g. "build", "--config", "vite.config.ts", "--mode", "reloc"). This script does not
 * hard-code "build"—it just sets up paths and spawns `vite/bin/vite.js` with whatever argv the
 * rule provides.
 *
 * What this script does:
 * - Resolves VITE_OUT_DIR to an absolute path (the rule sets it to the declared output dir).
 * - Discovers node_modules from DASHQL_NPM_NODE_MODULES or runfiles; sets NODE_PATH and resolves
 *   DASHQL_CORE_DIST / DASHQL_COMPUTE_DIST to absolute paths.
 * - Chdirs to DASHQL_VITE_PACKAGE_DIR (e.g. packages/dashql-app) so Vite finds index.html,
 *   vite.config.ts, src/, etc.
 * - Spawns `node vite/bin/vite.js <...argv from rule>` (typically "build" plus options).
 *
 * Difference from vite_dev_server.cjs: this launcher is for one-shot Bazel actions (output dir +
 * chdir; subcommand comes from the rule). vite_dev_server is the entry point for the long-running
 * dev server (js_binary, no VITE_OUT_DIR, no chdir).
 */

const path = require('path');
const fs = require('fs');
const { findExecroot, resolvePath, applyNpmPath, applyDashqlPaths, discoverNpmFromRunfiles, readVersionFromRoot } = require('./vite_bazel_paths.cjs');

const runfilesMain = path.resolve(__dirname, '..', '..');

const rawOutDir = process.env.VITE_OUT_DIR;
if (rawOutDir) {
    process.env.VITE_OUT_DIR = path.isAbsolute(rawOutDir) ? rawOutDir : path.resolve(process.cwd(), rawOutDir);
}

const npmRaw = process.env.DASHQL_NPM_NODE_MODULES;
let npmResolved = npmRaw ? resolvePath(npmRaw, runfilesMain) : null;
if (!npmResolved) {
    const { npm } = discoverNpmFromRunfiles(runfilesMain);
    npmResolved = npm;
}
if (npmResolved) {
    applyNpmPath(npmResolved, { logPrefix: 'vite_sandboxed' });
}
applyDashqlPaths(runfilesMain);
// Resolve paths to absolute so they stay valid after chdir to package dir.
for (const key of ['DASHQL_PROTOBUF_DIST', 'DASHQL_CORE_WASM_PATH', 'DASHQL_ZSTD_WASM_DIST']) {
    if (process.env[key] && !path.isAbsolute(process.env[key])) {
        process.env[key] = path.resolve(process.cwd(), process.env[key]);
    }
}

// Set DASHQL_VERSION / DASHQL_GIT_COMMIT from root package.json so vite.config.ts does not need app package.json.
if (process.env.DASHQL_VERSION === undefined || process.env.DASHQL_GIT_COMMIT === undefined) {
    const rootDir = findExecroot() || (process.env.RUNFILES_DIR ? path.join(process.env.RUNFILES_DIR, process.env.RUNFILES_MAIN_REPO || '_main') : runfilesMain);
    const { version, gitCommit } = readVersionFromRoot(rootDir);
    if (process.env.DASHQL_VERSION === undefined) process.env.DASHQL_VERSION = version || '';
    if (process.env.DASHQL_GIT_COMMIT === undefined) process.env.DASHQL_GIT_COMMIT = gitCommit || '';
}

const packageDir = process.env.DASHQL_VITE_PACKAGE_DIR;
if (packageDir) {
    const target = path.resolve(process.cwd(), packageDir);
    if (fs.existsSync(target)) {
        process.chdir(target);
    }
}

let viteBin = null;
if (npmResolved) {
    const candidate = path.join(npmResolved, 'vite', 'bin', 'vite.js');
    if (fs.existsSync(candidate)) viteBin = candidate;
}
if (!viteBin) viteBin = require.resolve('vite/bin/vite.js');
if (!viteBin || !fs.existsSync(viteBin)) {
    console.error('vite_sandboxed: vite not found');
    process.exit(1);
}

const { spawnSync } = require('child_process');
const proc = spawnSync(process.execPath, [viteBin, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
process.exit(proc.status ?? 1);
