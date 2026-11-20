// ESLint of the TypeScript and JavaScript sources, run by the eslint_test of every package (//bazel:eslint.bzl).
// No rule needs type information: the type checks of the packages check the types and resolve the imports.
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import ts from 'typescript-eslint';

// immutable has no default export in the ESM build that Vite bundles, a namespace import or named imports work
const IMMUTABLE_DEFAULT_IMPORT = [
    {
        selector: "ImportDeclaration[source.value='immutable'] > ImportDefaultSpecifier",
        message: "Use `import * as Immutable from 'immutable'` or named imports, immutable has no default export in its ESM build.",
    },
    {
        selector: "ImportDeclaration[source.value='immutable'] > ImportSpecifier[imported.name='default']",
        message: "Use `import * as Immutable from 'immutable'` or named imports, immutable has no default export in its ESM build.",
    },
];

// A relative import of TypeScript names the emitted file with .js: hyperdb-edge and the desktop app run the output of
// tsc in Node, and the declarations of @akohn/dashql resolve under NodeNext. Assets keep their own extension.
const RELATIVE_EXTENSIONLESS = '^\\.{1,2}$|^\\.{1,2}(/[^/]*)*/[^/.]*$';
const RELATIVE_TS = '^\\.{1,2}/.*\\.tsx?(\\?.*)?$';
const RELATIVE_IMPORT_MESSAGE = 'Name the file of a relative import with .js, `./foo.js` for `./foo.ts`.';

export default defineConfig(
    {
        ignores: ['**/bazel-*/**', '**/node_modules/**', '**/dist/**', '**/.astro/**', 'target/**'],
    },
    {
        linterOptions: { reportUnusedDisableDirectives: 'error' },
    },
    eslint.configs.recommended,
    ts.configs.recommended,
    {
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                    destructuredArrayIgnorePattern: '^_',
                },
            ],
            // Off: 292 uses, two thirds in tests (fakes, partial objects), the rest at untyped seams (Wasm, workers, IPC,
            // Vega, module declarations); the type checks run strict
            '@typescript-eslint/no-explicit-any': 'off',
            // Off: the terminal and the shell match ANSI escape sequences on purpose
            'no-control-regex': 'off',
            // Off: the ids of the core (ExternalObjectID) and the generated protobuf modules are grouped in namespaces
            '@typescript-eslint/no-namespace': 'off',
            // An interface that extends one other names it, a recursive type needs one
            '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'with-single-extends' }],
            // Cases without statements share the next one, also with a comment between them
            'no-fallthrough': ['error', { allowEmptyCase: true }],
            'no-restricted-syntax': ['error', ...IMMUTABLE_DEFAULT_IMPORT],
        },
    },
    {
        files: ['**/*.ts', '**/*.tsx'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        { regex: RELATIVE_EXTENSIONLESS, message: RELATIVE_IMPORT_MESSAGE },
                        { regex: RELATIVE_TS, message: RELATIVE_IMPORT_MESSAGE },
                    ],
                },
            ],
            // no-restricted-imports doesn't see import(), the same specifiers as a selector
            'no-restricted-syntax': [
                'error',
                ...IMMUTABLE_DEFAULT_IMPORT,
                {
                    selector: `ImportExpression[source.value=/${RELATIVE_EXTENSIONLESS.replaceAll('/', '\\x2F')}/]`,
                    message: RELATIVE_IMPORT_MESSAGE,
                },
                {
                    selector: `ImportExpression[source.value=/${RELATIVE_TS.replaceAll('/', '\\x2F')}/]`,
                    message: RELATIVE_IMPORT_MESSAGE,
                },
            ],
        },
    },
    {
        // Globals of a declaration are declared with var
        files: ['**/*.d.ts'],
        rules: { 'no-var': 'off' },
    },
    {
        // The React packages
        files: ['packages/dashql-app/**', 'packages/dashql-react/**', 'packages/dashql-org/**'],
        plugins: { 'react-hooks': reactHooks },
        rules: {
            'react-hooks/rules-of-hooks': 'error',
            // Off until the hooks of a package are reviewed (the block below): a missing dependency changes when an
            // effect runs, so every hook needs a review of its own before the rule can be an error
            'react-hooks/exhaustive-deps': 'off',
        },
    },
    {
        // The React packages whose hooks are reviewed: every hook lists what it reads. The workbooks of the app follow.
        files: ['packages/dashql-org/**', 'packages/dashql-react/**', 'packages/dashql-app/**'],
        ignores: ['packages/dashql-app/src/workbook/**'],
        rules: { 'react-hooks/exhaustive-deps': 'error' },
    },
    {
        // Scripts of Node: tests, drivers, build scripts and the configs of the tools
        files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
        languageOptions: { globals: { ...globals.node } },
    },
    {
        // CommonJS, the preload script of Electron
        files: ['**/*.cjs'],
        languageOptions: { sourceType: 'commonjs' },
        rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
    {
        // Drivers of Playwright, their callbacks run in the page
        files: ['**/test/**/*.mjs'],
        languageOptions: { globals: { ...globals.node, ...globals.browser } },
    },
    {
        // The worker script of the embedded Hyper in the app
        files: ['packages/dashql-app/src/**/*.js'],
        languageOptions: { globals: { ...globals.worker } },
    },
);
