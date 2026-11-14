// The tests of the SDK in Node, see docs/wip/dashql_sdk.md. The browser tests of the app run all tests of the SDK,
// those that need a browser (*.browser.test.ts) only run there.
import path from 'node:path';

const root = import.meta.dirname;

export default {
    resolve: {
        alias: [
            { find: /^@ankoh\/dashql-protobuf\/(.+)$/, replacement: path.join(root, 'dependencies/dashql-protobuf/$1') },
            { find: /^@ankoh\/dashql-jsonschema\/(.+)$/, replacement: path.join(root, 'dependencies/dashql-jsonschema/$1') },
            { find: /^@dashql\/extensions/, replacement: path.join(root, 'dependencies/extensions') },
        ],
    },
    test: {
        environment: 'node',
        globals: true,
        include: ['src/**/*.test.ts'],
        exclude: ['src/**/*.browser.test.ts'],
        setupFiles: [path.join(root, 'test/setup_node.mjs')],
    },
};
