import { describe, expect, it, vi } from 'vitest';

import { WorkbookStatusTone } from '../workbook/status/workbook_status.js';
import { harnessLabel, type AgentQuestion, type AgentSession } from './agent_session.js';
import { agentLiveStatuses, diffAgentQuestions } from './agent_workbook_status.js';

/// A session of Claude Code with one question
function sessionWith(question: Partial<AgentQuestion>): AgentSession {
    return {
        id: 's1',
        harness: 'claude',
        folder: '/w',
        connected: true,
        ended: false,
        turns: [{
            questionId: 1,
            question: { question: 'how many orders', status: 'working', waiting: null, interrupted: false, note: null, steps: [], ...question },
            scripts: [],
        }],
        onDismiss: vi.fn(),
        onShowScript: vi.fn(),
    };
}

describe('the statuses of the agent in the bar of a workbook', () => {
    it('tells the tool that runs, that the agent thinks between its tools, and that it waits for the user', () => {
        const harness = harnessLabel('claude');
        const live = (question: Partial<AgentQuestion>) => agentLiveStatuses(sessionWith(question), 0).map(({ tone, text, detail }) => ({ tone, text, detail }));
        expect(live({})).toEqual([{ tone: WorkbookStatusTone.Progress, text: expect.stringContaining(harness), detail: 'thinking' }]);
        const running = { label: 'Edit scripts/orders.sql', startedAt: 1, endedAt: null, failed: false };
        expect(live({ steps: [running] })).toEqual([{ tone: WorkbookStatusTone.Progress, text: expect.stringContaining(harness), detail: 'Edit scripts/orders.sql' }]);
        // A tool that ended leaves the agent thinking, the last tool is no longer what it does
        expect(live({ status: 'Edit scripts/orders.sql', steps: [{ ...running, endedAt: 2 }] })[0].detail).toBe('thinking');
        expect(live({ steps: [running], waiting: 'Claude needs your permission to use Bash' })).toEqual([
            { tone: WorkbookStatusTone.Attention, text: expect.stringContaining(harness), detail: 'Claude needs your permission to use Bash' },
        ]);
        expect(live({ status: null })).toEqual([]);
    });

    it('logs an answer, and a question that stopped without one', () => {
        const before = sessionWith({});
        const answered = diffAgentQuestions(before, sessionWith({ status: null, note: 'There are 42 orders' }), 0);
        expect(answered.map(({ tone, text }) => ({ tone, text }))).toEqual([{ tone: WorkbookStatusTone.Success, text: expect.stringContaining('how many orders') }]);
        const interrupted = diffAgentQuestions(before, sessionWith({ status: null, interrupted: true }), 0);
        expect(interrupted.map(({ tone, text }) => ({ tone, text }))).toEqual([{ tone: WorkbookStatusTone.Attention, text: expect.stringContaining('how many orders') }]);
    });
});
