#!/usr/bin/env node

/**
 * Bazel bundle script: builds dashql.module.js and writes dist artifacts.
 * Env: DASHQL_GEN_DIR (flatbuffer TS gen dir), DASHQL_WASM_PATH, DASHQL_OUT_DIR.
 */
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const genDir = process.env.DASHQL_GEN_DIR;
const wasmPath = process.env.DASHQL_WASM_PATH;
const outDir = process.env.DASHQL_OUT_DIR;

if (!genDir || !wasmPath || !outDir) {
  console.error('DASHQL_GEN_DIR, DASHQL_WASM_PATH, DASHQL_OUT_DIR required');
  process.exit(1);
}

await fs.promises.mkdir(outDir, { recursive: true });

// Resolve paths: run from repo root, package is packages/dashql-core-api
const pkgDir = path.join(process.cwd(), 'packages', 'dashql-core-api');
const srcDir = path.join(pkgDir, 'src');

// Stage under output dir so we don't modify the source tree. Use a unique dir per run
// to avoid EACCES when previous run left read-only files in bazel-out.
const stageDir = path.join(path.dirname(outDir), `.stage-${process.pid}-${Date.now()}`);
const stageSrc = path.join(stageDir, 'src');
const stageGen = path.join(stageDir, 'gen', 'dashql', 'buffers');
await fs.promises.mkdir(path.dirname(stageGen), { recursive: true });
await fs.promises.cp(srcDir, stageSrc, { recursive: true });
await fs.promises.cp(path.join(genDir, 'dashql', 'buffers'), stageGen, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(stageSrc, 'index.ts')],
  outfile: path.join(outDir, 'dashql.module.js'),
  platform: 'neutral',
  format: 'esm',
  target: 'es2020',
  bundle: true,
  minify: false,
  sourcemap: true,
  external: ['flatbuffers'],
  absWorkingDir: stageDir,
});

await fs.promises.writeFile(
  path.join(outDir, 'dashql.module.d.ts'),
  "export * from './src/index.js';"
);

await fs.promises.copyFile(wasmPath, path.join(outDir, 'dashql.wasm'));

const wasmMap = wasmPath + '.map';
try {
  await fs.promises.access(wasmMap);
  await fs.promises.copyFile(wasmMap, path.join(outDir, 'dashql.wasm.map'));
} catch {
  /* optional */
}
