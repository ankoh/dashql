import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import rimraf from 'rimraf';
import mkdir from 'make-dir';
import { fileURLToPath } from 'url';

// Bundling node is a bit problematic right now.
// The web worker ponyfill is commonjs (dynamic require) and prevents us from releasing an async node module.

function printErr(err) {
    if (err) return console.log(err);
}

// -------------------------------
// Copy WASM files

const __dirname = path.dirname(fileURLToPath(
    import.meta.url));
const dist = path.resolve(__dirname, 'dist');
rimraf.sync(dist);
mkdir.sync(dist);

// -------------------------------
// Copy WASM files

const src = path.resolve(__dirname, 'src');
fs.copyFile(path.resolve(src, 'bindings', 'webdb_wasm.wasm'), path.resolve(dist, 'webdb.wasm'), printErr);

// -------------------------------
// ESM

const TARGET = 'es2020';
const EXTERNALS = ['flatbuffers', '@dashql/proto'];

console.log('[ ESBUILD ] webdb.module.js');
esbuild.build({
    entryPoints: [
        './src/targets/webdb.module.ts',
        './src/targets/webdb-browser.module.ts',
        './src/targets/webdb-node.module.ts',
    ],
    entryNames: '[name]',
    outdir: './dist',
    platform: 'neutral',
    format: 'esm',
    target: TARGET,
    splitting: true,
    bundle: true,
    minify: true,
    sourcemap: 'external',
    external: [...EXTERNALS, 'fs', 'path', 'fast-glob'],
});

// -------------------------------
// Browser

console.log('[ ESBUILD ] webdb-browser.js');
esbuild.build({
    entryPoints: ['./src/targets/webdb-browser-serial.ts'],
    outfile: 'dist/webdb-browser.js',
    platform: 'browser',
    format: 'iife',
    globalName: 'webdb',
    target: TARGET,
    bundle: true,
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    sourcemap: 'external',
});

console.log('[ ESBUILD ] webdb-browser-parallel.js');
esbuild.build({
    entryPoints: ['./src/targets/webdb-browser-parallel.ts'],
    outfile: 'dist/webdb-browser-parallel.js',
    platform: 'browser',
    format: 'iife',
    globalName: 'webdb',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
});

console.log('[ ESBUILD ] webdb-browser-parallel.worker.js');
esbuild.build({
    entryPoints: ['./src/targets/webdb-browser-parallel.worker.ts'],
    outfile: 'dist/webdb-browser-parallel.worker.js',
    platform: 'browser',
    format: 'iife',
    globalName: 'webdb',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
});

// -------------------------------
// NODE

console.log('[ ESBUILD ] webdb-node.js');
esbuild.build({
    entryPoints: ['./src/targets/webdb-node-serial.ts'],
    outfile: 'dist/webdb-node.js',
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    bundle: true,
    minify: true,
    sourcemap: 'external',
});

console.log('[ ESBUILD ] webdb-node-parallel.js');
esbuild.build({
    entryPoints: ['./src/targets/webdb-node-parallel.ts'],
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
    entryPoints: ['./src/targets/webdb-node-parallel.worker.ts'],
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
    globalName: 'webdb',
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
    // web-worker polyfill needs to be excluded from bundling due to their dynamic require messing with bundled modules
    external: ['web-worker'],
});

// -------------------------------
// Write declaration files

// ESM declarations
fs.writeFile(path.join(dist, 'webdb.module.d.ts'), "export * from './types/src/';", printErr);
fs.writeFile(
    path.join(dist, 'webdb-browser.module.d.ts'),
    "export * from './types/src/targets/webdb-browser.module';",
    printErr,
);
fs.writeFile(
    path.join(dist, 'webdb-node.module.d.ts'),
    "export * from './types/src/targets/webdb-node.module';",
    printErr,
);

// Browser declarations
fs.writeFile(
    path.join(dist, 'webdb-browser.d.ts'),
    "export * from './types/src/targets/webdb-browser-serial';",
    printErr,
);
fs.writeFile(
    path.join(dist, 'webdb-browser-parallel.d.ts'),
    "export * from './types/src/targets/webdb-browser-parallel';",
    printErr,
);

// Node declarations
fs.writeFile(path.join(dist, 'webdb-node.d.ts'), "export * from './types/src/targets/webdb-node-serial';", printErr);
fs.writeFile(
    path.join(dist, 'webdb-node-parallel.d.ts'),
    "export * from './types/src/targets/webdb-node-parallel';",
    printErr,
);