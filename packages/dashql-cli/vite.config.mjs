// The command of dashql as one module for Node. The runtime is bundled from its sources, the core stays a package: its Wasm
// file lies next to it (@ankoh/dashql-runtime/node/node_core), and so does hyperdb-wasm with its Wasm file and its worker. The generated packages that the runtime imports are folders
// of Bazel (BUILD.bazel).
import path from 'node:path';

const root = import.meta.dirname;

export default {
    resolve: {
        alias: [
            { find: /^@ankoh\/dashql-protobuf\/(.+)$/, replacement: path.join(root, 'dependencies/dashql-protobuf/$1') },
            { find: /^@ankoh\/dashql-jsonschema\/(.+)$/, replacement: path.join(root, 'dependencies/dashql-jsonschema/$1') },
        ],
    },
    build: {
        ssr: 'src/main.ts',
        outDir: 'dist',
        target: 'node22',
        minify: false,
        emptyOutDir: true,
        rolldownOptions: {
            output: { entryFileNames: 'dashql.js' },
        },
    },
    ssr: {
        noExternal: true,
        external: ['@ankoh/dashql-core', 'hyperdb-wasm'],
    },
};
