/**
 * Vite build launcher for Bazel (one-shot production build).
 *
 * Used by: `bazel build //packages/dashql-app:vite_reloc` and `vite_pages` via the custom _vite_build
 * rule, which runs this script with env set (VITE_OUT_DIR, DASHQL_VITE_PACKAGE_DIR, DASHQL_*_DIST).
 * Unlike vite_dev_server.cjs, this launcher always runs `vite build` (with args like `--config
 * vite.config.ts --mode reloc`) and writes output to a single declared directory so Bazel can
 * capture the outputs without permission issues.
 *
 * What this script does:
 * - Resolves VITE_OUT_DIR to an absolute path (the rule sets it to the declared output dir).
 * - Discovers node_modules from DASHQL_NPM_NODE_MODULES or runfiles; sets NODE_PATH and resolves
 *   DASHQL_CORE_DIST / DASHQL_COMPUTE_DIST / DASHQL_PROTOBUF_DIST to absolute paths (same as
 *   vite_dev_server.cjs for path setup).
 * - Chdirs to DASHQL_VITE_PACKAGE_DIR (e.g. packages/dashql-app) so Vite runs with the package
 *   as cwd and finds index.html, vite.config.ts, src/, etc.
 * - Spawns `node vite/bin/vite.js build ...` so Vite writes to VITE_OUT_DIR (allowed by the rule).
 *
 * Difference from vite_dev_server.cjs: this script is for production builds (one-shot, writes dist);
 * vite_dev_server starts the long-running dev server with HMR and does not write output.
 */

const path = require('path');
const fs = require('fs');
const { resolvePath, applyNpmPath, applyDashqlPaths, discoverNpmFromRunfiles } = require('./vite_bazel_paths.cjs');

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
    applyNpmPath(npmResolved, { logPrefix: 'vite_build' });
}
applyDashqlPaths(runfilesMain);

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
    console.error('vite_build: vite not found');
    process.exit(1);
}

const { spawnSync } = require('child_process');
const proc = spawnSync(process.execPath, [viteBin, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
process.exit(proc.status ?? 1);
