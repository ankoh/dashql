import esbuild from 'esbuild';
import path from 'path';
import rimraf from 'rimraf';
import mkdir from 'make-dir';
import { fileURLToPath } from 'url';

// -------------------------------
// Clear directory

const __dirname = path.dirname(fileURLToPath(
    import.meta.url));
const dist = path.resolve(__dirname, 'dist');
mkdir.sync(dist);
rimraf.sync(dist + '/*.wasm');
rimraf.sync(dist + '/*.js');
rimraf.sync(dist + '/*.js.map');

// -------------------------------
// ESM

const TARGET = 'es2020';

console.log('[ ESBUILD ] bench-browser.js');
esbuild.build({
    entryPoints: ['./src/index_browser.ts'],
    outfile: 'dist/bench-browser.js',
    platform: 'browser',
    format: 'iife',
    globalName: 'duckdb',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'both',
});

console.log('[ ESBUILD ] bench-node.js');
esbuild.build({
    entryPoints: ['./src/index_node.ts'],
    outfile: 'dist/bench-node.js',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: 'both',
    // web-worker polyfill needs to be excluded from bundling due to their dynamic require messing with bundled modules
    external: ['web-worker'],
});