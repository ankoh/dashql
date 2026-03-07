/**
 * Vite dev server launcher for Bazel (HMR, long-running).
 *
 * Used by: `bazel run //packages/dashql-app:vite_dev` via a js_binary that uses this script as
 * entry_point. Unlike vite_build.cjs, this launcher does not run `vite build`; it starts the
 * Vite dev server (default: `vite` with no subcommand), which serves the app with hot module
 * replacement and does not write a dist/ directory.
 *
 * What this script does:
 * - Discovers node_modules from DASHQL_NPM_NODE_MODULES (execpath from BUILD) or from runfiles.
 * - Resolves DASHQL_CORE_DIST, DASHQL_COMPUTE_DIST, DASHQL_PROTOBUF_DIST (runfiles-relative from
 *   BUILD) to absolute paths and sets them in env so vite.config.ts can alias @ankoh/*.
 * - Sets NODE_PATH so Vite and vite.config.ts can resolve npm deps; optionally symlinks Rollup
 *   native from aspect store (see vite_bazel_paths.cjs).
 * - Sets DASHQL_VITE_ROOT (execroot or runfiles main) for config if needed.
 * - Spawns `node vite/bin/vite.js` with the same argv (so `vite`, `vite --port 5174`, etc.).
 *
 * Difference from vite_build.cjs: dev server is for development (HMR, no output dir); vite_build
 * is for one-shot production builds and runs `vite build` with VITE_OUT_DIR and chdir to the package.
 */

const path = require('path');
const fs = require('fs');
const { findExecroot, resolvePath, applyNpmPath, applyDashqlPaths, discoverNpmFromRunfiles } = require('./vite_bazel_paths.cjs');

const runfilesMain = path.resolve(__dirname, '..', '..');
const npmRaw = process.env.DASHQL_NPM_NODE_MODULES;
const npmResolved = npmRaw ? resolvePath(npmRaw, runfilesMain) : discoverNpmFromRunfiles(runfilesMain).npm;

let npmDir = null;
if (npmResolved) {
    npmDir = applyNpmPath(npmResolved, { logPrefix: 'vite_dev_server' });
    applyDashqlPaths(runfilesMain);
    const execroot = findExecroot();
    if (execroot) process.env.DASHQL_VITE_ROOT = execroot;
} else if (process.env.RUNFILES_DIR) {
    const main = path.join(process.env.RUNFILES_DIR, process.env.RUNFILES_MAIN_REPO || '_main');
    npmDir = applyNpmPath(path.join(main, 'node_modules'), { logPrefix: 'vite_dev_server' });
    applyDashqlPaths(runfilesMain);
    process.env.DASHQL_VITE_ROOT = main;
} else {
    const npm = path.join(runfilesMain, 'node_modules');
    if (fs.existsSync(npm)) {
        npmDir = applyNpmPath(npm, { logPrefix: 'vite_dev_server' });
        applyDashqlPaths(runfilesMain);
    }
    process.env.DASHQL_VITE_ROOT = runfilesMain;
}

let viteBin = null;
if (npmDir) {
    const candidate = path.join(npmDir, 'vite', 'bin', 'vite.js');
    if (fs.existsSync(candidate)) viteBin = candidate;
}
if (!viteBin) viteBin = require.resolve('vite/bin/vite.js');
if (!viteBin || !fs.existsSync(viteBin)) {
    console.error('vite_dev_server: vite not found. DASHQL_NPM_NODE_MODULES=%s', process.env.DASHQL_NPM_NODE_MODULES || '');
    process.exit(1);
}

const { spawnSync } = require('child_process');
const proc = spawnSync(process.execPath, [viteBin, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
process.exit(proc.status ?? 1);
