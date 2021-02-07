module.exports = {
    roots: ['<rootDir>'],
    maxWorkers: 1,
    transform: {
        '^.+\\.ts$': 'ts-jest',
        '\\.wasm$': '<rootDir>/test/transforms/file_transform.js',
    },
    testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$',
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    moduleNameMapper: {
        '^@dashql/proto$': '<rootDir>/../proto/index.ts',
    },
    globals: {
        'ts-jest': {
            tsConfig: '<rootDir>/tsconfig.test.json',
        },
    },
    reporters: ['default', 'jest-junit'],
    collectCoverage: true,
    coverageDirectory: '<rootDir>/../reports',
    testPathIgnorePatterns: ['/node_modules/'],
    coverageReporters: [['json', { file: 'coverage_webdb.json' }]],
};
