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

/// The tests of the bindings on a core module, `features` are the features that the module was built with
/// (DASHQL_CORE_FEATURES of the tests, see features.test.ts)
function coreProject(name, wasm, features) {
    return {
        resolve: { alias: aliases(wasm) },
        test: {
            name,
            environment: 'node',
            globals: true,
            include: ['src/core/**/*.test.ts'],
            env: { DASHQL_CORE_FEATURES: features.join(',') },
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
            // The bindings of the core module with all features, and of the module without features
            coreProject('core', 'dashql-wasm', ['shell']),
            coreProject('core_minimal', 'dashql-wasm-minimal', []),
            runtimeProject('runtime'),
            runtimeProject('platform'),
        ],
    },
};
