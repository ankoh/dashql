// The tests of the stores of agent libraries in Node, see docs/wip/hyperdb_edge_stores.md. Every test file starts an
// engine of about 0.85 GB, so few run at once. Claude Code runs in a target of its own (vitest.claude_code.config.mjs).
export default {
    test: {
        environment: 'node',
        globals: true,
        include: ['stores/**/*.test.ts'],
        exclude: ['stores/claude_agent_sdk_usage.test.ts'],
        maxWorkers: 2,
        testTimeout: 120_000,
        hookTimeout: 120_000,
    },
};
