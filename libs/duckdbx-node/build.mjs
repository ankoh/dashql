import esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';
import rimraf from 'rimraf';
import mkdir from 'make-dir';
import { fileURLToPath } from 'url';

const TARGET_NODE = ['node14.6'];
const EXTERNALS_NODE = ['./dist/duckdbx-node.node'];

// Read CLI flags
let is_debug = false;
let args = process.argv.slice(2);
if (args.length == 0) {
    console.warn('Usage: node build.mjs {debug/release}');
} else {
    if (args[0] == 'debug') is_debug = true;
}
console.log(`DEBUG=${is_debug}`);
// -------------------------------
// Cleanup output directory

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, 'dist');
mkdir.sync(dist);
rimraf.sync(`${dist}/*.js`);
rimraf.sync(`${dist}/*.js.map`);
rimraf.sync(`${dist}/*.mjs`);
rimraf.sync(`${dist}/*.mjs.map`);
rimraf.sync(`${dist}/*.cjs`);
rimraf.sync(`${dist}/*.cjs.map`);

// -------------------------------
// Node bundles

console.log('[ ESBUILD ] duckdbx-node.cjs');
esbuild.build({
    entryPoints: ['./src/index.ts'],
    outfile: 'dist/duckdbx-node.cjs',
    platform: 'node',
    format: 'cjs',
    globalName: 'duckdbx',
    target: TARGET_NODE,
    bundle: true,
    minify: true,
    sourcemap: is_debug ? 'inline' : true,
    external: EXTERNALS_NODE,
});

// -------------------------------
// Test bundles

console.log('[ ESBUILD ] tests-node.cjs');
esbuild.build({
    entryPoints: ['./test/index.ts'],
    outfile: 'dist/tests-node.cjs',
    platform: 'node',
    format: 'cjs',
    target: TARGET_NODE,
    bundle: true,
    minify: false,
    sourcemap: is_debug ? 'inline' : true,
    external: EXTERNALS_NODE,
});

// -------------------------------
// Write declaration files

function printErr(err) {
    if (err) return console.log(err);
}
fs.writeFile(path.join(dist, 'duckdbx-node.d.ts'), "export * from './types/src/index';", printErr);
