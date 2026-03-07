/**
 * Shared path resolution and NODE_PATH setup for Vite launchers under Bazel.
 * Used by run_vite.cjs and run_vite_build.cjs. runfilesMain should be the repo
 * root (e.g. path.resolve(__dirname, '..', '..') from a script in bazel/vite).
 *
 * No overlay: @ankoh/* are resolved via direct paths (DASHQL_CORE_DIST, etc.)
 * set by BUILD and resolved here against runfiles/execroot.
 */
const path = require('path');
const fs = require('fs');

function findExecroot() {
    let d = process.cwd();
    for (let i = 0; i < 15; i++) {
        if (!d || d === path.dirname(d)) return null;
        if (fs.existsSync(path.join(d, 'MODULE.bazel')) || fs.existsSync(path.join(d, 'WORKSPACE')) || fs.existsSync(path.join(d, 'WORKSPACE.bazel'))) return d;
        d = path.dirname(d);
    }
    return null;
}

function resolvePath(envValue, runfilesMain) {
    if (!envValue) return null;
    if (path.isAbsolute(envValue) && fs.existsSync(envValue)) return envValue;
    const fromRunfiles = path.join(runfilesMain, envValue);
    if (fs.existsSync(fromRunfiles)) return fromRunfiles;
    const runfilesDir = process.env.RUNFILES_DIR;
    if (runfilesDir) {
        const main = process.env.RUNFILES_MAIN_REPO ? path.join(runfilesDir, process.env.RUNFILES_MAIN_REPO) : runfilesDir;
        const fromRunfilesDir = path.join(main, envValue);
        if (fs.existsSync(fromRunfilesDir)) return fromRunfilesDir;
    }
    const execroot = findExecroot();
    const resolved = execroot ? path.resolve(execroot, envValue) : path.resolve(process.cwd(), envValue);
    return fs.existsSync(resolved) ? resolved : resolved;
}

/** Map process.platform/arch to @rollup/rollup-<platform> optional package name (version-agnostic). */
function getRollupPlatformName() {
    const p = process.platform;
    const a = process.arch;
    if (p === 'darwin') return a === 'arm64' ? 'rollup-darwin-arm64' : a === 'x64' ? 'rollup-darwin-x64' : null;
    if (p === 'linux') {
        if (a === 'x64') return 'rollup-linux-x64-gnu';
        if (a === 'arm64') return 'rollup-linux-arm64-gnu';
        if (a === 'arm') return 'rollup-linux-arm-gnueabihf';
        return null;
    }
    if (p === 'win32') {
        if (a === 'x64') return 'rollup-win32-x64-msvc';
        if (a === 'arm64') return 'rollup-win32-arm64-msvc';
        if (a === 'ia32') return 'rollup-win32-ia32-msvc';
        return null;
    }
    return null;
}

/** Find aspect_rules_js store path for current platform (any version). */
function findAspectRollupStorePath(npm) {
    const name = getRollupPlatformName();
    if (!name) return null;
    const aspectDir = path.join(npm, '.aspect_rules_js');
    if (!fs.existsSync(aspectDir)) return null;
    const prefix = '@rollup+' + name + '@';
    try {
        const entries = fs.readdirSync(aspectDir);
        const found = entries.find((e) => e.startsWith(prefix) && fs.statSync(path.join(aspectDir, e)).isDirectory());
        return found ? path.join(aspectDir, found) : null;
    } catch {
        return null;
    }
}

/**
 * Set NODE_PATH to npm and optionally symlink rollup native from aspect store.
 * @param {string} npm - node_modules dir
 * @param {{ logPrefix?: string }} [options] - logPrefix for rollup symlink errors (e.g. 'run_vite')
 * @returns {string} npm path (for vite bin resolution)
 */
function applyNpmPath(npm, options = {}) {
    if (!npm) return npm;
    const { logPrefix = 'vite' } = options;
    process.env.NODE_PATH = npm + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : '');
    const rollupPkg = getRollupPlatformName();
    const rollupNative = rollupPkg ? path.join(npm, '@rollup', rollupPkg) : null;
    const aspectRollup = findAspectRollupStorePath(npm);
    if (rollupNative && !fs.existsSync(rollupNative) && aspectRollup) {
        const os = require('os');
        const tmp = path.join(os.tmpdir(), 'dashql-rollup-native-' + process.pid);
        const link = path.join(tmp, 'node_modules', '@rollup', rollupPkg);
        try {
            fs.mkdirSync(path.dirname(link), { recursive: true });
            if (!fs.existsSync(link)) fs.symlinkSync(aspectRollup, link, 'dir');
            process.env.NODE_PATH = tmp + path.delimiter + process.env.NODE_PATH;
        } catch (e) {
            console.error(logPrefix + ': rollup native symlink failed:', e.message);
        }
    }
    return npm;
}

/** Env var names for direct @ankoh deps (runfiles-relative paths from BUILD). */
const DASHQL_PATH_VARS = ['DASHQL_CORE_DIST', 'DASHQL_COMPUTE_DIST', 'DASHQL_PROTOBUF_DIST'];

/**
 * Resolve DASHQL_*_DIST env vars (runfiles-relative) to absolute paths and set them.
 * BUILD passes relative paths; launcher resolves so Vite config gets absolute paths.
 * @param {string} runfilesMain - repo root, e.g. path.resolve(__dirname, '..', '..')
 */
function applyDashqlPaths(runfilesMain) {
    for (const key of DASHQL_PATH_VARS) {
        const val = process.env[key];
        if (val) {
            const abs = resolvePath(val, runfilesMain);
            if (abs) process.env[key] = abs;
        }
    }
}

/**
 * Discover npm from runfiles (Bazel) or from script location.
 * @param {string} runfilesMain - repo root, e.g. path.resolve(__dirname, '..', '..')
 * @returns {{ npm: string|null }}
 */
function discoverNpmFromRunfiles(runfilesMain) {
    let main;
    if (process.env.RUNFILES_DIR) {
        main = path.join(process.env.RUNFILES_DIR, process.env.RUNFILES_MAIN_REPO || '_main');
    } else {
        main = runfilesMain;
    }
    const npm = path.join(main, 'node_modules');
    return { npm: fs.existsSync(npm) ? npm : null };
}

module.exports = {
    findExecroot,
    resolvePath,
    getRollupPlatformName,
    findAspectRollupStorePath,
    applyNpmPath,
    applyDashqlPaths,
    discoverNpmFromRunfiles,
    DASHQL_PATH_VARS,
};
