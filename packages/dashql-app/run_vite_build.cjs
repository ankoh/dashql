/**
 * Build launcher for Vite under Bazel. The custom rule sets VITE_OUT_DIR (path to the
 * declared output dir, relative to exec root) and DASHQL_VITE_PACKAGE_DIR. We resolve
 * VITE_OUT_DIR to absolute, discover overlay/npm from runfiles, then chdir to the
 * package dir and run vite build so Vite writes to the allowed output path.
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

function resolvePath(envValue) {
    if (!envValue) return null;
    if (path.isAbsolute(envValue) && fs.existsSync(envValue)) return envValue;
    const runfilesMain = path.resolve(__dirname, '..', '..');
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

function applyPaths(overlay, npm) {
    if (!npm) return;
    const overlayNodeModules = overlay && fs.existsSync(path.join(overlay, 'node_modules')) ? path.join(overlay, 'node_modules') : null;
    const entries = [overlayNodeModules, npm].filter(Boolean);
    if (entries.length) {
        process.env.NODE_PATH = entries.join(path.delimiter) + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : '');
        if (overlay) process.env.DASHQL_NODE_PATH_OVERLAY = overlay;
    }
    const rollupNative = path.join(npm, '@rollup', 'rollup-darwin-arm64');
    const aspectRollup = path.join(npm, '.aspect_rules_js', '@rollup+rollup-darwin-arm64@4.59.0');
    if (!fs.existsSync(rollupNative) && fs.existsSync(aspectRollup)) {
        const os = require('os');
        const tmp = path.join(os.tmpdir(), 'dashql-rollup-native-' + process.pid);
        const link = path.join(tmp, 'node_modules', '@rollup', 'rollup-darwin-arm64');
        try {
            fs.mkdirSync(path.dirname(link), { recursive: true });
            if (!fs.existsSync(link)) fs.symlinkSync(aspectRollup, link, 'dir');
            process.env.NODE_PATH = tmp + path.delimiter + process.env.NODE_PATH;
        } catch (e) {
            console.error('run_vite_build: rollup native symlink failed:', e.message);
        }
    }
}

function discoverFromRunfiles() {
    let main;
    if (process.env.RUNFILES_DIR) {
        main = path.join(process.env.RUNFILES_DIR, process.env.RUNFILES_MAIN_REPO || '_main');
    } else {
        main = path.resolve(__dirname, '..', '..');
    }
    const overlay = path.join(main, 'packages', 'dashql-app', 'ankoh_overlay');
    const npm = path.join(main, 'node_modules');
    return { overlay: fs.existsSync(path.join(overlay, 'node_modules')) ? overlay : null, npm: fs.existsSync(npm) ? npm : null };
}

// Resolve VITE_OUT_DIR to absolute (rule passes path relative to exec root; cwd is exec root).
const rawOutDir = process.env.VITE_OUT_DIR;
if (rawOutDir) {
    process.env.VITE_OUT_DIR = path.isAbsolute(rawOutDir) ? rawOutDir : path.resolve(process.cwd(), rawOutDir);
}

const overlayRaw = process.env.DASHQL_ANKOH_OVERLAY;
const npmRaw = process.env.DASHQL_NPM_NODE_MODULES;
let overlayResolved = overlayRaw ? resolvePath(overlayRaw) : null;
let npmResolved = npmRaw ? resolvePath(npmRaw) : null;
if (!overlayResolved || !npmResolved) {
    const { overlay, npm } = discoverFromRunfiles();
    if (overlay) overlayResolved = overlay;
    if (npm) npmResolved = npmResolved || npm;
}
if (overlayResolved || npmResolved) {
    applyPaths(overlayResolved, npmResolved);
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
