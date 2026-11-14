import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentPromptPanel, plainAgentNote } from './agent_prompt_panel.js';
import { harnessLabel, isAgentWorking, type AgentSession } from './agent_session.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

function agentSession(overrides: Partial<AgentSession> = {}): AgentSession {
    return {
        harness: 'claude',
        folder: '/agent',
        connected: true,
        turns: [],
        onDismiss: vi.fn(),
        onShowScript: vi.fn(),
        ...overrides,
    };
}

describe('Agent prompt panel', () => {
    let container: HTMLDivElement;
    let root: Root;
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

    it('names the harness, its folder and a lost session', () => {
        act(() => root.render(<AgentPromptPanel session={agentSession()} />));
        expect(container.textContent).toContain('Claude Code');
        expect(detail()).toBe('in /agent');

        act(() => root.render(<AgentPromptPanel session={agentSession({ harness: 'opencode' })} />));
        expect(container.textContent).toContain('opencode');

        act(() => root.render(<AgentPromptPanel session={agentSession({ connected: false })} />));
        expect(detail()).toBe('lost the session');
        expect(container.querySelector('[data-testid="composer-agent-turn"]')).toBeNull();
    });

    it('shows the status line of a question, the terminal stops the agent', () => {
        const agent = agentSession({
            turns: [{
                questionId: 3,
                question: { question: 'how many orders', status: 'dashql workbook check', error: null, note: null },
                scripts: [{ scriptKey: 7, scriptName: 'orders' }],
            }],
        });
        expect(isAgentWorking(agent)).toBe(true);
        act(() => root.render(<AgentPromptPanel session={agent} />));
        expect(detail()).toBe('working');
        const turn = container.querySelector('[data-testid="composer-agent-turn"]')!;
        expect(turn.getAttribute('data-state')).toBe('working');
        expect(turn.textContent).toContain('how many orders');
        expect(turn.querySelector('[role="status"]')?.textContent).toBe('dashql workbook check');
        expect(turn.querySelector('[data-testid="question-dismiss"]')).toBeNull();
        expect(turn.querySelector('[data-testid="question-stop"]')).toBeNull();
        act(() => turn.querySelector<HTMLButtonElement>('[data-testid="composer-agent-script"]')!.click());
        expect(agent.onShowScript).toHaveBeenCalledExactlyOnceWith(7);
    });

    it('shows answers and errors until they are dismissed', () => {
        const agent = agentSession({
            turns: [
                { questionId: 1, question: { question: 'how many orders', status: null, error: null, note: 'There are 42 orders' }, scripts: [] },
                { questionId: 2, question: { question: 'how many customers', status: null, error: 'HTTP 500', note: null }, scripts: [] },
                { questionId: 3, question: { question: 'top customers', status: null, error: null, note: null }, scripts: [{ scriptKey: 4, scriptName: 'top_customers' }] },
            ],
        });
        expect(isAgentWorking(agent)).toBe(false);
        act(() => root.render(<AgentPromptPanel session={agent} />));
        const turns = container.querySelectorAll('[data-testid="composer-agent-turn"]');
        expect([...turns].map(turn => turn.getAttribute('data-state'))).toEqual(['done', 'failed', 'done']);
        for (const turn of [turns[0], turns[1]]) {
            act(() => turn.querySelector<HTMLButtonElement>('[data-testid="composer-agent-turn-toggle"]')!.click());
        }
        expect(turns[0].querySelector('[role="note"]')?.textContent).toBe('There are 42 orders');
        expect(turns[0].querySelector('[data-testid="composer-agent-script"]')).toBeNull();
        expect(turns[1].querySelector('[role="alert"]')?.textContent).toBe('HTTP 500');
        // Without an answer, the scripts of the agent remain
        expect(turns[2].querySelector('[role="note"]')).toBeNull();
        expect(turns[2].querySelector('[data-testid="composer-agent-script"]')?.textContent).toBe('top_customers');

        act(() => turns[1].querySelector<HTMLButtonElement>('[data-testid="question-dismiss"]')!.click());
        expect(agent.onDismiss).toHaveBeenCalledExactlyOnceWith(2);
    });

    it('expands the latest turn and toggles the others', () => {
        container.style.width = '320px';
        const recap = '## Summary\n\nI wrote **top_customers** with `dashql agent edit` and ran it.\n\n'
            + Array.from({ length: 8 }, (_, i) => `- step ${i}: looked at the catalog and the scripts again`).join('\n');
        const longQuestion = 'which customers ordered the most in the last quarter, grouped by region and with the share of all orders';
        const agent = agentSession({
            turns: [
                { questionId: 1, question: { question: longQuestion, status: null, error: null, note: recap }, scripts: [{ scriptKey: 4, scriptName: 'top_customers' }] },
                { questionId: 2, question: { question: 'how many orders', status: null, error: null, note: 'There are 42 orders' }, scripts: [] },
            ],
        });
        act(() => root.render(<AgentPromptPanel session={agent} />));
        const turns = container.querySelectorAll('[data-testid="composer-agent-turn"]');
        const toggle = turns[0].querySelector<HTMLButtonElement>('[data-testid="composer-agent-turn-toggle"]')!;
        // An older turn is collapsed to its question, the latest one is expanded
        expect(turns[0].hasAttribute('data-expanded')).toBe(false);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(turns[0].querySelector<HTMLElement>('[data-testid="composer-agent-turn-question"]')!.title).toBe(longQuestion);
        expect(turns[0].querySelector('[role="note"]')).toBeNull();
        expect(turns[1].hasAttribute('data-expanded')).toBe(true);
        expect(turns[1].querySelector('[role="note"]')?.textContent).toBe('There are 42 orders');

        // An expanded turn shows its question and its answer in full
        act(() => toggle.click());
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        const question = turns[0].querySelector<HTMLElement>('[data-testid="composer-agent-turn-question"]')!;
        expect(question.scrollWidth).toBeLessThanOrEqual(question.clientWidth);
        const note = turns[0].querySelector<HTMLElement>('[role="note"]')!;
        expect(note.textContent!.startsWith('Summary\n\nI wrote top_customers with dashql agent edit and ran it.')).toBe(true);
        expect(note.textContent).toContain('step 7');
        expect(note.scrollHeight).toBeLessThanOrEqual(note.clientHeight);

        // The latest turn collapses as well
        act(() => turns[1].querySelector<HTMLButtonElement>('[data-testid="composer-agent-turn-toggle"]')!.click());
        expect(turns[1].hasAttribute('data-expanded')).toBe(false);
        expect(turns[1].querySelector('[role="note"]')).toBeNull();
    });

    it('keeps the texts of a turn selectable', () => {
        const agent = agentSession({
            turns: [
                { questionId: 1, question: { question: 'how many customers', status: null, error: null, note: 'There are 7 customers' }, scripts: [] },
                { questionId: 2, question: { question: 'how many orders', status: null, error: null, note: 'There are 42 orders' }, scripts: [] },
            ],
        });
        act(() => root.render(<AgentPromptPanel session={agent} />));
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
        const note = turns[0].querySelector<HTMLElement>('[role="note"]')!;
        expect(getComputedStyle(note).userSelect).toBe('text');
        act(() => question.click());
        expect(turns[0].hasAttribute('data-expanded')).toBe(true);
    });

    it('scrolls to a new question', () => {
        const turn = (questionId: number) => ({
            questionId,
            question: { question: `question ${questionId}`, status: null, error: null, note: 'answer\n'.repeat(12) },
            scripts: [],
        });
        const turns = Array.from({ length: 6 }, (_, i) => turn(i + 1));
        act(() => root.render(<AgentPromptPanel session={agentSession({ turns })} />));
        const list = container.querySelector<HTMLElement>('[aria-label="Questions"]')!;
        // The turns scroll within the height of the list
        expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
        expect(list.scrollTop + list.clientHeight).toBeGreaterThanOrEqual(list.scrollHeight - 1);

        act(() => { list.scrollTop = 0; });
        act(() => root.render(<AgentPromptPanel session={agentSession({ turns: [...turns, turn(7)] })} />));
        expect(list.scrollTop + list.clientHeight).toBeGreaterThanOrEqual(list.scrollHeight - 1);
    });

    it('drops the markdown markers of an answer', () => {
        expect(plainAgentNote('### Result\n\nThe **top** customer is `acme`.\n\n\n\nDone.')).toBe('Result\n\nThe top customer is acme.\n\nDone.');
        expect(plainAgentNote('  There are 42 orders  ')).toBe('There are 42 orders');
    });

    it('names the built-in harnesses', () => {
        expect(harnessLabel('claude')).toBe('Claude Code');
        expect(harnessLabel('codex')).toBe('Codex');
        expect(harnessLabel('opencode')).toBe('opencode');
        expect(harnessLabel('my-harness')).toBe('my-harness');
    });

    it('closes the log on the close button, only when it can be closed', () => {
        act(() => root.render(<AgentPromptPanel session={agentSession()} />));
        expect(container.querySelector('[data-testid="composer-agent-close"]')).toBeNull();
        const onClose = vi.fn();
        act(() => root.render(<AgentPromptPanel session={agentSession()} onClose={onClose} />));
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="composer-agent-close"]')!.click());
        expect(onClose).toHaveBeenCalledOnce();
    });
});
