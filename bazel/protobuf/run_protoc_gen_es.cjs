/**
 * Launcher for protoc-gen-es so it can be used as a Bazel executable (tool).
 * Protoc invokes this binary; we re-exec the actual plugin from the npm package.
 * Resolves plugin from NODE_MODULES, RUNFILES_DIR, or from script location (protoc often does not pass env).
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

function findPlugin() {
    const mainRepo = process.env.RUNFILES_MAIN_REPO || '_main';

    if (process.env.NODE_MODULES) {
        const p = path.join(process.env.NODE_MODULES, '@bufbuild', 'protoc-gen-es', 'bin', 'protoc-gen-es');
        if (fs.existsSync(p)) return p;
    }

    const runfilesDir = process.env.RUNFILES_DIR;
    if (runfilesDir) {
        const underNodeModules = path.join(runfilesDir, mainRepo, 'node_modules', '@bufbuild', 'protoc-gen-es', 'bin', 'protoc-gen-es');
        if (fs.existsSync(underNodeModules)) return underNodeModules;
        const underNpm = path.join(runfilesDir, mainRepo, 'npm', 'node_modules', '@bufbuild', 'protoc-gen-es', 'bin', 'protoc-gen-es');
        if (fs.existsSync(underNpm)) return underNpm;
    }

    // Protoc often invokes the plugin without RUNFILES_DIR. Infer main repo root from this script's location in runfiles (e.g. _main/bazel/protobuf/run_protoc_gen_es.cjs).
    const mainRoot = path.resolve(__dirname, '..', '..');
    const underInferred = path.join(mainRoot, 'node_modules', '@bufbuild', 'protoc-gen-es', 'bin', 'protoc-gen-es');
    if (fs.existsSync(underInferred)) return underInferred;

    return null;
}

const pluginPath = findPlugin();
if (!pluginPath) {
    console.error('run_protoc_gen_es: protoc-gen-es not found (RUNFILES_DIR=', process.env.RUNFILES_DIR, ')');
    process.exit(1);
}
try {
    execFileSync(process.execPath, [pluginPath, ...process.argv.slice(2)], {
        stdio: 'inherit',
    });
} catch (e) {
    process.exit(e.status ?? 1);
}
