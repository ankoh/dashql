import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TARGET = 'es2017';
const EXTERNALS = ['flatbuffers', '@dashql/proto'];

// -------------------------------
// BROWSER

esbuild.build({
    entryPoints: ['./src/index_web.ts'],
    outfile: 'dist/webdb.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
    external: [],
});

esbuild.build({
    entryPoints: ['./src/index_web.ts'],
    outfile: 'dist/webdb.min.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
    external: [],
});

esbuild.build({
    entryPoints: ['./src/index_web.ts'],
    outfile: 'dist/webdb.mjs',
    platform: 'browser',
    format: 'esm',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
    external: EXTERNALS,
});

esbuild.build({
    entryPoints: ['./src/index_async.ts'],
    outfile: 'dist/webdb-async.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
    external: [],
});

esbuild.build({
    entryPoints: ['./src/index_async.ts'],
    outfile: 'dist/webdb-async.min.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
    external: [],
});

esbuild.build({
    entryPoints: ['./src/index_async.ts'],
    outfile: 'dist/webdb-async.mjs',
    platform: 'neutral',
    format: 'esm',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
    external: EXTERNALS,
});

esbuild.build({
    entryPoints: ['./src/worker_web.ts'],
    outfile: 'dist/webdb-async.worker.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
    external: [],
});

esbuild.build({
    entryPoints: ['./src/worker_web.ts'],
    outfile: 'dist/webdb-async.worker.min.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
    external: [],
});

// -------------------------------
// NODE

esbuild.build({
    entryPoints: ['./src/index_node.ts'],
    outfile: 'dist/webdb-node.js',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
    external: EXTERNALS,
});

esbuild.build({
    entryPoints: ['./src/index_node.ts'],
    outfile: 'dist/webdb-node.min.js',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
    external: EXTERNALS,
});

esbuild.build({
    entryPoints: ['./src/index_async.ts'],
    outfile: 'dist/webdb-node-async.js',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
    external: EXTERNALS,
});

esbuild.build({
    entryPoints: ['./src/index_async.ts'],
    outfile: 'dist/webdb-node-async.min.js',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
    external: EXTERNALS,
});

esbuild.build({
    entryPoints: ['./src/worker_node.ts'],
    outfile: 'dist/webdb-node-async.worker.js',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
    external: EXTERNALS,
});

esbuild.build({
    entryPoints: ['./src/worker_node.ts'],
    outfile: 'dist/webdb-node-async.worker.min.js',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
    external: EXTERNALS,
});

// -------------------------------
// Tests

esbuild.build({
    entryPoints: ['./test/index.ts'],
    outfile: 'dist/webdb-tests.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
});

// -------------------------------
// Write delcaration files

const dist = path.resolve(__dirname, 'dist');

function printErr(err) {
    if (err) return console.log(err);
}

// Node declarations
fs.writeFile(path.join(dist, 'webdb-node.d.ts'), "export * from './types/src/index_node';", printErr);
fs.writeFile(path.join(dist, 'webdb-node.min.d.ts'), "export * from './types/src/index_node';", printErr);
fs.writeFile(path.join(dist, 'webdb-node-async.d.ts'), "export * from './types/src/index_node';", printErr);
fs.writeFile(path.join(dist, 'webdb-node-async.min.d.ts'), "export * from './types/src/index_node';", printErr);
fs.writeFile(path.join(dist, 'webdb-node-async.worker.d.ts'), "export * from './types/src/worker_node';", printErr);
fs.writeFile(path.join(dist, 'webdb-node-async.worker.min.d.ts'), "export * from './types/src/worker_node';", printErr);

// Browser declarations
fs.writeFile(path.join(dist, 'webdb.d.ts'), "export * from './types/src/index_web';", printErr);
fs.writeFile(path.join(dist, 'webdb.min.d.ts'), "export * from './types/src/index_node';", printErr);
fs.writeFile(path.join(dist, 'webdb-async.d.ts'), "export * from './types/src/index_async';", printErr);
fs.writeFile(path.join(dist, 'webdb-async.min.d.ts'), "export * from './types/src/worker_web';", printErr);
fs.writeFile(path.join(dist, 'webdb-async.worker.d.ts'), "export * from './types/src/worker_web';", printErr);
fs.writeFile(path.join(dist, 'webdb-async.worker.min.d.ts'), "export * from './types/src/worker_web';", printErr);

// -------------------------------
// Copy WASM files

const src = path.resolve(__dirname, 'src');

fs.copyFile(path.resolve(src, 'webdb_wasm.wasm'), path.resolve(dist, 'webdb.wasm'), printErr);
