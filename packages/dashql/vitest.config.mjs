// The tests of the package in Node, a project per folder of src: `vitest run --project core|runtime|platform`, see
// docs/design/dashql_runtime.md. The browser tests of the app run the tests of the runtime and of the platform as well,
// those that need a browser (*.browser.test.ts) only run there. The browser tests of the bindings are in test/browser.
// The generated packages are folders of Bazel (BUILD.bazel).
import path from 'node:path';

const root = import.meta.dirname;

/// The tests of the runtime and of the platform: every test file gets a root folder, the embedded Hyper and the specs of
/// the extensions (test/setup_node.mjs)
function runtimeProject(name) {
    return {
        extends: true,
        test: {
            name,
            include: [`src/${name}/**/*.test.ts`],
            exclude: ['src/**/*.browser.test.ts'],
            setupFiles: [path.join(root, 'test/setup_node.mjs')],
        },
    };
}

export default {
    resolve: {
        alias: [
            { find: /^@ankoh\/dashql-wasm\/(.+)$/, replacement: path.join(root, 'dependencies/dashql-wasm/$1') },
            { find: /^@ankoh\/dashql-flatbuffers\/(.+)$/, replacement: path.join(root, 'dependencies/dashql-flatbuffers/$1') },
            { find: /^@ankoh\/dashql-protobuf\/(.+)$/, replacement: path.join(root, 'dependencies/dashql-protobuf/$1') },
            { find: /^@ankoh\/dashql-jsonschema\/(.+)$/, replacement: path.join(root, 'dependencies/dashql-jsonschema/$1') },
            { find: /^@dashql\/extensions/, replacement: path.join(root, 'dependencies/extensions') },
        ],
    },
    test: {
        environment: 'node',
        globals: true,
        projects: [
            // The bindings of the core module
            {
                extends: true,
                test: {
                    name: 'core',
                    include: ['src/core/**/*.test.ts'],
                    hookTimeout: 30000,
                    testTimeout: 30000,
                },
            },
            runtimeProject('runtime'),
            runtimeProject('platform'),
        ],
    },
};
