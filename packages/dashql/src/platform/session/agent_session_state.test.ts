import { agentSessionFile, createAgentSessionState, MAX_AGENT_SESSION_STEPS, MAX_AGENT_SESSION_TURNS, parseAgentSessionFile, reduceAgentSessionEvent } from './agent_session_state.js';

describe('the conversation of the agent on a workbook', () => {
    it('follows a question from the prompt to the final message', () => {
        let state = createAgentSessionState();
        const initial = state.version;
        state = reduceAgentSessionEvent(state, { event: 'UserPromptSubmit', prompt: 'how many orders' }, 1000, 'claude');
        expect(state.harness).toBe('claude');
        expect(state.turns).toHaveLength(1);
        expect(state.turns[0]).toMatchObject({ turnId: 1, question: 'how many orders', status: 'working', note: null, error: null, files: [] });
        state = reduceAgentSessionEvent(state, { event: 'PreToolUse', status: 'dashql edit orders', toolUseId: 't1' });
        state = reduceAgentSessionEvent(state, { event: 'Edited', files: ['orders.sql'] });
        state = reduceAgentSessionEvent(state, { event: 'Edited', files: ['orders.sql'] });
        state = reduceAgentSessionEvent(state, { event: 'PostToolUse', status: 'dashql edit orders', toolUseId: 't1' });
        expect(state.turns[0]).toMatchObject({ status: 'dashql edit orders', files: ['orders.sql'] });
        state = reduceAgentSessionEvent(state, { event: 'Stop', message: 'There are 42 orders' });
        expect(state.turns[0]).toMatchObject({ status: null, note: 'There are 42 orders', interrupted: false });
        expect(state.version).toBeGreaterThan(initial);
    });

    it('takes no events of tools outside a turn', () => {
        let state = createAgentSessionState();
        state = reduceAgentSessionEvent(state, { event: 'PostToolUse', status: 'ls' });
        state = reduceAgentSessionEvent(state, { event: 'Edited', files: ['a.sql'] });
        state = reduceAgentSessionEvent(state, { event: 'Stop', message: 'x' });
        expect(state.turns).toEqual([]);
    });

    it('ends a turn that failed or that the user stopped', () => {
        let state = createAgentSessionState();
        state = reduceAgentSessionEvent(state, { event: 'UserPromptSubmit', prompt: 'q1' });
        state = reduceAgentSessionEvent(state, { event: 'PreToolUse', status: 'dashql run', toolUseId: 't1' }, 1100);
        state = reduceAgentSessionEvent(state, { event: 'Stop', error: 'The harness exited with code 1: no login' }, 1200);
        expect(state.turns[0]).toMatchObject({ status: null, error: 'The harness exited with code 1: no login', note: null });
        expect(state.turns[0].steps[0].endedAt).toBe(1200);
        state = reduceAgentSessionEvent(state, { event: 'UserPromptSubmit', prompt: 'q2' });
        state = reduceAgentSessionEvent(state, { event: 'Stop', interrupted: true });
        expect(state.turns[1]).toMatchObject({ turnId: 2, status: null, interrupted: true, error: null });
    });

    it('ends a turn that is still open when the next question starts', () => {
        let state = createAgentSessionState();
        state = reduceAgentSessionEvent(state, { event: 'UserPromptSubmit', prompt: 'q1' });
        state = reduceAgentSessionEvent(state, { event: 'UserPromptSubmit', prompt: 'q2' });
        expect(state.turns).toMatchObject([{ status: null, interrupted: true }, { status: 'working' }]);
    });

    it('follows the uses of the tools of a turn as its steps', () => {
        let state = createAgentSessionState();
        state = reduceAgentSessionEvent(state, { event: 'UserPromptSubmit', prompt: 'q' }, 1000);
        // Two tools at once, the second ends first
        state = reduceAgentSessionEvent(state, { event: 'PreToolUse', status: 'Read a.sql', toolUseId: 't1' }, 1100);
        state = reduceAgentSessionEvent(state, { event: 'PreToolUse', status: 'Read b.sql', toolUseId: 't2' }, 1200);
        expect(state.turns[0].status).toBe('Read b.sql');
        state = reduceAgentSessionEvent(state, { event: 'PostToolUse', status: 'Read b.sql', toolUseId: 't2' }, 1300);
        expect(state.turns[0].steps).toEqual([
            { kind: 'tool', label: 'Read a.sql', toolUseId: 't1', startedAt: 1100, endedAt: null, failed: false },
            { kind: 'tool', label: 'Read b.sql', toolUseId: 't2', startedAt: 1200, endedAt: 1300, failed: false },
        ]);
        // A failed tool, a PostToolUse without a PreToolUse and without an id
        state = reduceAgentSessionEvent(state, { event: 'PostToolUse', status: 'Read a.sql', toolUseId: 't1', error: 'no such file' }, 1400);
        state = reduceAgentSessionEvent(state, { event: 'PostToolUse', status: 'ls' }, 1500);
        expect(state.turns[0].steps[0]).toMatchObject({ endedAt: 1400, failed: true });
        expect(state.turns[0].steps[2]).toEqual({ kind: 'tool', label: 'ls', toolUseId: null, startedAt: 1500, endedAt: 1500, failed: false });
        // Stop ends every open step
        state = reduceAgentSessionEvent(state, { event: 'PreToolUse', status: 'ls', toolUseId: null }, 1700);
        state = reduceAgentSessionEvent(state, { event: 'Stop', message: 'done' }, 1800);
        expect(state.turns[0].steps.every(step => step.endedAt != null)).toBe(true);
    });

    it('keeps the latest steps of a turn and the latest turns', () => {
        let state = createAgentSessionState();
        state = reduceAgentSessionEvent(state, { event: 'UserPromptSubmit', prompt: 'q' });
        for (let i = 0; i < MAX_AGENT_SESSION_STEPS + 5; ++i) state = reduceAgentSessionEvent(state, { event: 'PostToolUse', status: `step ${i}` });
        expect(state.turns[0].steps).toHaveLength(MAX_AGENT_SESSION_STEPS);
        expect(state.turns[0].steps[0].label).toBe('step 5');
        for (let i = 0; i < MAX_AGENT_SESSION_TURNS + 3; ++i) {
            state = reduceAgentSessionEvent(state, { event: 'UserPromptSubmit', prompt: `q${i}` });
            state = reduceAgentSessionEvent(state, { event: 'Stop', message: 'a' });
        }
        expect(state.turns).toHaveLength(MAX_AGENT_SESSION_TURNS);
        expect(state.turns[state.turns.length - 1].turnId).toBe(MAX_AGENT_SESSION_TURNS + 4);
    });

    it('keeps the texts of the agent between its tools as steps, the final message once', () => {
        let state = createAgentSessionState();
        state = reduceAgentSessionEvent(state, { event: 'UserPromptSubmit', prompt: 'q' }, 1000);
        state = reduceAgentSessionEvent(state, { event: 'Say', text: '  I look up the orders.  ' }, 1100);
        state = reduceAgentSessionEvent(state, { event: 'Say', text: '   ' }, 1150);
        state = reduceAgentSessionEvent(state, { event: 'PreToolUse', status: 'Run orders', toolUseId: 't1' }, 1200);
        state = reduceAgentSessionEvent(state, { event: 'PostToolUse', status: 'Run orders', toolUseId: 't1' }, 1300);
        state = reduceAgentSessionEvent(state, { event: 'Say', text: 'There are 42 orders.' }, 1400);
        expect(state.turns[0].steps.map(step => [step.kind, step.label])).toEqual([
            ['text', 'I look up the orders.'],
            ['tool', 'Run orders'],
            ['text', 'There are 42 orders.'],
        ]);
        state = reduceAgentSessionEvent(state, { event: 'Stop', message: 'There are 42 orders.\n' }, 1500);
        expect(state.turns[0].steps.map(step => step.label)).toEqual(['I look up the orders.', 'Run orders']);
        expect(state.turns[0].note).toBe('There are 42 orders.\n');
    });

    it('takes no texts outside a turn and an empty final message as none', () => {
        let state = createAgentSessionState();
        state = reduceAgentSessionEvent(state, { event: 'Say', text: 'hello' });
        expect(state.turns).toEqual([]);
        state = reduceAgentSessionEvent(state, { event: 'UserPromptSubmit', prompt: 'q' });
        state = reduceAgentSessionEvent(state, { event: 'Stop', message: '  ' });
        expect(state.turns[0].note).toBeNull();
    });

    it('reads a conversation that it kept, a turn that still ran was stopped', () => {
        let state = createAgentSessionState();
        state = reduceAgentSessionEvent(state, { event: 'UserPromptSubmit', prompt: 'q1' }, 1000, 'codex');
        state = reduceAgentSessionEvent(state, { event: 'Edited', files: ['a.sql'] }, 1010);
        state = reduceAgentSessionEvent(state, { event: 'Stop', message: 'done' }, 1100);
        state = reduceAgentSessionEvent(state, { event: 'UserPromptSubmit', prompt: 'q2' }, 1200);
        state = reduceAgentSessionEvent(state, { event: 'PreToolUse', status: 'Run a', toolUseId: 't1' }, 1300);
        const kept = JSON.parse(JSON.stringify(agentSessionFile(state)));
        const read = parseAgentSessionFile(kept);
        expect(read?.harness).toBe('codex');
        expect(read?.turns[0]).toEqual(state.turns[0]);
        expect(read?.turns[1]).toMatchObject({ turnId: 2, status: null, interrupted: true });
        expect(read?.turns[1].steps[0]).toMatchObject({ kind: 'tool', label: 'Run a', endedAt: 1300 });
    });

    it('reads no broken conversation and leaves out broken turns', () => {
        expect(parseAgentSessionFile(null)).toBeNull();
        expect(parseAgentSessionFile({ turns: 'x' })).toBeNull();
        const read = parseAgentSessionFile({ harness: 3, turns: [{ turnId: 1 }, { turnId: 2, question: 'q', steps: [{ label: 1 }, { label: 'ls', startedAt: 5 }] }] });
        expect(read?.harness).toBeNull();
        expect(read?.turns).toHaveLength(1);
        expect(read?.turns[0]).toMatchObject({ turnId: 2, question: 'q', files: [], note: null });
        expect(read?.turns[0].steps).toEqual([{ kind: 'tool', label: 'ls', toolUseId: null, startedAt: 5, endedAt: 5, failed: false }]);
    });
});
