// The session store under query() of the Claude Agent SDK, which runs Claude Code (CLAUDE_BINARY) as a process
export default {
    test: {
        environment: 'node',
        globals: true,
        include: ['stores/claude_agent_sdk_usage.test.ts'],
        testTimeout: 180_000,
        hookTimeout: 120_000,
    },
};
