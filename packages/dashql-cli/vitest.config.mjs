// The tests of dashql in Node. The generated packages that the runtime imports are folders of Bazel (BUILD.bazel).
import path from 'node:path';

const root = import.meta.dirname;

export default {
    resolve: {
        alias: [
            { find: /^@ankoh\/dashql-protobuf\/(.+)$/, replacement: path.join(root, 'dependencies/dashql-protobuf/$1') },
            { find: /^@ankoh\/dashql-jsonschema\/(.+)$/, replacement: path.join(root, 'dependencies/dashql-jsonschema/$1') },
        ],
    },
    test: {
        environment: 'node',
        globals: true,
        include: ['src/**/*.test.ts'],
        // Every `dashql run` starts the embedded Hyper, about 1.5 s
        testTimeout: 20_000,
    },
};
