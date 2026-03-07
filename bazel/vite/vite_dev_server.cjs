/**
 * Vite dev server launcher for Bazel (HMR, long-running).
 * Expects env from BUILD: DASHQL_NPM_ROOT, DASHQL_VITE_PKG, DASHQL_*_DIST. Resolves paths, sets NODE_PATH, spawns vite.
 */

const path = require('path');
const fs = require('fs');
const { findExecroot, resolvePath, applyNpmPath, applyDashqlPaths, readVersionFromRoot } = require('./vite_bazel_paths.cjs');

const runfilesMain = path.resolve(__dirname, '..', '..');
applyDashqlPaths(runfilesMain);

const npmRaw = process.env.DASHQL_NPM_ROOT;
let npmResolved = npmRaw ? resolvePath(npmRaw, runfilesMain) : null;
if (!npmResolved && process.env.RUNFILES_DIR) {
    const main = path.join(process.env.RUNFILES_DIR, process.env.RUNFILES_MAIN_REPO || '_main');
    const fallback = path.join(main, 'node_modules');
    if (fs.existsSync(fallback)) npmResolved = fallback;
}
if (!npmResolved) npmResolved = resolvePath('node_modules', runfilesMain);
if (!npmResolved || !fs.existsSync(npmResolved)) {
    console.error('vite_dev_server: DASHQL_NPM_ROOT not set or node_modules not found');
    process.exit(1);
}
applyNpmPath(npmResolved, { logPrefix: 'vite_dev_server' });
process.env.DASHQL_VITE_ROOT = findExecroot() || (process.env.RUNFILES_DIR ? path.join(process.env.RUNFILES_DIR, process.env.RUNFILES_MAIN_REPO || '_main') : runfilesMain);

if (process.env.DASHQL_VERSION === undefined || process.env.DASHQL_GIT_COMMIT === undefined) {
    const rootDir = process.env.DASHQL_VITE_ROOT || runfilesMain;
    const { version, gitCommit } = readVersionFromRoot(rootDir);
    if (process.env.DASHQL_VERSION === undefined) process.env.DASHQL_VERSION = version || '';
    if (process.env.DASHQL_GIT_COMMIT === undefined) process.env.DASHQL_GIT_COMMIT = gitCommit || '';
}

const vitePkg = process.env.DASHQL_VITE_PKG;
const viteBin = vitePkg && fs.existsSync(path.join(vitePkg, 'bin', 'vite.js')) ? path.join(vitePkg, 'bin', 'vite.js') : null;
if (!viteBin) {
    console.error('vite_dev_server: DASHQL_VITE_PKG not set or vite binary not found');
    process.exit(1);
}

const { spawnSync } = require('child_process');
const proc = spawnSync(process.execPath, [viteBin, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
process.exit(proc.status ?? 1);
