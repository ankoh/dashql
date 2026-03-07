/**
 * Build launcher for Vite under Bazel. The custom rule sets VITE_OUT_DIR (path to the
 * declared output dir), DASHQL_VITE_PACKAGE_DIR, and DASHQL_CORE_DIST / DASHQL_COMPUTE_DIST / DASHQL_PROTOBUF_DIST.
 * We resolve paths, chdir to the package dir, and run vite build so Vite writes to the allowed output path.
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
    applyNpmPath(npmResolved, { logPrefix: 'run_vite_build' });
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
    console.error('run_vite_build: vite not found');
    process.exit(1);
}

const { spawnSync } = require('child_process');
const proc = spawnSync(process.execPath, [viteBin, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
process.exit(proc.status ?? 1);
