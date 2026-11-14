import { describe, expect, it, vi } from 'vitest';

import { agentSessionOf } from './agent_session.js';
import { createAgentSessionState } from '@ankoh/dashql-runtime/session/agent_session_state';
import type { WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';

const workbook = {
    scriptRefs: { '1_orders.sql': { scriptId: 7, fileName: '1_orders.sql' } },
} as unknown as WorkbookScripts;

describe('the session of an agent in the bar of a workbook', () => {
    it('names the scripts that the agent touched and leaves out the dismissed turns', () => {
        const state = {
            ...createAgentSessionState('codex', '/w'),
            turns: [
                { turnId: 1, question: '', status: null, error: null, note: 'done', files: [] },
                { turnId: 2, question: 'top orders', status: 'Edit', error: null, note: null, files: ['/w/scripts/1_orders.sql', 'scripts/1_orders.sql', 'other.sql'] },
            ],
        };
        const onDismiss = vi.fn();
        const session = agentSessionOf({ state, connected: true }, workbook, new Set([1]), onDismiss, vi.fn());
        expect(session).toMatchObject({ harness: 'codex', folder: '/w', connected: true });
        expect(session.turns).toEqual([{
            questionId: 2,
            question: { question: 'top orders', status: 'Edit', error: null, note: null },
            scripts: [{ scriptKey: 7, scriptName: '1_orders' }],
        }]);
        session.onDismiss(2);
        expect(onDismiss).toHaveBeenCalledWith(2);
    });

    it('names a question that the harness did not tell and is no longer connected once the session ended', () => {
        const state = { ...createAgentSessionState('claude', '/w'), ended: true, turns: [{ turnId: 1, question: '', status: null, error: null, note: null, files: [] }] };
        const session = agentSessionOf({ state, connected: true }, workbook, new Set(), vi.fn(), vi.fn());
        expect(session.connected).toBe(false);
        expect(session.turns[0].question.question).toBe('A question in the terminal');
    });
});
