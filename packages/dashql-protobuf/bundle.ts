import esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

function printErr(err: NodeJS.ErrnoException | null) {
    if (err) return console.log(err);
}

const dist = process.env.DASHQL_PROTOBUF_DIST || path.resolve(fileURLToPath(new URL('./dist', import.meta.url)));

console.log(`[ ESBUILD ] dashql-proto.module.js`);
esbuild.build({
    entryPoints: [`./index.ts`],
    outfile: path.join(dist, 'dashql-proto.module.js'),
    platform: 'neutral',
    format: 'esm',
    target: 'es2020',
    bundle: true,
    minify: false,
    sourcemap: true,
    external: ['@bufbuild/protobuf', '@connectrpc/connect-web'],
});

fs.mkdirSync(dist, { recursive: true });
fs.writeFile(path.join(dist, 'dashql-proto.module.d.ts'), "export * from './index.js';", printErr);
