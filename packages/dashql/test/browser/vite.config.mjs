import { defineConfig } from 'vite';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const root = process.cwd();
const packaged = path.resolve(root, 'packaged');
const metadata = JSON.parse(readFileSync(path.join(packaged, 'package.json'), 'utf8'));
// Exact aliases expose only the published entry points of the bindings, never private package files.
const packageAliases = Object.entries(metadata.exports).filter(([entry]) => !entry.includes('*')).map(([entry, target]) => ({
    find: new RegExp(`^${metadata.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${entry === '.' ? '' : entry.slice(1)}(\\?.*)?$`),
    replacement: path.resolve(packaged, typeof target === 'string' ? target : target.import) + '$1',
}));
export default defineConfig({
    root,
    publicDir: false,
    plugins: [{
        name: 'bazel-preserve-html-entry-symlinks',
        enforce: 'pre',
        resolveId(id) {
            if (id.endsWith('.html') && path.isAbsolute(id)) return id;
        },
    }],
    resolve: {
        alias: [
            { find: /^vitest$/, replacement: path.resolve(root, 'vitest_compat.ts') },
            // The generated packages of the core module that the sources of the bindings import
            { find: /^@ankoh\/dashql-wasm\/(.+)$/, replacement: path.resolve(root, 'inputs/dependencies/dashql-wasm/$1') },
            { find: /^@ankoh\/dashql-flatbuffers\/(.+)$/, replacement: path.resolve(root, 'inputs/dependencies/dashql-flatbuffers/$1') },
            ...packageAliases,
        ],
    },
    build: {
        target: 'es2020',
        rolldownOptions: {
            input: path.resolve(root, 'tests.html'),
            external: id => id.startsWith('node:'),
        },
    },
    worker: { format: 'es' },
});
