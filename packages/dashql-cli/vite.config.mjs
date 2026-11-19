// The command of dashql as one module for Node. @akohn/dashql is bundled from its sources, the Wasm of the core stays a
// file of that package (@akohn/dashql/wasm, platform/node/node_core.ts), and hyperdb-wasm stays a package with its Wasm
// file and its worker. The generated packages that @akohn/dashql imports are folders of Bazel (BUILD.bazel).
import path from 'node:path';

const root = import.meta.dirname;

export default {
    resolve: {
        alias: [
            { find: /^@akohn\/dashql-wasm\/(.+)$/, replacement: path.join(root, '../../node_modules/@akohn/dashql/dependencies/dashql-wasm/$1') },
            { find: /^@akohn\/dashql-flatbuffers\/(.+)$/, replacement: path.join(root, '../../node_modules/@akohn/dashql/dependencies/dashql-flatbuffers/$1') },
            { find: /^@akohn\/dashql-protobuf\/(.+)$/, replacement: path.join(root, '../../node_modules/@akohn/dashql/dependencies/dashql-protobuf/$1') },
            { find: /^@akohn\/dashql-jsonschema\/(.+)$/, replacement: path.join(root, '../../node_modules/@akohn/dashql/dependencies/dashql-jsonschema/$1') },
        ],
    },
    build: {
        ssr: 'src/main.ts',
        outDir: 'dist',
        target: 'node22',
        minify: false,
        emptyOutDir: true,
        rolldownOptions: {
            // npm runs the command of the package as a script
            output: { entryFileNames: 'dashql.js', banner: '#!/usr/bin/env node' },
        },
    },
    ssr: {
        noExternal: true,
        external: ['hyperdb-wasm'],
    },
};
