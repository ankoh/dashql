// The command of dashql as one module for Node. The SDK is bundled from its sources, the core stays a package: its Wasm
// file lies next to it (@ankoh/dashql-sdk/node/node_core).
export default {
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
        external: ['@ankoh/dashql-core'],
    },
};
