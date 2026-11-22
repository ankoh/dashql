import { describe, expect, it, vi } from 'vitest';

import { agentActivity, agentDocumentTitle, agentSessionOf, formatAgentDuration, type AgentQuestion } from './agent_session.js';
import { createAgentSessionState, reduceAgentSessionEvent } from '@akohn/dashql/platform/session/agent_session_state';
import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';

const workbook = {
    scriptRefs: { '1_orders.sql': { scriptId: 7, fileName: '1_orders.sql' } },
} as unknown as WorkbookScripts;

describe('the session of an agent in the bar of a workbook', () => {
    it('names the scripts that the agent touched and leaves out the dismissed turns', () => {
        const state = {
            ...createAgentSessionState('codex', '/w', 's1'),
            turns: [
                { turnId: 1, question: '', status: null, waiting: null, interrupted: false, note: 'done', files: [], steps: [] },
                {
                    turnId: 2, question: 'top orders', status: 'Edit', waiting: null, interrupted: false, note: null, files: ['/w/scripts/1_orders.sql', 'scripts/1_orders.sql', 'other.sql'],
                    steps: [{ label: 'Edit scripts/1_orders.sql', toolUseId: 't1', startedAt: 10, endedAt: null, failed: false }],
                },
            ],
        };
        const onDismiss = vi.fn();
        const session = agentSessionOf({ state, connected: true }, workbook, new Set([1]), onDismiss, vi.fn());
        expect(session).toMatchObject({ harness: 'codex', folder: '/w', connected: true });
        expect(session.turns).toEqual([{
            questionId: 2,
            question: { question: 'top orders', status: 'Edit', waiting: null, interrupted: false, note: null, steps: [{ label: 'Edit scripts/1_orders.sql', startedAt: 10, endedAt: null, failed: false }] },
            scripts: [{ scriptKey: 7, scriptName: '1_orders' }],
        }]);
        session.onDismiss(2);
        expect(onDismiss).toHaveBeenCalledWith(2);
    });

    it('names a question that the harness did not tell and is no longer connected once the session ended', () => {
        const state = { ...createAgentSessionState('claude', '/w', 's1'), ended: true, turns: [{ turnId: 1, question: '', status: null, waiting: null, interrupted: false, note: null, files: [], steps: [] }] };
        const session = agentSessionOf({ state, connected: true }, workbook, new Set(), vi.fn(), vi.fn());
        expect(session.connected).toBe(false);
        expect(session.ended).toBe(true);
        expect(session.turns[0].question.question).toBe('A question in the terminal');
    });

    it('tells the time of a step in a few characters', () => {
        expect(formatAgentDuration(420)).toBe('0.4 s');
        expect(formatAgentDuration(12_900)).toBe('12 s');
        expect(formatAgentDuration(120_000)).toBe('2 min');
        expect(formatAgentDuration(125_000)).toBe('2 min 5 s');
        expect(formatAgentDuration(-5)).toBe('0.0 s');
    });

    it('tells what the agent does: it waits for the user, a tool runs, it thinks, or nothing', () => {
        const question: AgentQuestion = { question: 'q', status: 'Edit a.sql', waiting: null, interrupted: false, note: null, steps: [] };
        const step = (endedAt: number | null) => ({ label: 'Edit a.sql', startedAt: 1, endedAt, failed: false });
        const activity = (q: AgentQuestion, connected = true) => agentActivity({ connected, turns: [{ question: q }] });
        expect(activity(question)).toEqual({ kind: 'thinking' });
        expect(activity({ ...question, steps: [step(2)] })).toEqual({ kind: 'thinking' });
        expect(activity({ ...question, steps: [step(2), step(null)] })).toEqual({ kind: 'tool', text: 'Edit a.sql' });
        expect(activity({ ...question, steps: [step(null)], waiting: 'an approval' })).toEqual({ kind: 'waiting', text: 'an approval' });
        expect(activity({ ...question, status: null })).toEqual({ kind: 'idle' });
        // A session that the page doesn't reach does nothing
        expect(activity(question, false)).toEqual({ kind: 'idle' });
    });

    it('marks the title of the browser tab while the agent works or waits for the user', () => {
        // The turns of the state of the server have the fields of a question
        const titleOf = (state: ReturnType<typeof createAgentSessionState>) =>
            agentDocumentTitle('DashQL', agentActivity({ connected: !state.ended, turns: state.turns.map(question => ({ question })) }));
        let state = createAgentSessionState('claude', '/w', 's1');
        expect(titleOf(state)).toBe('DashQL');
        state = reduceAgentSessionEvent(state, { event: 'UserPromptSubmit', prompt: 'q' });
        expect(titleOf(state)).toBe('\u25CF DashQL');
        state = reduceAgentSessionEvent(state, { event: 'Notification', notification: 'permission' });
        expect(titleOf(state)).toBe('(!) DashQL');
        expect(titleOf({ ...state, ended: true })).toBe('DashQL');
        state = reduceAgentSessionEvent(state, { event: 'Stop' });
        expect(titleOf(state)).toBe('DashQL');
    });
});
