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
fs.copyFile(path.resolve(src, 'bindings', 'webdb_wasm.wasm'), path.resolve(dist, 'webdb.wasm'), printErr);

// -------------------------------
// ESM

const TARGET = 'es2020';
const EXTERNALS = ['flatbuffers', '@dashql/proto'];

console.log('[ ESBUILD ] webdb.module.js');
esbuild.build({
    entryPoints: ['./src/index.ts'],
    outfile: 'dist/webdb.module.js',
    platform: 'neutral',
    format: 'esm',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
    external: EXTERNALS,
});

// -------------------------------
// Browser

console.log('[ ESBUILD ] webdb-serial.js');
esbuild.build({
    entryPoints: ['./src/platform/browser/index_serial.ts'],
    outfile: 'dist/webdb-serial.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    sourcemap: 'external',
});

console.log('[ ESBUILD ] webdb-parallel.js');
esbuild.build({
    entryPoints: ['./src/platform/browser/index_parallel.ts'],
    outfile: 'dist/webdb-parallel.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
});

console.log('[ ESBUILD ] webdb-parallel.worker.js');
esbuild.build({
    entryPoints: ['./src/platform/browser/worker.ts'],
    outfile: 'dist/webdb-parallel.worker.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
});

// -------------------------------
// NODE

console.log('[ ESBUILD ] webdb-node-serial.js');
esbuild.build({
    entryPoints: ['./src/platform/node/index_serial.ts'],
    outfile: 'dist/webdb-node-serial.js',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
});

console.log('[ ESBUILD ] webdb-node-parallel.js');
esbuild.build({
    entryPoints: ['./src/platform/node/index_parallel.ts'],
    outfile: 'dist/webdb-node-parallel.js',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
});

console.log('[ ESBUILD ] webdb-node-parallel.worker.js');
esbuild.build({
    entryPoints: ['./src/platform/node/worker.ts'],
    outfile: 'dist/webdb-node-parallel.worker.js',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
});

console.log('[ ESBUILD ] node-webworker.js');
esbuild.build({
    entryPoints: ['./src/platform/node/node_webworker.js'],
    outfile: 'dist/node-webworker.js',
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

console.log('[ ESBUILD ] tests-node.js');
esbuild.build({
    entryPoints: ['./test/node/index.ts'],
    outfile: 'dist/tests-node.js',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
});

// -------------------------------
// Write delcaration files

// ESM declarations
fs.writeFile(path.join(dist, 'webdb.module.d.ts'), "export * from './types/src/';", printErr);

// Browser declarations
fs.writeFile(
    path.join(dist, 'webdb-serial.d.ts'),
    "export * from './types/src/platform/browser/index_serial';",
    printErr,
);
fs.writeFile(
    path.join(dist, 'webdb-parallel.d.ts'),
    "export * from './types/src/platform/browser/index_parallel';",
    printErr,
);

// Node declarations
fs.writeFile(
    path.join(dist, 'webdb-node-serial.d.ts'),
    "export * from './types/src/platform/node/index_serial';",
    printErr,
);
fs.writeFile(
    path.join(dist, 'webdb-node-parallel.d.ts'),
    "export * from './types/src/platform/node/index_parallel';",
    printErr,
);
