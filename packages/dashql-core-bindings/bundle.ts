import * as esbuild from 'esbuild';
import * as fs from 'fs';

const dist = new URL('dist/', import.meta.url);

const args = process.argv.slice(2);
let mode = 'o3';
if (args.length == 0) {
    console.warn('Usage: node bundle.mjs {o0/o2/o3}');
} else {
    mode = args[0];
}
console.log(`MODE=${mode}`);

console.log(`[ ESBUILD ] dashql.module.js`);
await esbuild.build({
    entryPoints: [`./src/index.ts`],
    outfile: `dist/dashql.module.js`,
    platform: 'neutral',
    format: 'esm',
    target: 'es2020',
    bundle: true,
    minify: false,
    sourcemap: true,
    external: ['flatbuffers'],
});

await fs.promises.writeFile(new URL('dashql.module.d.ts', dist), "export * from './src/index.js';");

let wasmPath: string;
switch (mode) {
    case 'o0':
    case 'o2':
    case 'o3':
        wasmPath = `../dashql-core/build/wasm/${mode}/dashql.wasm`;
        break;
    default:
        throw new Error(`unsupported mode: ${mode}`);
}

const wasmUrl = new URL(wasmPath, import.meta.url);
const wasmMapPath = new URL(`${wasmPath}.map`, import.meta.url);

await fs.promises.copyFile(wasmUrl, new URL('dashql.wasm', dist));
console.info(`[ COPY    ] ${wasmUrl}`);

try {
    await fs.promises.access(wasmMapPath);
    await fs.promises.copyFile(wasmMapPath, new URL('dashql.wasm.map', dist));
    console.info(`[ COPY    ] ${wasmMapPath}`);
} catch (err) {
    if (err.code === "ENOENT") {
        console.error(`Source file not found: ${wasmMapPath}`);
    }
}
