import { createAgentSessionState, MAX_AGENT_SESSION_TURNS, parseAgentSessionOAuth, reduceAgentSessionEvent, type AgentSessionEvent } from './agent_session_state.js';

const at = (event: Omit<AgentSessionEvent, 'harness' | 'folder'>): AgentSessionEvent => ({ harness: 'claude', folder: '/w', ...event });

describe('the state of an agent session', () => {
    it('follows a question from the prompt to the final message', () => {
        let state = createAgentSessionState('claude', '/w');
        state = reduceAgentSessionEvent(state, at({ event: 'SessionStart' }));
        state = reduceAgentSessionEvent(state, at({ event: 'UserPromptSubmit', prompt: 'how many orders' }));
        expect(state.turns).toEqual([{ turnId: 1, question: 'how many orders', status: 'working', error: null, note: null, files: [] }]);
        state = reduceAgentSessionEvent(state, at({ event: 'PostToolUse', status: 'dashql lint scripts/orders.sql', files: ['scripts/orders.sql'] }));
        state = reduceAgentSessionEvent(state, at({ event: 'PostToolUse', status: 'Edit scripts/orders.sql', files: ['scripts/orders.sql'] }));
        expect(state.turns[0]).toMatchObject({ status: 'Edit scripts/orders.sql', files: ['scripts/orders.sql'] });
        state = reduceAgentSessionEvent(state, at({ event: 'Stop', message: 'There are 42 orders' }));
        expect(state.turns[0]).toMatchObject({ status: null, note: 'There are 42 orders' });
        expect(state.version).toBe(5);
    });

    it('shows what the agent does without a question and ends the session', () => {
        let state = createAgentSessionState('codex', '/w');
        state = reduceAgentSessionEvent(state, { event: 'PostToolUse', harness: 'codex', folder: '/w', status: 'ls' });
        expect(state.turns).toMatchObject([{ turnId: 1, question: '', status: 'ls' }]);
        state = reduceAgentSessionEvent(state, { event: 'SessionEnd', harness: 'codex', folder: '/w' });
        expect(state.ended).toBe(true);
        expect(state.turns[0].status).toBeNull();
        // A Stop without a question changes nothing
        expect(reduceAgentSessionEvent(state, { event: 'Stop', harness: 'codex', folder: '/w', message: 'x' }).turns).toEqual(state.turns);
    });

    it('keeps the latest turns', () => {
        let state = createAgentSessionState('claude', '/w');
        for (let i = 0; i < MAX_AGENT_SESSION_TURNS + 5; ++i) {
            state = reduceAgentSessionEvent(state, at({ event: 'UserPromptSubmit', prompt: `q${i}` }));
            state = reduceAgentSessionEvent(state, at({ event: 'Stop' }));
        }
        expect(state.turns).toHaveLength(MAX_AGENT_SESSION_TURNS);
        expect(state.turns[state.turns.length - 1].turnId).toBe(MAX_AGENT_SESSION_TURNS + 5);
    });

    it('reads how the tab logs in to Salesforce from the body of its connections', () => {
        const oauth = { redirect: 'https://dashql.app/oauth.html', redirectVariant: 'WEB_OPENER_FLOW', redirectCallbackUrl: 'http://localhost:9002/oauth.html', flavor: '' };
        expect(parseAgentSessionOAuth(JSON.stringify({ connections: [], oauth }))).toEqual({ ...oauth, flavor: null });
        expect(parseAgentSessionOAuth(JSON.stringify({ connections: [] }))).toBeNull();
        expect(parseAgentSessionOAuth(JSON.stringify({ oauth: { ...oauth, redirect: '' } }))).toBeNull();
        expect(parseAgentSessionOAuth(JSON.stringify({ oauth: { ...oauth, redirectVariant: 'OTHER' } }))).toBeNull();
        expect(parseAgentSessionOAuth('not json')).toBeNull();
    });
});
