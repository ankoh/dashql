import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import rimraf from 'rimraf';
import mkdir from 'make-dir';
import { fileURLToPath } from 'url';

function printErr(err) {
    if (err) return console.log(err);
}

// -------------------------------
// Clear directory

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, 'dist');
mkdir.sync(dist);
rimraf.sync(dist + '/*.wasm');
rimraf.sync(dist + '/*.js');
rimraf.sync(dist + '/*.js.map');

// -------------------------------
// Copy WASM files

const src = path.resolve(__dirname, 'src');
fs.copyFile(path.resolve(src, 'analyzer', 'analyzer_wasm.wasm'), path.resolve(dist, 'dashql-analyzer.wasm'), printErr);
fs.copyFile(path.resolve(src, 'jmespath', 'jmespath_wasm.wasm'), path.resolve(dist, 'dashql-jmespath.wasm'), printErr);

// -------------------------------
// BROWSER

const TARGET = ['esnext'];
const EXTERNALS = [
    '@dashql/duckdb',
    '@dashql/proto',
    'apache-arrow',
    'flatbuffers',
    'axios',
    'axios-mock-adapter',
    'immutable',
    'redux',
    'vega',
    'vega-lite',
];

console.log('[ ESBUILD ] dashql-core.module.js');
esbuild.build({
    entryPoints: ['./src/targets/dashql-core.module.ts'],
    outfile: 'dist/dashql-core.module.js',
    platform: 'neutral',
    format: 'esm',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'external',
    external: [...EXTERNALS, 'fs', 'path'],
    define: { 'process.env.NODE_ENV': '"production"' },
});

console.log('[ ESBUILD ] dashql-core-browser.module.js');
esbuild.build({
    entryPoints: ['./src/targets/dashql-core-browser.module.ts'],
    outfile: 'dist/dashql-core-browser.module.js',
    platform: 'neutral',
    format: 'esm',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: true,
    external: [...EXTERNALS, 'fs', 'path'],
    define: { 'process.env.NODE_ENV': '"production"' },
});

console.log('[ ESBUILD ] dashql-core-node.js');
esbuild.build({
    entryPoints: ['./src/targets/dashql-core-node.ts'],
    outfile: 'dist/dashql-core-node.js',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: true,
});

console.log('[ ESBUILD ] tests-browser.js');
esbuild.build({
    entryPoints: ['./test/index_browser.ts'],
    outfile: 'dist/tests-browser.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: true,
    define: { 'process.env.NODE_ENV': '"production"' },
});

console.log('[ ESBUILD ] tests-node.js');
esbuild.build({
    entryPoints: ['./test/index_node.ts'],
    outfile: 'dist/tests-node.js',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    external: ['apache-arrow', 'axios', 'axios-mock-adapter', 'immutable', 'redux', 'web-worker', 'vega'],
});

// -------------------------------
// Write delcaration files

fs.writeFile(
    path.join(dist, 'dashql-core.module.d.ts'),
    "export * from './types/src/targets/dashql-core.module';",
    printErr,
);
fs.writeFile(
    path.join(dist, 'dashql-core-browser.module.d.ts'),
    "export * from './types/src/targets/dashql-core-browser.module';",
    printErr,
);
fs.writeFile(
    path.join(dist, 'dashql-core-node.d.ts'),
    "export * from './types/src/targets/dashql-core-node';",
    printErr,
);
