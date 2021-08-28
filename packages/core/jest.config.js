const CONFIG = {
    // ESM preset, leaves js files as-is
    preset: 'ts-jest/presets/default-esm',
    // Use custom jsdom environment
    testEnvironment: '<rootDir>/__tests__/jsdom_env.ts',
    // Map module names
    moduleNameMapper: {
        // DashQL scripts
        '^.+/static/(.*)\\.dashql$': '<rootDir>/static/$1.$2',
        // Map everything to src
        '^@/(.*)$': '<rootDir>/src/$1',
        // Mock static files
        '.*\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga|html)$':
            '<rootDir>/__tests__/file_mock.ts',
        // Resolve .css and similar files to identity-obj-proxy instead.
        '^.+\\.(css|styl|less|sass|scss)$': `identity-obj-proxy`,
        // Point duckdb module to node cjs version
        '@dashql/duckdb/dist/duckdb.module.js': '@dashql/duckdb/dist/duckdb-node-async.js',
    },
    // Module path ignore
    modulePathIgnorePatterns: ['<rootDir>/src/app.tsx'],
    // Extensions as esm
    extensionsToTreatAsEsm: ['.ts', '.tsx'],
    // Transform files
    transform: {
        '^.+\\.(j|t)sx?$': 'ts-jest',
    },
    // Transform vega-lite since it uses ESM
    transformIgnorePatterns: ['node_modules/(?!vega-lite)/'],
    // Test paths
    testMatch: ['<rootDir>/src/**/*.spec.{js,jsx,ts,tsx}'],
    // Tells Jest what folders to ignore for tests
    testPathIgnorePatterns: [`node_modules`, `\\.cache`],
    // Additional settings
    globals: {
        'ts-jest': {
            useESM: true,
            tsconfig: '<rootDir>/tsconfig.json',
            isolatedModules: true,
        },
    },
};

export default CONFIG;
