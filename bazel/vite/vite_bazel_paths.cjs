/**
 * Path resolution and NODE_PATH for Vite launchers under Bazel.
 *
 * - resolvePath, applyDashqlPaths: resolve runfiles-relative env vars (DASHQL_*_DIST, DASHQL_NPM_ROOT, etc.) to absolute paths.
 * - applyNpmPath: set NODE_PATH to npm root; when DASHQL_ROLLUP_NATIVE_DIST is set, symlink that package so Rollup can load it.
 * - findExecroot, readVersionFromRoot: used for version/git and execroot detection.
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
    // In a run_shell action, paths from the rule are relative to the execution root; prefer cwd so we resolve correctly.
    if (!path.isAbsolute(envValue) && envValue.startsWith("bazel-out")) {
        const fromCwd = path.resolve(process.cwd(), envValue);
        if (fs.existsSync(fromCwd)) return fromCwd;
    }
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

/** Set NODE_PATH to npm; if DASHQL_ROLLUP_NATIVE_DIST is set, symlink it so Rollup can load the native binary. */
function applyNpmPath(npm, options = {}) {
    if (!npm) return npm;
    const { logPrefix = 'vite' } = options;
    process.env.NODE_PATH = npm + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : '');
    const rollupNativePath = process.env.DASHQL_ROLLUP_NATIVE_DIST;
    if (rollupNativePath) {
        const packageName = path.basename(rollupNativePath);
        const rollupNative = path.join(npm, '@rollup', packageName);
        if (!fs.existsSync(rollupNative)) {
            const os = require('os');
            const tmp = path.join(os.tmpdir(), 'dashql-rollup-native-' + process.pid);
            const link = path.join(tmp, 'node_modules', '@rollup', packageName);
            try {
                fs.mkdirSync(path.dirname(link), { recursive: true });
                if (!fs.existsSync(link)) fs.symlinkSync(rollupNativePath, link, 'dir');
                process.env.NODE_PATH = tmp + path.delimiter + process.env.NODE_PATH;
            } catch (e) {
                console.error(logPrefix + ': rollup native symlink failed:', e.message);
            }
        }
    }
    return npm;
}

/**
 * Resolve DASHQL_*_DIST and DASHQL_CORE_WASM_PATH (runfiles-relative from BUILD) to absolute paths and set in env.
 * @param {string} runfilesMain - repo root, e.g. path.resolve(__dirname, '..', '..')
 */
function resolveDashqlPathsInEnv(runfilesMain) {
    for (const key of ['DASHQL_CORE_DIST', 'DASHQL_CORE_WASM_PATH', 'DASHQL_COMPUTE_DIST', 'DASHQL_PROTOBUF_DIST', 'DASHQL_ZSTD_WASM_DIST', 'DASHQL_NPM_ROOT', 'DASHQL_VITE_PKG', 'DASHQL_ROLLUP_PKG', 'DASHQL_ROLLUP_NATIVE_DIST']) {
        const val = process.env[key];
        if (val) {
            const abs = resolvePath(val, runfilesMain);
            if (abs) process.env[key] = abs;
        }
    }
}

/**
 * Read version and gitCommit from package.json at the given root path (repo root).
 * @param {string} rootDir - absolute path to repo root (runfiles main or execroot)
 * @returns {{ version: string, gitCommit: string }}
 */
function readVersionFromRoot(rootDir) {
    const pkgPath = path.join(rootDir, 'package.json');
    if (!fs.existsSync(pkgPath)) return { version: '', gitCommit: '' };
    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return {
            version: typeof pkg.version === 'string' ? pkg.version : '',
            gitCommit: typeof pkg.gitCommit === 'string' ? pkg.gitCommit : '',
        };
    } catch {
        return { version: '', gitCommit: '' };
    }
}

module.exports = {
    findExecroot,
    resolvePath,
    applyNpmPath,
    resolveDashqlPathsInEnv,
    readVersionFromRoot,
};
