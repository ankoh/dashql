import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, 'dist');

function printErr(err) {
    if (err) return console.log(err);
}

fs.writeFile(path.join(dist, 'dashql_core.d.ts'), "export * from './types/index_web';", printErr);
fs.writeFile(path.join(dist, 'dashql_core_node.d.ts'), "export * from './types/index_node';", printErr);
