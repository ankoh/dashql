import esbuild from 'esbuild';
import path from 'path';
import mkdir from 'make-dir';
import { fileURLToPath } from 'url';

// Bundling node is a bit problematic right now.
// The web worker ponyfill is commonjs (dynamic require) and prevents us from releasing an async node module.

function printErr(err) {
    if (err) return console.log(err);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, 'dist');
mkdir.sync(dist);

// -------------------------------
// ESM

const TARGET = 'es2020';
const EXTERNALS = ['web-worker', 'react-native-fetch-blob', 'apache-arrow', 'canvas'];

console.log('[ ESBUILD ] am4.js');
esbuild.build({
    entryPoints: ['./src/suite_am4.ts'],
    outfile: 'dist/am4.js',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: true,
    external: EXTERNALS,
});

console.log('[ ESBUILD ] vega_scaling.js');
esbuild.build({
    entryPoints: ['./src/suite_vega_scaling.ts'],
    outfile: 'dist/vega_scaling.js',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: false,
    sourcemap: true,
    external: EXTERNALS,
});
