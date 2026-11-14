// The tests of hyperdb-edge in Node. The engine needs about 0.85 GB per instance, and the tests of the command start
// it in child processes, so few test files run at once.
export default {
    test: {
        environment: 'node',
        globals: true,
        include: ['src/**/*.test.ts'],
        maxWorkers: 2,
        testTimeout: 60_000,
        hookTimeout: 60_000,
    },
};
