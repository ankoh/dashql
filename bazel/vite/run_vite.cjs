/**
 * Launcher for Vite under Bazel. BUILD passes DASHQL_ANKOH_OVERLAY and DASHQL_NPM_NODE_MODULES
 * (execpath); we resolve them against execroot if relative, set NODE_PATH = overlay/node_modules + npm,
 * and set DASHQL_NODE_PATH_OVERLAY for vite.config.ts aliases. Vite 6 is ESM-only so we spawn it.
 */
const path = require('path');
const fs = require('fs');
const { findExecroot, resolvePath, applyPaths, discoverFromRunfiles } = require('./vite_bazel_paths.cjs');

const runfilesMain = path.resolve(__dirname, '..', '..');
const overlayRaw = process.env.DASHQL_ANKOH_OVERLAY;
const npmRaw = process.env.DASHQL_NPM_NODE_MODULES;

const overlayResolved = overlayRaw ? resolvePath(overlayRaw, runfilesMain) : null;
const npmResolved = npmRaw ? resolvePath(npmRaw, runfilesMain) : (overlayResolved ? discoverFromRunfiles(runfilesMain).npm : null);

let npmDir = null;
if (overlayResolved || npmResolved) {
    npmDir = applyPaths(overlayResolved, npmResolved, { logPrefix: 'run_vite' });
    const execroot = findExecroot();
    if (execroot) process.env.DASHQL_VITE_ROOT = execroot;
} else if (process.env.RUNFILES_DIR) {
    const main = path.join(process.env.RUNFILES_DIR, process.env.RUNFILES_MAIN_REPO || '_main');
    npmDir = applyPaths(path.join(main, 'packages', 'dashql-app', 'ankoh_overlay'), path.join(main, 'node_modules'), { logPrefix: 'run_vite' });
    process.env.DASHQL_VITE_ROOT = main;
} else {
    const overlay = path.join(runfilesMain, 'packages', 'dashql-app', 'ankoh_overlay');
    const npm = path.join(runfilesMain, 'node_modules');
    if (fs.existsSync(npm)) npmDir = applyPaths(fs.existsSync(path.join(overlay, 'node_modules')) ? overlay : null, npm, { logPrefix: 'run_vite' });
    process.env.DASHQL_VITE_ROOT = runfilesMain;
}

let viteBin = null;
if (npmDir) {
    const candidate = path.join(npmDir, 'vite', 'bin', 'vite.js');
    if (fs.existsSync(candidate)) viteBin = candidate;
}
if (!viteBin && !overlayRaw) viteBin = require.resolve('vite/bin/vite.js');
if (!viteBin || !fs.existsSync(viteBin)) {
    console.error('run_vite: vite not found. DASHQL_NPM_NODE_MODULES=%s', process.env.DASHQL_NPM_NODE_MODULES || '');
    process.exit(1);
}

const { spawnSync } = require('child_process');
const proc = spawnSync(process.execPath, [viteBin, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
process.exit(proc.status ?? 1);
