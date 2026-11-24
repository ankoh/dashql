import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as dashql from '@akohn/dashql';
import { RuntimeContextProvider } from '@akohn/dashql-react/hooks';
import { testRuntime } from '@akohn/dashql/runtime/testing/test_runtime';
import { AgentPromptPanel } from './agent_prompt_panel.js';
import { agentActivity, formatAgentDuration, harnessLabel, type AgentSession, type AgentTurn } from './agent_session.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

function agentSession(overrides: Partial<AgentSession> = {}): AgentSession {
    return {
        workbookId: 'w1',
        harness: 'claude',
        turns: [],
        onReset: vi.fn(),
        onShowScript: vi.fn(),
        onStop: vi.fn(),
        ...overrides,
    };
}

/// A question that the agent answered
function answered(questionId: number, question: string, note: string | null): AgentTurn {
    return { questionId, question: { question, status: null, error: null, interrupted: false, note, steps: [] }, scripts: [] };
}

describe('Agent prompt panel', () => {
    let container: HTMLDivElement;
    let root: Root;
    let core: dashql.DashQL;
    beforeAll(async () => {
        core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
    });
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    const detail = () => container.querySelector('[data-testid="composer-agent-detail"]')?.textContent;
    const answerOf = (turn: Element) => turn.querySelector<HTMLElement>('[data-testid="composer-agent-answer"]');
    /// The panel with the core, which compiles the Markdown of the answers
    const render = (element: React.ReactElement) => act(() => root.render(
        <RuntimeContextProvider value={testRuntime(core)}>{element}</RuntimeContextProvider>,
    ));

    it('counts the questions and leaves the harness to the bar of Wobble', () => {
        render(<AgentPromptPanel session={agentSession({ turns: [answered(1, 'q', 'a')] })} />);
        expect(detail()).toBe('1 question');
        expect(container.textContent).not.toContain('Claude Code');
        render(<AgentPromptPanel session={agentSession({ harness: 'opencode', turns: [answered(1, 'q', 'a'), answered(2, 'q', 'a')] })} />);
        expect(detail()).toBe('2 questions');
    });

    it('shows what the agent does for a question and stops it', () => {
        const agent = agentSession({
            turns: [{
                questionId: 3,
                question: {
                    question: 'how many orders',
                    status: 'Check orders',
                    error: null,
                    interrupted: false,
                    note: null,
                    steps: [{ kind: 'tool', label: 'Check orders', startedAt: Date.now(), endedAt: null, failed: false }],
                },
                scripts: [{ scriptKey: 7, scriptName: 'orders' }],
            }],
        });
        expect(agentActivity(agent).kind).toBe('tool');
        render(<AgentPromptPanel session={agent} />);
        const turn = container.querySelector('[data-testid="composer-agent-turn"]')!;
        expect(turn.getAttribute('data-state')).toBe('working');
        expect(turn.textContent).toContain('how many orders');
        expect(turn.querySelector('[role="status"] [data-testid="composer-agent-step"]')?.textContent).toContain('Check orders');
        // A tool runs, the agent does not think
        expect(turn.querySelector('[data-testid="composer-agent-thinking"]')).toBeNull();
        act(() => turn.querySelector<HTMLButtonElement>('[data-testid="question-stop"]')!.click());
        expect(agent.onStop).toHaveBeenCalledOnce();
        act(() => turn.querySelector<HTMLButtonElement>('[data-testid="composer-agent-script"]')!.click());
        expect(agent.onShowScript).toHaveBeenCalledExactlyOnceWith(7);
    });

    it('shows that the agent thinks between its steps', () => {
        const now = Date.now();
        const agent = agentSession({
            turns: [{
                questionId: 1,
                question: {
                    question: 'q', status: 'working', error: null, interrupted: false, note: null,
                    steps: [{ kind: 'tool', label: 'List the scripts', startedAt: now - 2000, endedAt: now - 1000, failed: false }],
                },
                scripts: [],
            }],
        });
        expect(agentActivity(agent).kind).toBe('thinking');
        render(<AgentPromptPanel session={agent} />);
        expect(container.querySelector('[data-testid="composer-agent-thinking"]')?.textContent).toBe('Thinking…');
    });

    it('shows a question that the user stopped and one that failed', () => {
        const question = { question: 'drop the table', status: null, interrupted: false, error: null, note: null, steps: [] };
        render(<AgentPromptPanel session={agentSession({ turns: [{ questionId: 1, question: { ...question, interrupted: true }, scripts: [] }] })} />);
        expect(container.querySelector<HTMLElement>('[data-testid="composer-agent-turn"]')!.dataset.state).toBe('interrupted');
        expect(container.querySelector('[role="note"]')!.textContent).toBe('Stopped without an answer');
        render(<AgentPromptPanel session={agentSession({ turns: [{ questionId: 1, question: { ...question, error: 'The harness exited with code 1: not logged in' }, scripts: [] }] })} />);
        expect(container.querySelector<HTMLElement>('[data-testid="composer-agent-turn"]')!.dataset.state).toBe('failed');
        expect(container.querySelector('[data-testid="composer-agent-error"]')!.textContent).toContain('not logged in');
    });

    it('shows the steps and the texts of the agent, then its answer as Markdown', () => {
        const now = Date.now();
        const agent = agentSession({
            turns: [{
                questionId: 3,
                question: {
                    question: 'how many orders',
                    status: 'Run orders',
                    error: null,
                    interrupted: false,
                    note: null,
                    steps: [
                        { kind: 'tool', label: 'Read orders', startedAt: now - 9000, endedAt: now - 8600, failed: false },
                        { kind: 'text', label: 'The table has **no** region, I join `customers`.', startedAt: now - 8500, endedAt: now - 8500, failed: false },
                        { kind: 'tool', label: 'Check orders', startedAt: now - 8000, endedAt: now - 7000, failed: true },
                        { kind: 'tool', label: 'Run orders', startedAt: now - 3000, endedAt: null, failed: false },
                    ],
                },
                scripts: [],
            }],
        });
        render(<AgentPromptPanel session={agent} />);
        const steps = [...container.querySelectorAll('[data-testid="composer-agent-step"]')];
        expect(steps.map(step => step.getAttribute('data-state'))).toEqual(['done', 'text', 'failed', 'running']);
        expect(steps[0].querySelector('[data-testid="composer-agent-step-time"]')?.textContent).toBe(formatAgentDuration(400));
        expect(steps[1].querySelector('strong')?.textContent).toBe('no');
        expect(steps[1].querySelector('code')?.textContent).toBe('customers');
        expect(steps[3].querySelector('[data-testid="composer-agent-step-time"]')?.textContent).toMatch(/^3\.\d s$/);
        // The steps are the status of the turn
        expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
        expect(container.querySelector('[role="status"]')?.contains(steps[0])).toBe(true);

        // Once the agent answered, the steps stay with the answer
        const note = 'There are **42** orders:\n\n- 30 open\n- 12 shipped\n\n<script>alert(1)</script>![x](https://example.com/x.png)';
        const done = agentSession({
            turns: [{
                questionId: 3,
                question: { ...agent.turns[0].question, status: null, note, steps: agent.turns[0].question.steps.map(step => ({ ...step, endedAt: step.endedAt ?? now })) },
                scripts: [],
            }],
        });
        render(<AgentPromptPanel session={done} />);
        const answer = answerOf(container)!;
        expect(answer.querySelector('strong')?.textContent).toBe('42');
        expect([...answer.querySelectorAll('li')].map(item => item.textContent)).toEqual(['30 open', '12 shipped']);
        // No raw HTML and no images in an answer
        expect(answer.querySelector('script')).toBeNull();
        expect(answer.querySelector('img')).toBeNull();
        expect(container.querySelectorAll('[data-testid="composer-agent-step"]')).toHaveLength(4);
    });

    it('shows an answer as text without the core', () => {
        act(() => root.render(<AgentPromptPanel session={agentSession({ turns: [answered(1, 'q', 'There are **42** orders')] })} />));
        expect(answerOf(container)?.textContent).toBe('There are **42** orders');
        expect(answerOf(container)?.hasAttribute('data-plain')).toBe(true);
    });

    it('starts a new conversation and hides the conversation', () => {
        const onHide = vi.fn();
        const agent = agentSession({ turns: [answered(1, 'q', 'a')] });
        render(<AgentPromptPanel session={agent} onHide={onHide} />);
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="composer-agent-reset"]')!.click());
        expect(agent.onReset).toHaveBeenCalledOnce();
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="composer-agent-hide"]')!.click());
        expect(onHide).toHaveBeenCalledOnce();
        render(<AgentPromptPanel session={agent} />);
        expect(container.querySelector('[data-testid="composer-agent-hide"]')).toBeNull();
    });

    it('expands the latest turn and toggles the others', () => {
        container.style.width = '320px';
        const recap = '## Summary\n\nI wrote **top_customers** and ran it.\n\n'
            + Array.from({ length: 8 }, (_, i) => `- step ${i}: looked at the catalog and the scripts again`).join('\n');
        const longQuestion = 'which customers ordered the most in the last quarter, grouped by region and with the share of all orders';
        const agent = agentSession({
            turns: [
                { ...answered(1, longQuestion, recap), scripts: [{ scriptKey: 4, scriptName: 'top_customers' }] },
                answered(2, 'how many orders', 'There are 42 orders'),
            ],
        });
        render(<AgentPromptPanel session={agent} />);
        const turns = container.querySelectorAll('[data-testid="composer-agent-turn"]');
        const toggle = turns[0].querySelector<HTMLButtonElement>('[data-testid="composer-agent-turn-toggle"]')!;
        // An older turn is collapsed to its question, the latest one is expanded
        expect(turns[0].hasAttribute('data-expanded')).toBe(false);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(turns[0].querySelector<HTMLElement>('[data-testid="composer-agent-turn-question"]')!.title).toBe(longQuestion);
        expect(answerOf(turns[0])).toBeNull();
        expect(turns[0].querySelector('[data-testid="composer-agent-script"]')?.textContent).toBe('top_customers');
        expect(turns[1].hasAttribute('data-expanded')).toBe(true);
        expect(answerOf(turns[1])?.textContent).toBe('There are 42 orders');

        // An expanded turn shows its question and its answer in full
        act(() => toggle.click());
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        const question = turns[0].querySelector<HTMLElement>('[data-testid="composer-agent-turn-question"]')!;
        expect(question.scrollWidth).toBeLessThanOrEqual(question.clientWidth);
        const note = answerOf(turns[0])!;
        expect(note.querySelector('h2')?.textContent).toBe('Summary');
        expect(note.textContent).toContain('step 7');
        expect(note.scrollHeight).toBeLessThanOrEqual(note.clientHeight);

        // The latest turn collapses as well
        act(() => turns[1].querySelector<HTMLButtonElement>('[data-testid="composer-agent-turn-toggle"]')!.click());
        expect(turns[1].hasAttribute('data-expanded')).toBe(false);
        expect(answerOf(turns[1])).toBeNull();
    });

    it('keeps the texts of a turn selectable', () => {
        render(<AgentPromptPanel session={agentSession({ turns: [answered(1, 'how many customers', 'There are 7 customers'), answered(2, 'how many orders', 'There are 42 orders')] })} />);
        const turns = container.querySelectorAll('[data-testid="composer-agent-turn"]');
        const question = turns[0].querySelector<HTMLElement>('[data-testid="composer-agent-turn-question"]')!;
        // The question is not a part of the button but names it
        const toggle = turns[0].querySelector<HTMLButtonElement>('[data-testid="composer-agent-turn-toggle"]')!;
        expect(toggle.contains(question)).toBe(false);
        expect(toggle.getAttribute('aria-labelledby')).toBe(question.id);
        expect(getComputedStyle(question).userSelect).toBe('text');

        // A click on the question expands a collapsed turn, but does not collapse an expanded one
        act(() => question.click());
        expect(turns[0].hasAttribute('data-expanded')).toBe(true);
        expect(getComputedStyle(answerOf(turns[0])!).userSelect).toBe('text');
        act(() => question.click());
        expect(turns[0].hasAttribute('data-expanded')).toBe(true);
    });

    it('scrolls to a new question and to the answer', () => {
        const turn = (questionId: number) => answered(questionId, `question ${questionId}`, 'answer\n\n'.repeat(12));
        const turns = Array.from({ length: 6 }, (_, i) => turn(i + 1));
        render(<AgentPromptPanel session={agentSession({ turns })} />);
        const list = container.querySelector<HTMLElement>('[aria-label="Questions"]')!;
        // The turns scroll within the height of the list
        expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
        expect(list.scrollTop + list.clientHeight).toBeGreaterThanOrEqual(list.scrollHeight - 1);

        act(() => { list.scrollTop = 0; });
        const asked: AgentTurn = { questionId: 7, question: { question: 'question 7', status: 'working', error: null, interrupted: false, note: null, steps: [] }, scripts: [] };
        render(<AgentPromptPanel session={agentSession({ turns: [...turns, asked] })} />);
        expect(list.scrollTop + list.clientHeight).toBeGreaterThanOrEqual(list.scrollHeight - 1);
        // The answer of the latest question scrolls into view while the user stays at the bottom
        render(<AgentPromptPanel session={agentSession({ turns: [...turns, turn(7)] })} />);
        expect(list.scrollTop + list.clientHeight).toBeGreaterThanOrEqual(list.scrollHeight - 1);
    });

    it('names the built-in harnesses', () => {
        expect(harnessLabel('claude')).toBe('Claude Code');
        expect(harnessLabel('codex')).toBe('Codex');
        expect(harnessLabel('opencode')).toBe('opencode');
        expect(harnessLabel('my-harness')).toBe('my-harness');
    });
});
