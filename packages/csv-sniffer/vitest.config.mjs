// The tests of @akohn/csv-sniffer in Node: the wrapper on the Wasm, and the queries in the embedded Hyper
export default {
    test: {
        environment: 'node',
        globals: true,
        include: ['ts/**/*.test.ts'],
        maxWorkers: 2,
        testTimeout: 60_000,
        hookTimeout: 60_000,
    },
};
