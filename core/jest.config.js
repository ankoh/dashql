module.exports = {
    maxWorkers: 1,
    roots: ['<rootDir>'],
    testEnvironment: "./jest.env.js",
    transform: {
        '^.+\\.tsx?$': 'ts-jest',
        '\\.wasm$': '<rootDir>/test/transforms/file_transform.js',
    },
    testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$',
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    moduleNameMapper: {
        '^@dashql/proto$': '<rootDir>/../proto/index.ts',
    },
    globals: {
        'ts-jest': {
            tsConfig: 'tsconfig.test.json',
        },
    },
    reporters: ['default', 'jest-junit'],
    collectCoverage: true,
    coverageDirectory: '../reports',
    testPathIgnorePatterns: ['/node_modules/'],
    coverageReporters: [['json', { file: 'coverage_core.json' }]],
};
