// The tests of the Worker in Node, which has the same Request, Response, fetch and Web Crypto as Workers.
export default {
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
};
