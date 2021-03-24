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
fs.copyFile(path.resolve(src, 'analyzer', 'analyzer_wasm.wasm'), path.resolve(dist, 'dashql_analyzer.wasm'), printErr);

// -------------------------------
// BROWSER

const TARGET = 'es2020';
const EXTERNALS = [
    '@dashql/webdb',
    '@dashql/proto',
    'flatbuffers',
    'axios',
    'hash-wasm',
    'immutable',
    'redux',
    'vega',
    'vega-lite',
];

console.log('[ ESBUILD ] dashql-core.module.js');
esbuild.build({
    entryPoints: ['./src/index.ts'],
    outfile: 'dist/dashql-core.module.js',
    platform: 'browser',
    format: 'esm',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
    external: EXTERNALS,
    define: { 'process.env.NODE_ENV': '"production"' },
});

console.log('[ ESBUILD ] dashql-core-browser.module.js');
esbuild.build({
    entryPoints: ['./src/index_browser.ts'],
    outfile: 'dist/dashql-core-browser.module.js',
    platform: 'browser',
    format: 'esm',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
    external: EXTERNALS,
    define: { 'process.env.NODE_ENV': '"production"' },
});

console.log('[ ESBUILD ] dashql-core-node.js');
esbuild.build({
    entryPoints: ['./src/index_node.ts'],
    outfile: 'dist/dashql-core-node.js',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
});

console.log('[ ESBUILD ] tests-browser.js');
esbuild.build({
    entryPoints: ['./test/index.ts'],
    outfile: 'dist/tests-browser.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'both',
    define: { 'process.env.NODE_ENV': '"production"' },
});

// -------------------------------
// Write delcaration files

fs.writeFile(path.join(dist, 'dashql-core.module.d.ts'), "export * from './types/src/';", printErr);
fs.writeFile(
    path.join(dist, 'dashql-core-browser.module.d.ts'),
    "export * from './types/src/index_browser';",
    printErr,
);
fs.writeFile(path.join(dist, 'dashql-core-node.d.ts'), "export * from './types/src/index_node';", printErr);
