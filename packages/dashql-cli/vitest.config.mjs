// The tests of dashql in Node. The generated packages that @akohn/dashql imports are folders of Bazel (BUILD.bazel).
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
    test: {
        environment: 'node',
        globals: true,
        include: ['src/**/*.test.ts'],
        // Every `dashql run` starts the embedded Hyper, about 1.5 s, and a test runs up to three of them. A loaded host
        // makes that four to six times slower: the cache test took 3 s idle and over 20 s on a runner of CI
        testTimeout: 60_000,
    },
};
