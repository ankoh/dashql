const CONFIG = {
    // ESM preset, leaves js files as-is
    preset: 'ts-jest/presets/default-esm',
    // Use custom jsdom environment
    testEnvironment: '<rootDir>/__tests__/jsdom_env.ts',
    // Map module names
    moduleNameMapper: {
        // Map everything to src
        '^@/(.*)$': '<rootDir>/src/$1',
        // Mock static files
        '.*\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga|html|dashql)$':
            '<rootDir>/__tests__/file_mock.ts',
        // Resolve .css and similar files to identity-obj-proxy instead.
        '^.+\\.(css|styl|less|sass|scss)$': `identity-obj-proxy`,
        // Remap react-router
        'react-router-dom': 'react-router-dom/react-router-dom.development.js',
        // Jest does not read the export map
        '@duckdb/duckdb-wasm': '@duckdb/duckdb-wasm/dist/duckdb-node.cjs',
    },
    // Module path ignore
    modulePathIgnorePatterns: ['<rootDir>/src/duckdb_bundles.ts'],
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
