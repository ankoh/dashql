/**
 * Builds dashql-protobuf dist from gen + index.ts + bundle: tsc (declarations) + esbuild (bundle).
 * Used by the Bazel dashql_protobuf_dist rule.
 * Env: BUF_GEN_PATH (gen dir), DASHQL_PROTOBUF_DIST (output dir), DASHQL_PROTOBUF_PKG_DIR (package root), RUNFILES_DIR, RUNFILES_MAIN_REPO.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const genPath = process.env.BUF_GEN_PATH;
const outPath = process.env.DASHQL_PROTOBUF_DIST;
const pkgDir = process.env.DASHQL_PROTOBUF_PKG_DIR;
const runfilesDir = process.env.RUNFILES_DIR;
const mainRepo = process.env.RUNFILES_MAIN_REPO || '_main';

if (!genPath || !outPath) {
    console.error('build_bazel: BUF_GEN_PATH, DASHQL_PROTOBUF_DIST required');
    process.exit(1);
}

const main = runfilesDir ? path.join(runfilesDir, mainRepo) : process.cwd();
const nodeModules = process.env.NODE_MODULES || (pkgDir ? path.join(path.dirname(pkgDir), 'node_modules') : path.join(main, 'node_modules'));
const pkg = pkgDir || path.resolve(__dirname, '..');

if (!fs.existsSync(nodeModules)) {
    console.error('build_bazel: node_modules not found at', nodeModules);
    process.exit(1);
}

// Copy gen into package dir so index.ts can resolve ./gen/*
fs.mkdirSync(path.join(pkg, 'gen'), { recursive: true });
// Symlink node_modules into pkg so tsc finds @types/node and baseUrl resolution works
try {
    const pkgNodeModules = path.join(pkg, 'node_modules');
    if (!fs.existsSync(pkgNodeModules)) {
        fs.symlinkSync(nodeModules, pkgNodeModules, 'dir');
    }
} catch (e) {
    console.error('symlink node_modules:', e.message);
}
function cpDir(src, dest) {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const e of entries) {
        const s = path.join(src, e.name);
        const d = path.join(dest, e.name);
        if (e.isDirectory()) {
            fs.mkdirSync(d, { recursive: true });
            cpDir(s, d);
        } else {
            fs.copyFileSync(s, d);
        }
    }
}
cpDir(genPath, path.join(pkg, 'gen'));

const tsc = path.join(nodeModules, 'typescript', 'bin', 'tsc');
const env = { ...process.env, NODE_PATH: nodeModules };

let r = spawnSync(process.execPath, [tsc, '--emitDeclarationOnly', '--declaration', '--outDir', outPath], {
    cwd: pkg,
    env,
    stdio: 'inherit',
});
if (r.status !== 0) process.exit(r.status ?? 1);

env.DASHQL_PROTOBUF_DIST = outPath;
const tsnodeEsm = path.join(main, 'scripts', 'tsnode-esm.js');
if (fs.existsSync(tsnodeEsm)) {
    env.NODE_OPTIONS = (env.NODE_OPTIONS ? env.NODE_OPTIONS + ' ' : '') + '--import=' + tsnodeEsm;
}
r = spawnSync(process.execPath, [path.join(pkg, 'bundle.ts')], {
    cwd: pkg,
    env,
    stdio: 'inherit',
});
process.exit(r.status ?? 1);
