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

const wasmIn = new URL(wasmPath, import.meta.url);
const wasmOut = new URL('dashql.wasm', dist);
const wasmMapIn = new URL(`${wasmPath}.map`, import.meta.url);
const wasmMapOut = new URL('dashql.wasm.map', dist);

async function deleteIfExists(path: URL) {
    try {
        await fs.promises.access(path);
        await fs.promises.unlink(path);
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }
}
console.info(`[ DELETE  ] ${wasmMapOut}`);
await deleteIfExists(wasmMapOut);

console.info(`[ COPY    ] ${wasmIn} -> ${wasmOut}`);
await fs.promises.copyFile(wasmIn, wasmOut);

try {
    await fs.promises.access(wasmMapIn);
    await fs.promises.copyFile(wasmMapIn, wasmMapOut);
    console.info(`[ COPY    ] ${wasmMapIn} -> ${wasmMapOut}`);
} catch (err) {
    if (err.code === "ENOENT") {
        console.error(`Source file not found: ${wasmMapIn}`);
    }
}
