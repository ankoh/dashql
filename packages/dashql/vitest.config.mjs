// The tests of the package in Node, a project per folder of src: `vitest run --project core|runtime|platform`, see
// docs/design/dashql_runtime.md. The browser tests of the app run the tests of the runtime and of the platform as well,
// those that need a browser (*.browser.test.ts) only run there. The browser tests of the bindings are in test/browser.
// The generated packages are folders of Bazel (BUILD.bazel).
import path from 'node:path';

const root = import.meta.dirname;

/// The tests of the runtime and of the platform: every test file gets a root folder, the embedded Hyper and the specs of
/// the extensions (test/setup_node.mjs). The first test of a file that opens a HyperDB starts the engine within its own
/// timeout, which takes seconds on a loaded host, hence the timeouts of the bindings.
function runtimeProject(name) {
    return {
        extends: true,
        test: {
            name,
            include: [`src/${name}/**/*.test.ts`],
            exclude: ['src/**/*.browser.test.ts'],
            setupFiles: [path.join(root, 'test/setup_node.mjs')],
            hookTimeout: 30000,
            testTimeout: 30000,
        },
    };
}

/// The aliases of the generated packages, the glue of the core module from a folder of dependencies/
function aliases(wasm) {
    return [
        { find: /^@akohn\/dashql-wasm\/(.+)$/, replacement: path.join(root, `dependencies/${wasm}/$1`) },
        { find: /^@akohn\/dashql-flatbuffers\/(.+)$/, replacement: path.join(root, 'dependencies/dashql-flatbuffers/$1') },
        { find: /^@akohn\/dashql-protobuf\/(.+)$/, replacement: path.join(root, 'dependencies/dashql-protobuf/$1') },
        { find: /^@akohn\/dashql-jsonschema\/(.+)$/, replacement: path.join(root, 'dependencies/dashql-jsonschema/$1') },
        { find: /^@dashql\/extensions/, replacement: path.join(root, 'dependencies/extensions') },
    ];
}

/// The tests of the bindings of the core module
function coreProject(name, wasm) {
    return {
        resolve: { alias: aliases(wasm) },
        test: {
            name,
            environment: 'node',
            globals: true,
            include: ['src/core/**/*.test.ts'],
            hookTimeout: 30000,
            testTimeout: 30000,
        },
    };
}

export default {
    resolve: {
        alias: aliases('dashql-wasm'),
    },
    test: {
        environment: 'node',
        globals: true,
        projects: [
            coreProject('core', 'dashql-wasm'),
            runtimeProject('runtime'),
            runtimeProject('platform'),
        ],
    },
};
