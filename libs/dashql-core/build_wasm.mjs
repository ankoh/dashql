import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read CLI flags
let isDebug = false;
let args = process.argv.slice(2);
if (args.length == 0) {
    console.warn('Usage: node build_wasm.mjs {debug/release}');
} else {
    if (args[0] == 'debug') isDebug = true;
}
console.log(`DEBUG=${isDebug}`);

// -------------------------------
// Build wasm

const mode = isDebug ? '' : '--release';
execSync(`wasm-pack build -d dist/wasm --target web --features wasm --no-default-features  ${mode}`, {
    cwd: __dirname,
    stdio: 'inherit',
});

// -------------------------------
// Write files

function printErr(err) {
    if (err) return console.log(err);
}

const dist_wasm = path.resolve(__dirname, 'dist', 'wasm');
fs.rmSync(path.join(dist_wasm, 'package.json'));
fs.renameSync(path.join(dist_wasm, 'dashql_core.js'), path.join(dist_wasm, 'dashql_core.mjs'));

const index_exports = `
export * from './dashql_core';
import init from './dashql_core';
export default init;
`;
fs.writeFileSync(path.join(dist_wasm, 'index.mjs'), index_exports, printErr);
fs.writeFileSync(path.join(dist_wasm, 'index.d.ts'), index_exports, printErr);
