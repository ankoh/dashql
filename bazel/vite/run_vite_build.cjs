/**
 * Build launcher for Vite under Bazel. The custom rule sets VITE_OUT_DIR (path to the
 * declared output dir, relative to exec root) and DASHQL_VITE_PACKAGE_DIR. We resolve
 * VITE_OUT_DIR to absolute, discover overlay/npm from runfiles, then chdir to the
 * package dir and run vite build so Vite writes to the allowed output path.
 */
const path = require('path');
const fs = require('fs');
const { resolvePath, applyPaths, discoverFromRunfiles } = require('./vite_bazel_paths.cjs');

const runfilesMain = path.resolve(__dirname, '..', '..');

// Resolve VITE_OUT_DIR to absolute (rule passes path relative to exec root; cwd is exec root).
const rawOutDir = process.env.VITE_OUT_DIR;
if (rawOutDir) {
    process.env.VITE_OUT_DIR = path.isAbsolute(rawOutDir) ? rawOutDir : path.resolve(process.cwd(), rawOutDir);
}

const overlayRaw = process.env.DASHQL_ANKOH_OVERLAY;
const npmRaw = process.env.DASHQL_NPM_NODE_MODULES;
let overlayResolved = overlayRaw ? resolvePath(overlayRaw, runfilesMain) : null;
let npmResolved = npmRaw ? resolvePath(npmRaw, runfilesMain) : null;
if (!overlayResolved || !npmResolved) {
    const { overlay, npm } = discoverFromRunfiles(runfilesMain);
    if (overlay) overlayResolved = overlay;
    if (npm) npmResolved = npmResolved || npm;
}
if (overlayResolved || npmResolved) {
    applyPaths(overlayResolved, npmResolved, { logPrefix: 'run_vite_build' });
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
    console.error('run_vite_build: vite not found');
    process.exit(1);
}

const { spawnSync } = require('child_process');
const proc = spawnSync(process.execPath, [viteBin, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
process.exit(proc.status ?? 1);
