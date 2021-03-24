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

console.log('[ ESBUILD ] webdb-browser.module.js');
esbuild.build({
    entryPoints: ['./src/platform/browser/index_module.ts'],
    outfile: 'dist/webdb-browser.module.js',
    platform: 'browser',
    format: 'esm',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
    external: EXTERNALS,
});

console.log('[ ESBUILD ] webdb-node.module.js');
esbuild.build({
    entryPoints: ['./src/platform/node/index_module.ts'],
    outfile: 'dist/webdb-node.module.js',
    platform: 'node',
    format: 'esm',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
    external: EXTERNALS,
});

// -------------------------------
// Browser

console.log('[ ESBUILD ] webdb-browser-serial.js');
esbuild.build({
    entryPoints: ['./src/platform/browser/index_serial.ts'],
    outfile: 'dist/webdb-browser-serial.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    sourcemap: 'external',
});

console.log('[ ESBUILD ] webdb-browser-parallel.js');
esbuild.build({
    entryPoints: ['./src/platform/browser/index_parallel.ts'],
    outfile: 'dist/webdb-browser-parallel.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
});

console.log('[ ESBUILD ] webdb-browser-parallel.worker.js');
esbuild.build({
    entryPoints: ['./src/platform/browser/worker.ts'],
    outfile: 'dist/webdb-browser-parallel.worker.js',
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

// -------------------------------
// Tests

console.log('[ ESBUILD ] tests-browser.js');
esbuild.build({
    entryPoints: ['./test/index_browser.ts'],
    outfile: 'dist/tests-browser.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'both',
});

console.log('[ ESBUILD ] tests-node.js');
esbuild.build({
    entryPoints: ['./test/index_node.ts'],
    outfile: 'dist/tests-node.js',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'both',
});

// -------------------------------
// Write delcaration files

// ESM declarations
fs.writeFile(path.join(dist, 'webdb.module.d.ts'), "export * from './types/src/';", printErr);
fs.writeFile(
    path.join(dist, 'webdb-browser.module.d.ts'),
    "export * from './types/src/platform/browser/index_module';",
    printErr,
);
fs.writeFile(
    path.join(dist, 'webdb-node.module.d.ts'),
    "export * from './types/src/platform/node/index_module';",
    printErr,
);

// Browser declarations
fs.writeFile(
    path.join(dist, 'webdb-browser-serial.d.ts'),
    "export * from './types/src/platform/browser/index_serial';",
    printErr,
);
fs.writeFile(
    path.join(dist, 'webdb-browser-parallel.d.ts'),
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
