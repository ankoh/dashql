import { describe, expect, it, vi } from 'vitest';

import { agentActivity, agentDocumentTitle, agentSessionOf, formatAgentDuration, harnessLabel, isAgentWorking, type AgentQuestion } from './agent_session.js';
import { createAgentSessionState, reduceAgentSessionEvent } from '@akohn/dashql/platform/session/agent_session_state';
import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';

const workbook = {
    scriptRefs: { 'orders.sql': { scriptId: 7, fileName: 'orders.sql' } },
} as unknown as WorkbookScripts;

describe('the conversation of the agent in the bar of a workbook', () => {
    it('names the scripts that the agent changed', () => {
        const state = {
            ...createAgentSessionState(),
            harness: 'codex',
            turns: [
                { turnId: 1, question: 'q1', status: null, interrupted: false, error: null, note: 'done', files: [], steps: [] },
                {
                    turnId: 2, question: 'top orders', status: 'dashql edit orders', interrupted: false, error: null, note: null, files: ['orders.sql', 'gone.sql'],
                    steps: [{ kind: 'tool' as const, label: 'Write orders', toolUseId: 'call:1', startedAt: 10, endedAt: null, failed: false }],
                },
            ],
        };
        const handlers = { onReset: vi.fn(), onShowScript: vi.fn(), onStop: vi.fn() };
        const session = agentSessionOf('w1', state, workbook, handlers);
        expect(session).toMatchObject({ workbookId: 'w1', harness: 'codex' });
        expect(session.turns.map(turn => turn.questionId)).toEqual([1, 2]);
        expect(session.turns[1]).toEqual({
            questionId: 2,
            question: { question: 'top orders', status: 'dashql edit orders', interrupted: false, error: null, note: null, steps: [{ kind: 'tool', label: 'Write orders', startedAt: 10, endedAt: null, failed: false }] },
            scripts: [{ scriptKey: 7, scriptName: 'orders' }],
        });
        session.onStop();
        expect(handlers.onStop).toHaveBeenCalled();
    });

    it('tells the time of a step in a few characters', () => {
        expect(formatAgentDuration(420)).toBe('0.4 s');
        expect(formatAgentDuration(12_900)).toBe('12 s');
        expect(formatAgentDuration(120_000)).toBe('2 min');
        expect(formatAgentDuration(125_000)).toBe('2 min 5 s');
        expect(formatAgentDuration(-5)).toBe('0.0 s');
    });

    it('tells what the agent does: a tool runs, it thinks, or nothing', () => {
        const question: AgentQuestion = { question: 'q', status: 'dashql edit a', interrupted: false, error: null, note: null, steps: [] };
        const step = (endedAt: number | null) => ({ kind: 'tool' as const, label: 'dashql edit a', startedAt: 1, endedAt, failed: false });
        const activity = (q: AgentQuestion) => agentActivity({ turns: [{ question: q }] });
        expect(activity(question)).toEqual({ kind: 'thinking' });
        expect(activity({ ...question, steps: [step(2)] })).toEqual({ kind: 'thinking' });
        expect(activity({ ...question, steps: [step(2), step(null)] })).toEqual({ kind: 'tool', text: 'dashql edit a' });
        expect(activity({ ...question, status: null })).toEqual({ kind: 'idle' });
        expect(isAgentWorking({ turns: [{ question }] })).toBe(true);
        expect(isAgentWorking(null)).toBe(false);
    });

    it('marks the title of the window while the agent works', () => {
        const titleOf = (state: ReturnType<typeof createAgentSessionState>) =>
            agentDocumentTitle('DashQL', agentActivity({ turns: state.turns.map(question => ({ question })) }));
        let state = createAgentSessionState();
        expect(titleOf(state)).toBe('DashQL');
        state = reduceAgentSessionEvent(state, { event: 'UserPromptSubmit', prompt: 'q' });
        expect(titleOf(state)).toBe('● DashQL');
        state = reduceAgentSessionEvent(state, { event: 'Stop' });
        expect(titleOf(state)).toBe('DashQL');
    });

    it('names the harnesses as users know them', () => {
        expect(harnessLabel('claude')).toBe('Claude Code');
        expect(harnessLabel('opencode')).toBe('opencode');
        expect(harnessLabel(null)).toBe('The agent');
    });
});
