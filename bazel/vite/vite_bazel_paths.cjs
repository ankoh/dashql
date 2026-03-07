/**
 * Shared path resolution and NODE_PATH setup for Vite launchers (vite_dev_server.cjs, vite_sandboxed.cjs) under Bazel.
 *
 * Why these helpers exist:
 *
 * 1. Path resolution (resolvePath, findExecroot, applyDashqlPaths)
 *    Bazel runs the launcher with a working directory that is not the repo root; BUILD passes
 *    runfiles-relative paths (e.g. DASHQL_CORE_DIST) in env. The launcher must resolve these to
 *    absolute paths so vite.config.ts can use them. We try runfilesMain, RUNFILES_DIR, and execroot
 *    so the same script works in both Bazel (runfiles) and local/dev (repo root) runs.
 *
 * 2. NODE_PATH and node_modules (applyNpmPath, discoverNpmFromRunfiles)
 *    rules_js puts the linked node_modules in runfiles, not necessarily at cwd. We discover
 *    node_modules from RUNFILES_DIR or runfilesMain, set NODE_PATH so require('vite') and
 *    vite.config.ts dependencies resolve, and locate the vite bin for spawning.
 *
 * 3. @ankoh/* packages (applyDashqlPaths)
 *    We do not use an overlay; BUILD sets DASHQL_CORE_DIST, DASHQL_COMPUTE_DIST, DASHQL_PROTOBUF_DIST
 *    (runfiles-relative). We resolve them to absolute paths and set them in env; vite.config.ts
 *    uses these to alias @ankoh/dashql-core, @ankoh/dashql-compute, @ankoh/dashql-protobuf.
 *
 * 4. Rollup native binary (findAspectRollupNative, applyNpmPath)
 *    Vite depends on Rollup, which uses optional platform-specific native packages (e.g.
 *    @rollup/rollup-darwin-arm64). In the aspect_rules_js store these may live under
 *    node_modules/.aspect_rules_js/ and not under node_modules/@rollup/. We detect any
 *    @rollup/rollup-<platform> in the store and, if it is missing from node_modules/@rollup,
 *    symlink it into a temp dir and prepend that to NODE_PATH so Rollup can load the native binary.
 *
 * runfilesMain: repo root when not using RUNFILES_DIR, e.g. path.resolve(__dirname, '..', '..') from bazel/vite.
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

/** Find any @rollup/rollup-<platform> in aspect_rules_js store; return { storePath, packageName } or null. */
function findAspectRollupNative(npm) {
    const aspectDir = path.join(npm, '.aspect_rules_js');
    if (!fs.existsSync(aspectDir)) return null;
    const prefix = '@rollup+rollup-';
    try {
        const entries = fs.readdirSync(aspectDir);
        const found = entries.find((e) => e.startsWith(prefix) && fs.statSync(path.join(aspectDir, e)).isDirectory());
        if (!found) return null;
        const at = found.indexOf('@', prefix.length);
        const suffix = at > 0 ? found.slice(prefix.length, at) : found.slice(prefix.length);
        return { storePath: path.join(aspectDir, found), packageName: 'rollup-' + suffix };
    } catch {
        return null;
    }
}

/** Set NODE_PATH to npm; symlink @rollup native from aspect store if missing. */
function applyNpmPath(npm, options = {}) {
    if (!npm) return npm;
    const { logPrefix = 'vite' } = options;
    process.env.NODE_PATH = npm + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : '');
    const aspectRollup = findAspectRollupNative(npm);
    if (aspectRollup) {
        const rollupNative = path.join(npm, '@rollup', aspectRollup.packageName);
        if (!fs.existsSync(rollupNative)) {
            const os = require('os');
            const tmp = path.join(os.tmpdir(), 'dashql-rollup-native-' + process.pid);
            const link = path.join(tmp, 'node_modules', '@rollup', aspectRollup.packageName);
            try {
                fs.mkdirSync(path.dirname(link), { recursive: true });
                if (!fs.existsSync(link)) fs.symlinkSync(aspectRollup.storePath, link, 'dir');
                process.env.NODE_PATH = tmp + path.delimiter + process.env.NODE_PATH;
            } catch (e) {
                console.error(logPrefix + ': rollup native symlink failed:', e.message);
            }
        }
    }
    return npm;
}

/**
 * Resolve DASHQL_*_DIST (runfiles-relative from BUILD) to absolute paths and set in env.
 * @param {string} runfilesMain - repo root, e.g. path.resolve(__dirname, '..', '..')
 */
function applyDashqlPaths(runfilesMain) {
    for (const key of ['DASHQL_CORE_DIST', 'DASHQL_COMPUTE_DIST', 'DASHQL_PROTOBUF_DIST']) {
        const val = process.env[key];
        if (val) {
            const abs = resolvePath(val, runfilesMain);
            if (abs) process.env[key] = abs;
        }
    }
}

/** Resolve node_modules from RUNFILES_DIR or runfilesMain. */
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
    applyNpmPath,
    applyDashqlPaths,
    discoverNpmFromRunfiles,
};
