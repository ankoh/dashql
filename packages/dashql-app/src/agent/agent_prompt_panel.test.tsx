import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentPromptPanel, harnessLabel, isAgentWorking, plainAgentNote, type ComposerAgent } from './agent_prompt_panel.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

function composerAgent(overrides: Partial<ComposerAgent> = {}): ComposerAgent {
    return {
        connected: true,
        port: 47100,
        context: { folder: '/agent', harness: 'claude', harnessSession: null, terminalCommand: null },
        turns: [],
        onStop: vi.fn(),
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

    it('names the harness and the connection to the agent server', () => {
        act(() => root.render(<AgentPromptPanel agent={composerAgent()} />));
        expect(container.textContent).toContain('Claude Code');
        expect(detail()).toBe('starts a new conversation');

        const resumed = composerAgent({ context: { folder: '/agent', harness: 'opencode', harnessSession: 'abc', terminalCommand: null } });
        act(() => root.render(<AgentPromptPanel agent={resumed} />));
        expect(container.textContent).toContain('opencode');
        expect(detail()).toBe('continues the conversation');

        act(() => root.render(<AgentPromptPanel agent={composerAgent({ connected: false, context: null, port: 47101 })} />));
        expect(container.textContent).toContain('Agent');
        expect(detail()).toBe('looking for the agent server on port 47101');
        expect(container.querySelector('[data-testid="composer-agent-turn"]')).toBeNull();
    });

    it('shows the status line of a question and stops the agent', () => {
        const agent = composerAgent({
            turns: [{
                questionId: 3,
                question: { question: 'how many orders', status: 'dashql agent catalog', error: null, note: null, scripts: [7] },
                scripts: [{ scriptKey: 7, scriptName: 'orders' }],
            }],
        });
        expect(isAgentWorking(agent)).toBe(true);
        act(() => root.render(<AgentPromptPanel agent={agent} />));
        expect(detail()).toBe('working');
        const turn = container.querySelector('[data-testid="composer-agent-turn"]')!;
        expect(turn.getAttribute('data-state')).toBe('working');
        expect(turn.textContent).toContain('how many orders');
        expect(turn.querySelector('[role="status"]')?.textContent).toBe('dashql agent catalog');
        expect(turn.querySelector('[data-testid="question-dismiss"]')).toBeNull();

        act(() => turn.querySelector<HTMLButtonElement>('[data-testid="question-stop"]')!.click());
        expect(agent.onStop).toHaveBeenCalledExactlyOnceWith(3);
        act(() => turn.querySelector<HTMLButtonElement>('[data-testid="composer-agent-script"]')!.click());
        expect(agent.onShowScript).toHaveBeenCalledExactlyOnceWith(7);
    });

    it('shows answers and errors until they are dismissed', () => {
        const agent = composerAgent({
            turns: [
                { questionId: 1, question: { question: 'how many orders', status: null, error: null, note: 'There are 42 orders', scripts: [] }, scripts: [] },
                { questionId: 2, question: { question: 'how many customers', status: null, error: 'HTTP 500', note: null, scripts: [] }, scripts: [] },
                { questionId: 3, question: { question: 'top customers', status: null, error: null, note: null, scripts: [4] }, scripts: [{ scriptKey: 4, scriptName: 'top_customers' }] },
            ],
        });
        expect(isAgentWorking(agent)).toBe(false);
        act(() => root.render(<AgentPromptPanel agent={agent} />));
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
        expect(container.querySelector('[data-testid="question-stop"]')).toBeNull();

        act(() => turns[1].querySelector<HTMLButtonElement>('[data-testid="question-dismiss"]')!.click());
        expect(agent.onDismiss).toHaveBeenCalledExactlyOnceWith(2);
    });

    it('expands the latest turn and toggles the others', () => {
        container.style.width = '320px';
        const recap = '## Summary\n\nI wrote **top_customers** with `dashql agent edit` and ran it.\n\n'
            + Array.from({ length: 8 }, (_, i) => `- step ${i}: looked at the catalog and the scripts again`).join('\n');
        const longQuestion = 'which customers ordered the most in the last quarter, grouped by region and with the share of all orders';
        const agent = composerAgent({
            turns: [
                { questionId: 1, question: { question: longQuestion, status: null, error: null, note: recap, scripts: [4] }, scripts: [{ scriptKey: 4, scriptName: 'top_customers' }] },
                { questionId: 2, question: { question: 'how many orders', status: null, error: null, note: 'There are 42 orders', scripts: [] }, scripts: [] },
            ],
        });
        act(() => root.render(<AgentPromptPanel agent={agent} />));
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
        const agent = composerAgent({
            turns: [
                { questionId: 1, question: { question: 'how many customers', status: null, error: null, note: 'There are 7 customers', scripts: [] }, scripts: [] },
                { questionId: 2, question: { question: 'how many orders', status: null, error: null, note: 'There are 42 orders', scripts: [] }, scripts: [] },
            ],
        });
        act(() => root.render(<AgentPromptPanel agent={agent} />));
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
            question: { question: `question ${questionId}`, status: null, error: null, note: 'answer\n'.repeat(12), scripts: [] },
            scripts: [],
        });
        const turns = Array.from({ length: 6 }, (_, i) => turn(i + 1));
        act(() => root.render(<AgentPromptPanel agent={composerAgent({ turns })} />));
        const list = container.querySelector<HTMLElement>('[aria-label="Questions"]')!;
        // The turns scroll within the height of the list
        expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
        expect(list.scrollTop + list.clientHeight).toBeGreaterThanOrEqual(list.scrollHeight - 1);

        act(() => { list.scrollTop = 0; });
        act(() => root.render(<AgentPromptPanel agent={composerAgent({ turns: [...turns, turn(7)] })} />));
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
});
