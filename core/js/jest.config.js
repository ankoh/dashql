module.exports = {
    roots: ['<rootDir>'],
    transform: {
        '^.+\\.ts$': 'ts-jest',
        "\\.wasm$": "<rootDir>/test/transforms/file_transform.js"
    },
    testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$',
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    moduleNameMapper: {
        "^@dashql/proto$": "<rootDir>/../../proto/dashql_proto.ts"
    },
    globals: {
        'ts-jest': {
            tsConfig: 'tsconfig.test.json'
        }
    },
    reporters: [ "default", "jest-junit" ]
};


