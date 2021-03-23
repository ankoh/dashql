import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function printErr(err) {
    if (err) return console.log(err);
}

// Bundling node is a bit problematic right now.
// The web worker ponyfill is commonjs (dynamic require) and prevents us from releasing an async node module.

// -------------------------------
// Copy WASM files

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, 'dist');
const src = path.resolve(__dirname, 'src');
fs.copyFile(path.resolve(src, 'webdb_wasm.wasm'), path.resolve(dist, 'webdb.wasm'), printErr);

// -------------------------------
// BROWSER

const TARGET = 'es2020';
const EXTERNALS = ['flatbuffers', '@dashql/proto'];

console.log('[ ESBUILD ] webdb.js');
esbuild.build({
    entryPoints: ['./src/targets/sync_browser.ts'],
    outfile: 'dist/webdb.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
});

console.log('[ ESBUILD ] webdb.min.js');
esbuild.build({
    entryPoints: ['./src/targets/sync_browser.ts'],
    outfile: 'dist/webdb.min.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
});

console.log('[ ESBUILD ] webdb.mjs');
esbuild.build({
    entryPoints: ['./src/targets/sync_browser.ts'],
    outfile: 'dist/webdb.mjs',
    platform: 'browser',
    format: 'esm',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
    external: EXTERNALS,
});

console.log('[ ESBUILD ] webdb-async.js');
esbuild.build({
    entryPoints: ['./src/targets/async_browser.ts'],
    outfile: 'dist/webdb-async.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
});

console.log('[ ESBUILD ] webdb-async.min.js');
esbuild.build({
    entryPoints: ['./src/targets/async_browser.ts'],
    outfile: 'dist/webdb-async.min.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
});

console.log('[ ESBUILD ] webdb-async.mjs');
esbuild.build({
    entryPoints: ['./src/targets/async_browser.ts'],
    outfile: 'dist/webdb-async.mjs',
    platform: 'neutral',
    format: 'esm',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
    external: EXTERNALS,
});

console.log('[ ESBUILD ] webdb-async.worker.js');
esbuild.build({
    entryPoints: ['./src/targets/async_worker_browser.ts'],
    outfile: 'dist/webdb-async.worker.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
});

console.log('[ ESBUILD ] webdb-async.worker.min.js');
esbuild.build({
    entryPoints: ['./src/targets/async_worker_browser.ts'],
    outfile: 'dist/webdb-async.worker.min.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
});

// -------------------------------
// NODE

console.log('[ ESBUILD ] webdb-node.cjs');
esbuild.build({
    entryPoints: ['./src/targets/sync_node.ts'],
    outfile: 'dist/webdb-node.js',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
});

console.log('[ ESBUILD ] webdb-node.min.cjs');
esbuild.build({
    entryPoints: ['./src/targets/sync_node.ts'],
    outfile: 'dist/webdb-node.min.cjs',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
});

console.log('[ ESBUILD ] webdb-node-async.cjs');
esbuild.build({
    entryPoints: ['./src/targets/async_node.ts'],
    outfile: 'dist/webdb-node-async.cjs',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
});

console.log('[ ESBUILD ] webdb-node-async.min.cjs');
esbuild.build({
    entryPoints: ['./src/targets/async_node.ts'],
    outfile: 'dist/webdb-node-async.min.cjs',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
});

console.log('[ ESBUILD ] webdb-node-async.worker.cjs');
esbuild.build({
    entryPoints: ['./src/targets/async_worker_node.ts'],
    outfile: 'dist/webdb-node-async.worker.cjs',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
});

console.log('[ ESBUILD ] webdb-node-async.worker.min.cjs');
esbuild.build({
    entryPoints: ['./src/targets/async_worker_node.ts'],
    outfile: 'dist/webdb-node-async.worker.min.cjs',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
});

// -------------------------------
// Tests

console.log('[ ESBUILD ] tests-browser.js');
esbuild.build({
    entryPoints: ['./test/browser/index.ts'],
    outfile: 'dist/tests-browser.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
});

console.log('[ ESBUILD ] tests-node.cjs');
esbuild.build({
    entryPoints: ['./test/node/index.ts'],
    outfile: 'dist/tests-node.cjs',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
});

// -------------------------------
// Write delcaration files

// Node declarations
fs.writeFile(path.join(dist, 'webdb-node.d.ts'), "export * from './types/src/targets/sync_node';", printErr);
fs.writeFile(path.join(dist, 'webdb-node.min.d.ts'), "export * from './types/src/targets/sync_node';", printErr);
fs.writeFile(path.join(dist, 'webdb-node-async.d.ts'), "export * from './types/src/targets/sync_node';", printErr);
fs.writeFile(path.join(dist, 'webdb-node-async.min.d.ts'), "export * from './types/src/targets/sync_node';", printErr);
fs.writeFile(
    path.join(dist, 'webdb-node-async.worker.d.ts'),
    "export * from './types/src/targets/async_worker_node';",
    printErr,
);
fs.writeFile(
    path.join(dist, 'webdb-node-async.worker.min.d.ts'),
    "export * from './types/src/targets/async_worker_node';",
    printErr,
);

// Browser declarations
fs.writeFile(path.join(dist, 'webdb.d.ts'), "export * from './types/src/targets/sync_browser';", printErr);
fs.writeFile(path.join(dist, 'webdb.min.d.ts'), "export * from './types/src/targets/sync_node';", printErr);
fs.writeFile(path.join(dist, 'webdb-async.d.ts'), "export * from './types/src/targets/async_browser';", printErr);
fs.writeFile(
    path.join(dist, 'webdb-async.min.d.ts'),
    "export * from './types/src/targets/async_worker_browser';",
    printErr,
);
fs.writeFile(
    path.join(dist, 'webdb-async.worker.d.ts'),
    "export * from './types/src/targets/async_worker_browser';",
    printErr,
);
fs.writeFile(
    path.join(dist, 'webdb-async.worker.min.d.ts'),
    "export * from './types/src/targets/async_worker_browser';",
    printErr,
);
