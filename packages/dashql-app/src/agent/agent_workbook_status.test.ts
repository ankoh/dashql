import { describe, expect, it, vi } from 'vitest';

import { WorkbookStatusTone } from '../workbook/status/workbook_status.js';
import { harnessLabel, type AgentQuestion, type AgentSession } from './agent_session.js';
import { agentLiveStatuses, diffAgentQuestions } from './agent_workbook_status.js';

/// A conversation of Claude Code with one question
function sessionWith(question: Partial<AgentQuestion>): AgentSession {
    return {
        workbookId: 'w1',
        harness: 'claude',
        turns: [{
            questionId: 1,
            question: { question: 'how many orders', status: 'working', interrupted: false, error: null, note: null, steps: [], ...question },
            scripts: [],
        }],
        onDismiss: vi.fn(),
        onShowScript: vi.fn(),
        onStop: vi.fn(),
    };
}

describe('the statuses of the agent in the bar of a workbook', () => {
    it('tells the tool that runs and that the agent thinks between its tools', () => {
        const harness = harnessLabel('claude');
        const live = (question: Partial<AgentQuestion>) => agentLiveStatuses(sessionWith(question), 0).map(({ tone, text, detail }) => ({ tone, text, detail }));
        expect(live({})).toEqual([{ tone: WorkbookStatusTone.Progress, text: expect.stringContaining(harness), detail: 'thinking' }]);
        const running = { label: 'dashql edit orders', startedAt: 1, endedAt: null, failed: false };
        expect(live({ steps: [running] })).toEqual([{ tone: WorkbookStatusTone.Progress, text: expect.stringContaining(harness), detail: 'dashql edit orders' }]);
        // A tool that ended leaves the agent thinking, the last tool is no longer what it does
        expect(live({ status: 'dashql edit orders', steps: [{ ...running, endedAt: 2 }] })[0].detail).toBe('thinking');
        expect(live({ status: null })).toEqual([]);
    });

    it('logs an answer, a question that the user stopped and one that failed', () => {
        const before = sessionWith({});
        const tones = (after: AgentSession) => diffAgentQuestions(before, after, 0).map(({ tone, text }) => ({ tone, text }));
        expect(tones(sessionWith({ status: null, note: 'There are 42 orders' }))).toEqual([{ tone: WorkbookStatusTone.Success, text: expect.stringContaining('how many orders') }]);
        expect(tones(sessionWith({ status: null, interrupted: true }))).toEqual([{ tone: WorkbookStatusTone.Attention, text: expect.stringContaining('how many orders') }]);
        expect(tones(sessionWith({ status: null, error: 'The harness exited with code 1' }))).toEqual([{ tone: WorkbookStatusTone.Failed, text: expect.stringContaining('how many orders') }]);
    });
});
