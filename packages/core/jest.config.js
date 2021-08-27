const CONFIG = {
    // Verbose jest output
    verbose: true,
    // Map module names
    moduleNameMapper: {
        // Static files
        '^.+/static/(.*)\\.(dashql|svg)$': '<rootDir>/static/$1.$2',
        // Map everything to src
        '^@/(.*)$': '<rootDir>/src/$1',
        // Resolve .css and similar files to identity-obj-proxy instead.
        '^.+\\.(css|styl|less|sass|scss)$': `identity-obj-proxy`,
        // Map duckdb module to node version
        //'@dashql/duckdb/dist/duckdb.module.js': '@dashql/duckdb/dist/duckdb.module.mjs',
        '@dashql/duckdb/dist/duckdb.module.js': '@dashql/duckdb/dist/duckdb-node-async.js',
        // Prepare publishing in @duckdb
        //'@duckdb/duckdb-wasm/dist/duckdb.module.js': '@duckdb/duckdb-wasm/dist/duckdb-node-async.js',
    },
    // Extensions as esm
    extensionsToTreatAsEsm: ['.ts', '.tsx'],
    // Transform files
    transform: {
        '^.+\\.jsx?$': 'babel-jest',
        '^.+\\.tsx?$': 'ts-jest',
    },
    globals: {
        'ts-jest': {
            tsconfig: '<rootDir>/tsconfig.json',
            isolatedModules: true,
        },
    },
    transformIgnorePatterns: ['node_modules/(?!vega-lite)/'],
    // Tells Jest what folders to ignore for tests
    testPathIgnorePatterns: [`node_modules`, `\\.cache`],
    // Test paths
    testMatch: ['<rootDir>/src/**/*.spec.{js,jsx,ts,tsx}'],
    // Collect coverage information
    collectCoverage: true,
    // Coverage output
    coverageDirectory: '<rootDir>/coverage',
    // Collect coverage from these files
    collectCoverageFrom: ['src/**/*.{js,jsx,ts,tsx}', '!src/index.ts'],
    // Specify the coverage threshold
    coverageThreshold: {
        global: {
            branches: 40,
            functions: 40,
            lines: 40,
        },
    },
};

export default CONFIG;
