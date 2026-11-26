import { describe, expect, it, vi } from 'vitest';

import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { agentActivity, agentSessionOf, formatAgentDuration, harnessLabel, isAgentWorking } from './agent_session.js';
import { createAgentSessionState, type AgentSessionTurn } from './agent_session_state.js';

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
        expect(session.turns.map(turn => turn.turnId)).toEqual([1, 2]);
        expect(session.turns[1]).toEqual({ ...state.turns[1], scripts: [{ scriptKey: 7, scriptName: 'orders' }] });
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
        const turn: AgentSessionTurn = { turnId: 1, question: 'q', status: 'dashql edit a', interrupted: false, error: null, note: null, files: [], steps: [] };
        const step = (endedAt: number | null) => ({ kind: 'tool' as const, label: 'dashql edit a', toolUseId: null, startedAt: 1, endedAt, failed: false });
        const activity = (t: AgentSessionTurn) => agentActivity({ turns: [t] });
        expect(activity(turn)).toEqual({ kind: 'thinking' });
        expect(activity({ ...turn, steps: [step(2)] })).toEqual({ kind: 'thinking' });
        expect(activity({ ...turn, steps: [step(2), step(null)] })).toEqual({ kind: 'tool', text: 'dashql edit a' });
        expect(activity({ ...turn, status: null })).toEqual({ kind: 'idle' });
        expect(isAgentWorking({ turns: [turn] })).toBe(true);
        expect(isAgentWorking({ turns: [{ ...turn, status: null }] })).toBe(false);
        expect(isAgentWorking(null)).toBe(false);
    });

    it('names the harnesses as users know them', () => {
        expect(harnessLabel('claude')).toBe('Claude Code');
        expect(harnessLabel('opencode')).toBe('opencode');
        expect(harnessLabel(null)).toBe('The agent');
    });
});
