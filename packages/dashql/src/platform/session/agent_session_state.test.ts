import { createAgentSessionState, MAX_AGENT_SESSION_STEPS, MAX_AGENT_SESSION_TURNS, reduceAgentSessionEvent } from './agent_session_state.js';

describe('the state of an agent session', () => {
    it('follows a question from the prompt to the final message', () => {
        let state = createAgentSessionState('claude', '/w', 's1');
        state = reduceAgentSessionEvent(state, { event: 'SessionStart' });
        state = reduceAgentSessionEvent(state, { event: 'UserPromptSubmit', prompt: 'how many orders' });
        expect(state.turns).toEqual([{ turnId: 1, question: 'how many orders', status: 'working', note: null, files: [], steps: [] }]);
        state = reduceAgentSessionEvent(state, { event: 'PostToolUse', status: 'dashql lint scripts/orders.sql', files: ['scripts/orders.sql'] });
        state = reduceAgentSessionEvent(state, { event: 'PostToolUse', status: 'Edit scripts/orders.sql', files: ['scripts/orders.sql'] });
        expect(state.turns[0]).toMatchObject({ status: 'Edit scripts/orders.sql', files: ['scripts/orders.sql'] });
        state = reduceAgentSessionEvent(state, { event: 'Stop', message: 'There are 42 orders' });
        expect(state.turns[0]).toMatchObject({ status: null, note: 'There are 42 orders' });
        expect(state.version).toBe(5);
    });

    it('keeps the id of the session through its events, a page tells the next session on a port by it', () => {
        let state = createAgentSessionState('claude', '/w', 'session-1');
        for (const event of ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd'] as const) {
            state = reduceAgentSessionEvent(state, { event });
            expect(state.id, event).toBe('session-1');
        }
    });

    it('shows what the agent does without a question and ends the session', () => {
        let state = createAgentSessionState('codex', '/w', 's1');
        state = reduceAgentSessionEvent(state, { event: 'PostToolUse', status: 'ls' });
        expect(state.turns).toMatchObject([{ turnId: 1, question: '', status: 'ls' }]);
        state = reduceAgentSessionEvent(state, { event: 'SessionEnd' });
        expect(state.ended).toBe(true);
        expect(state.turns[0].status).toBeNull();
        // A Stop without a question changes nothing
        expect(reduceAgentSessionEvent(state, { event: 'Stop', message: 'x' }).turns).toEqual(state.turns);
    });

    it('follows the uses of the tools of a turn as its steps', () => {
        let state = createAgentSessionState('claude', '/w', 's1');
        state = reduceAgentSessionEvent(state, { event: 'UserPromptSubmit', prompt: 'q' }, 1000);
        // Two tools at once, the second ends first
        state = reduceAgentSessionEvent(state, { event: 'PreToolUse', status: 'Read a.sql', toolUseId: 't1' }, 1100);
        state = reduceAgentSessionEvent(state, { event: 'PreToolUse', status: 'Read b.sql', toolUseId: 't2' }, 1200);
        expect(state.turns[0].status).toBe('Read b.sql');
        state = reduceAgentSessionEvent(state, { event: 'PostToolUse', status: 'Read b.sql', toolUseId: 't2' }, 1300);
        expect(state.turns[0].steps).toEqual([
            { label: 'Read a.sql', toolUseId: 't1', startedAt: 1100, endedAt: null, failed: false },
            { label: 'Read b.sql', toolUseId: 't2', startedAt: 1200, endedAt: 1300, failed: false },
        ]);
        // A failed tool, a PostToolUse without a PreToolUse and without an id, a PreToolUse without an id
        state = reduceAgentSessionEvent(state, { event: 'PostToolUse', status: 'Read a.sql', toolUseId: 't1', error: 'no such file' }, 1400);
        state = reduceAgentSessionEvent(state, { event: 'PostToolUse', status: 'ls' }, 1500);
        state = reduceAgentSessionEvent(state, { event: 'PreToolUse', status: 'dashql run w' }, 1600);
        expect(state.turns[0].steps.slice(0, 1)).toMatchObject([{ endedAt: 1400, failed: true }]);
        expect(state.turns[0].steps.slice(2)).toEqual([
            { label: 'ls', toolUseId: null, startedAt: 1500, endedAt: 1500, failed: false },
            { label: 'dashql run w', toolUseId: null, startedAt: 1600, endedAt: null, failed: false },
        ]);
        // A PostToolUse without an id ends the open step of its label, Stop ends every open step
        state = reduceAgentSessionEvent(state, { event: 'PreToolUse', status: 'ls', toolUseId: null }, 1700);
        state = reduceAgentSessionEvent(state, { event: 'PostToolUse', status: 'dashql run w' }, 1800);
        expect(state.turns[0].steps[3]).toMatchObject({ label: 'dashql run w', endedAt: 1800 });
        state = reduceAgentSessionEvent(state, { event: 'Stop' }, 1900);
        expect(state.turns[0].steps[4]).toMatchObject({ label: 'ls', endedAt: 1900 });
        expect(state.turns[0].steps).toHaveLength(5);
    });

    it('keeps the latest steps of a turn', () => {
        let state = createAgentSessionState('claude', '/w', 's1');
        for (let i = 0; i < MAX_AGENT_SESSION_STEPS + 5; ++i) {
            state = reduceAgentSessionEvent(state, { event: 'PreToolUse', status: `s${i}`, toolUseId: `t${i}` });
        }
        expect(state.turns[0].steps).toHaveLength(MAX_AGENT_SESSION_STEPS);
        expect(state.turns[0].steps[MAX_AGENT_SESSION_STEPS - 1].label).toBe(`s${MAX_AGENT_SESSION_STEPS + 4}`);
    });

    it('keeps the latest turns', () => {
        let state = createAgentSessionState('claude', '/w', 's1');
        for (let i = 0; i < MAX_AGENT_SESSION_TURNS + 5; ++i) {
            state = reduceAgentSessionEvent(state, { event: 'UserPromptSubmit', prompt: `q${i}` });
            state = reduceAgentSessionEvent(state, { event: 'Stop' });
        }
        expect(state.turns).toHaveLength(MAX_AGENT_SESSION_TURNS);
        expect(state.turns[state.turns.length - 1].turnId).toBe(MAX_AGENT_SESSION_TURNS + 5);
    });
});
