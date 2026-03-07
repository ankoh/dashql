/**
 * Launcher for Vite under Bazel. BUILD passes DASHQL_NPM_NODE_MODULES (execpath)
 * and optionally DASHQL_CORE_DIST, DASHQL_COMPUTE_DIST, DASHQL_PROTOBUF_DIST (runfiles-relative).
 * We resolve them, set NODE_PATH = npm, set absolute DASHQL_* paths for vite.config.ts, and spawn Vite.
 */
const path = require('path');
const fs = require('fs');
const { findExecroot, resolvePath, applyNpmPath, applyDashqlPaths, discoverNpmFromRunfiles } = require('./vite_bazel_paths.cjs');

const runfilesMain = path.resolve(__dirname, '..', '..');
const npmRaw = process.env.DASHQL_NPM_NODE_MODULES;

const npmResolved = npmRaw ? resolvePath(npmRaw, runfilesMain) : discoverNpmFromRunfiles(runfilesMain).npm;

let npmDir = null;
if (npmResolved) {
    npmDir = applyNpmPath(npmResolved, { logPrefix: 'run_vite' });
    applyDashqlPaths(runfilesMain);
    const execroot = findExecroot();
    if (execroot) process.env.DASHQL_VITE_ROOT = execroot;
} else if (process.env.RUNFILES_DIR) {
    const main = path.join(process.env.RUNFILES_DIR, process.env.RUNFILES_MAIN_REPO || '_main');
    npmDir = applyNpmPath(path.join(main, 'node_modules'), { logPrefix: 'run_vite' });
    applyDashqlPaths(runfilesMain);
    process.env.DASHQL_VITE_ROOT = main;
} else {
    const npm = path.join(runfilesMain, 'node_modules');
    if (fs.existsSync(npm)) {
        npmDir = applyNpmPath(npm, { logPrefix: 'run_vite' });
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
    console.error('run_vite: vite not found. DASHQL_NPM_NODE_MODULES=%s', process.env.DASHQL_NPM_NODE_MODULES || '');
    process.exit(1);
}

const { spawnSync } = require('child_process');
const proc = spawnSync(process.execPath, [viteBin, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
process.exit(proc.status ?? 1);
