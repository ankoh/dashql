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

    it('clamps a long answer until it is expanded', () => {
        container.style.width = '320px';
        const recap = '## Summary\n\nI wrote **top_customers** with `dashql agent edit` and ran it.\n\n'
            + Array.from({ length: 8 }, (_, i) => `- step ${i}: looked at the catalog and the scripts again`).join('\n');
        const agent = composerAgent({
            turns: [
                { questionId: 1, question: { question: 'top customers', status: null, error: null, note: recap, scripts: [4] }, scripts: [{ scriptKey: 4, scriptName: 'top_customers' }] },
                { questionId: 2, question: { question: 'how many orders', status: null, error: null, note: 'There are 42 orders', scripts: [] }, scripts: [] },
            ],
        });
        act(() => root.render(<AgentPromptPanel agent={agent} />));
        const turns = container.querySelectorAll('[data-testid="composer-agent-turn"]');
        const note = turns[0].querySelector<HTMLElement>('[role="note"]')!;
        expect(note.textContent!.startsWith('Summary\n\nI wrote top_customers with dashql agent edit and ran it.')).toBe(true);
        expect(note.hasAttribute('data-expanded')).toBe(false);
        expect(note.scrollHeight).toBeGreaterThan(note.clientHeight);
        // A short answer needs no toggle
        expect(turns[1].querySelector('[data-testid="composer-agent-note-toggle"]')).toBeNull();

        const toggle = turns[0].querySelector<HTMLButtonElement>('[data-testid="composer-agent-note-toggle"]')!;
        expect(toggle.textContent).toBe('Show more');
        act(() => toggle.click());
        expect(note.hasAttribute('data-expanded')).toBe(true);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(toggle.textContent).toBe('Show less');
    });

    it('drops the markdown markers of an answer', () => {
        expect(plainAgentNote('### Result\n\nThe **top** customer is `acme`.\n\n\n\nDone.')).toBe('Result\n\nThe top customer is acme.\n\nDone.');
        expect(plainAgentNote('  There are 42 orders  ')).toBe('There are 42 orders');
    });

    it('names the built-in harnesses', () => {
        expect(harnessLabel('claude')).toBe('Claude Code');
        expect(harnessLabel('codex')).toBe('Codex');
        expect(harnessLabel('my-harness')).toBe('my-harness');
    });
});
