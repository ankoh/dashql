import esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';
import rimraf from 'rimraf';
import mkdir from 'make-dir';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TARGET_NODE = ['node14.6'];
const EXTERNALS_NODE = ['./dist/node/dashql_core.node'];

// Read CLI flags
let isDebug = false;
let args = process.argv.slice(2);
if (args.length == 0) {
    console.warn('Usage: node build_node.mjs {debug/release}');
} else {
    if (args[0] == 'debug') isDebug = true;
}
console.log(`DEBUG=${isDebug}`);

// -------------------------------
// Cleanup output directory

const dist_node = path.resolve(__dirname, 'dist', 'node');
mkdir.sync(dist_node);
rimraf.sync(`${dist_node}/*.js`);
rimraf.sync(`${dist_node}/*.js.map`);
rimraf.sync(`${dist_node}/*.mjs`);
rimraf.sync(`${dist_node}/*.mjs.map`);
rimraf.sync(`${dist_node}/*.cjs`);
rimraf.sync(`${dist_node}/*.cjs.map`);

// -------------------------------
// Build node

const mode = isDebug ? '' : '--release';
execSync(
    `cargo-cp-artifact -nc ./dist/node/dashql_core.node -- cargo build --lib --features node --message-format=json-render-diagnostics ${mode}`,
    {
        cwd: __dirname,
        stdio: 'inherit',
    },
);

// -------------------------------
// Node bundles

console.log('[ ESBUILD ] js/dashql_core.cjs');
esbuild.build({
    entryPoints: ['./js/node_api.ts'],
    outfile: 'dist/node/dashql_core.cjs',
    platform: 'node',
    format: 'cjs',
    globalName: 'duckdbx',
    target: TARGET_NODE,
    bundle: true,
    minify: true,
    sourcemap: isDebug ? 'inline' : true,
    external: EXTERNALS_NODE,
});

// -------------------------------
// Write files

function printErr(err) {
    if (err) return console.log(err);
}
fs.writeFileSync(path.join(dist_node, 'dashql_core.d.ts'), "export * from '../types/node_api';", printErr);
fs.writeFileSync(path.join(dist_node, 'index.cjs'), "module.exports = require('./dashql_core');", printErr);
fs.writeFileSync(path.join(dist_node, 'index.d.ts'), "export * from './dashql_core';", printErr);
