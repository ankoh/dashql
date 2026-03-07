/**
 * Vite launcher for Bazel one-shot builds (_vite_build rule).
 * Expects env: VITE_OUT_DIR, DASHQL_VITE_PACKAGE_DIR, DASHQL_NPM_ROOT, DASHQL_VITE_PKG, and DASHQL_*_DIST paths.
 * Resolves paths, sets NODE_PATH, chdirs to package dir, spawns vite/bin/vite.js with argv from the rule.
 */

const path = require('path');
const fs = require('fs');
const { findExecroot, resolveDashqlPathsInEnv, readVersionFromRoot } = require('./vite_bazel_paths.cjs');

const runfilesMain = path.resolve(__dirname, '..', '..');
const rootDir = findExecroot() || (process.env.RUNFILES_DIR ? path.join(process.env.RUNFILES_DIR, process.env.RUNFILES_MAIN_REPO || '_main') : runfilesMain);
resolveDashqlPathsInEnv(rootDir);

if (process.env.VITE_OUT_DIR) {
    process.env.VITE_OUT_DIR = path.isAbsolute(process.env.VITE_OUT_DIR)
        ? process.env.VITE_OUT_DIR
        : path.resolve(process.cwd(), process.env.VITE_OUT_DIR);
}

if (process.env.DASHQL_VERSION === undefined || process.env.DASHQL_GIT_COMMIT === undefined) {
    const { version, gitCommit } = readVersionFromRoot(rootDir);
    if (process.env.DASHQL_VERSION === undefined) process.env.DASHQL_VERSION = version || '';
    if (process.env.DASHQL_GIT_COMMIT === undefined) process.env.DASHQL_GIT_COMMIT = gitCommit || '';
}

const packageDir = process.env.DASHQL_VITE_PACKAGE_DIR;
if (packageDir && fs.existsSync(path.resolve(process.cwd(), packageDir))) {
    process.chdir(path.resolve(process.cwd(), packageDir));
}

const vitePkg = process.env.DASHQL_VITE_PKG;
const viteBin = vitePkg ? path.join(vitePkg, 'bin', 'vite.js') : null;
if (!viteBin || !fs.existsSync(viteBin)) {
    console.error('vite_sandboxed: DASHQL_VITE_PKG not set or vite binary not found');
    process.exit(1);
}

const { spawnSync } = require('child_process');
const proc = spawnSync(process.execPath, [viteBin, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
process.exit(proc.status ?? 1);
