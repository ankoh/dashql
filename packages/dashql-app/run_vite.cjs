/**
 * Launcher for Vite under Bazel. BUILD passes DASHQL_ANKOH_OVERLAY and DASHQL_NPM_NODE_MODULES
 * (execpath); we resolve them against execroot if relative, set NODE_PATH = overlay/node_modules + npm,
 * and set DASHQL_NODE_PATH_OVERLAY for vite.config.ts aliases. Vite 6 is ESM-only so we spawn it.
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
  const execroot = findExecroot();
  const resolved = execroot ? path.resolve(execroot, envValue) : path.resolve(process.cwd(), envValue);
  return fs.existsSync(resolved) ? resolved : resolved;
}

let npmDir = null;
const overlayRaw = process.env.DASHQL_ANKOH_OVERLAY;
const npmRaw = process.env.DASHQL_NPM_NODE_MODULES;

function applyPaths(overlay, npm) {
  if (!npm) return;
  npmDir = npm;
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
      console.error('run_vite: rollup native symlink failed:', e.message);
    }
  }
}

if (overlayRaw || npmRaw) {
  applyPaths(resolvePath(overlayRaw), resolvePath(npmRaw));
  const execroot = findExecroot();
  if (execroot) process.env.DASHQL_VITE_ROOT = execroot;
} else if (process.env.RUNFILES_DIR) {
  const main = path.join(process.env.RUNFILES_DIR, process.env.RUNFILES_MAIN_REPO || '_main');
  applyPaths(path.join(main, 'packages', 'dashql-app', 'ankoh_overlay'), path.join(main, 'node_modules'));
  process.env.DASHQL_VITE_ROOT = main;
} else {
  // js_run_binary: no RUNFILES_DIR; discover from script location (runfiles/_main/packages/dashql-app/run_vite.cjs).
  const main = path.resolve(__dirname, '..', '..');
  const overlay = path.join(main, 'packages', 'dashql-app', 'ankoh_overlay');
  const npm = path.join(main, 'node_modules');
  if (fs.existsSync(npm)) applyPaths(fs.existsSync(overlay) ? overlay : null, npm);
  process.env.DASHQL_VITE_ROOT = main;
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
