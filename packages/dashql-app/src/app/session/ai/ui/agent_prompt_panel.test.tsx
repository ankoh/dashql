import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentPromptPanel, harnessLabel, isAgentWorking, type ComposerAgent } from './agent_prompt_panel.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

function composerAgent(overrides: Partial<ComposerAgent> = {}): ComposerAgent {
    return {
        connected: true,
        port: 47100,
        context: { folder: '/agent', harness: 'claude', harnessSession: null, terminalCommand: null },
        runs: [],
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
        expect(container.querySelector('[data-testid="composer-agent-run"]')).toBeNull();
    });

    it('shows the status line of a question and stops the agent', () => {
        const agent = composerAgent({
            runs: [{ scriptKey: 3, scriptName: '03_orders', generation: { question: 'how many orders', status: 'dashql agent catalog', error: null, note: null } }],
        });
        expect(isAgentWorking(agent)).toBe(true);
        act(() => root.render(<AgentPromptPanel agent={agent} />));
        expect(detail()).toBe('working');
        const run = container.querySelector('[data-testid="composer-agent-run"]')!;
        expect(run.getAttribute('data-state')).toBe('working');
        expect(run.textContent).toContain('how many orders');
        expect(run.querySelector('[role="status"]')?.textContent).toBe('dashql agent catalog');
        expect(run.querySelector('[data-testid="generation-dismiss"]')).toBeNull();

        act(() => run.querySelector<HTMLButtonElement>('[data-testid="generation-stop"]')!.click());
        expect(agent.onStop).toHaveBeenCalledExactlyOnceWith(3);
        act(() => run.querySelector<HTMLButtonElement>('[data-testid="composer-agent-script"]')!.click());
        expect(agent.onShowScript).toHaveBeenCalledExactlyOnceWith(3);
    });

    it('shows answers and errors until they are dismissed', () => {
        const agent = composerAgent({
            runs: [
                { scriptKey: 1, scriptName: '01_orders', generation: { question: 'how many orders', status: null, error: null, note: 'There are 42 orders' } },
                { scriptKey: 2, scriptName: '02_customers', generation: { question: 'how many customers', status: null, error: 'HTTP 500', note: null } },
            ],
        });
        expect(isAgentWorking(agent)).toBe(false);
        act(() => root.render(<AgentPromptPanel agent={agent} />));
        const runs = container.querySelectorAll('[data-testid="composer-agent-run"]');
        expect([...runs].map(run => run.getAttribute('data-state'))).toEqual(['done', 'failed']);
        expect(runs[0].querySelector('[role="note"]')?.textContent).toBe('There are 42 orders');
        expect(runs[1].querySelector('[role="alert"]')?.textContent).toBe('HTTP 500');
        expect(container.querySelector('[data-testid="generation-stop"]')).toBeNull();

        act(() => runs[1].querySelector<HTMLButtonElement>('[data-testid="generation-dismiss"]')!.click());
        expect(agent.onDismiss).toHaveBeenCalledExactlyOnceWith(2);
    });

    it('names the built-in harnesses', () => {
        expect(harnessLabel('claude')).toBe('Claude Code');
        expect(harnessLabel('codex')).toBe('Codex');
        expect(harnessLabel('my-harness')).toBe('my-harness');
    });
});
