const CONFIG = {
    // Map module names
    moduleNameMapper: {
        // Static files
        '^.+/static/(.*)\\.(dashql|svg)$': '<rootDir>/static/$1.$2',
        // Map everything to src
        '^@/(.*)$': '<rootDir>/src/$1',
        // Resolve .css and similar files to identity-obj-proxy instead.
        '^.+\\.(css|styl|less|sass|scss)$': `identity-obj-proxy`,
        // Point duckdb module to node cjs version
        '@dashql/duckdb/dist/duckdb.module.js': '@dashql/duckdb/dist/duckdb-node-async.js',
    },
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
            tsconfig: '<rootDir>/tsconfig.json',
            isolatedModules: true,
        },
    },
};

export default CONFIG;
