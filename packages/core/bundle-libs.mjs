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
const out = path.resolve(__dirname, 'build', 'libs');
mkdir.sync(out);
rimraf.sync(out + '/*.wasm');
rimraf.sync(out + '/*.js');
rimraf.sync(out + '/*.js.map');

// -------------------------------
// Copy WASM files

const src = path.resolve(__dirname, 'src');
fs.copyFile(path.resolve(src, 'analyzer', 'analyzer_wasm.wasm'), path.resolve(out, 'dashql-analyzer.wasm'), printErr);
fs.copyFile(path.resolve(src, 'jmespath', 'jmespath_wasm.wasm'), path.resolve(out, 'dashql-jmespath.wasm'), printErr);

// -------------------------------
// BROWSER

const TARGET = ['esnext'];

console.log('[ ESBUILD ] lib/tests-browser.js');
esbuild.build({
    entryPoints: ['./test/index_browser.ts'],
    outfile: 'build/libs/tests-browser.js',
    platform: 'browser',
    format: 'iife',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: true,
    define: { 'process.env.NODE_ENV': '"production"' },
});

console.log('[ ESBUILD ] lib/tests-node.cjs');
esbuild.build({
    entryPoints: ['./test/index_node.ts'],
    outfile: 'build/libs/tests-node.cjs',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    external: ['apache-arrow', 'axios', 'axios-mock-adapter', 'immutable', 'redux', 'web-worker', 'vega'],
});
