import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentView } from './agent_view.js';
import { AgentBridgeContext, type AgentBridge } from './agent_bridge.js';
import { AgentConnectionStatus } from '../../platform/agent/agent_client.js';
import type { AgentServerInfo } from '../../platform/agent/agent_protocol.js';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';

const INFO: AgentServerInfo = {
    port: 47100,
    home: '/home/u/.dashql/agent',
    configPath: '/home/u/.dashql/agent/config.json',
    dev: false,
    defaultHarness: 'claude',
    harnesses: [
        { name: 'claude', command: ['claude', '-p', '{prompt}'], adapter: 'claude', program: '/usr/local/bin/claude' },
        { name: 'codex', command: ['codex', 'exec', '{prompt}'], adapter: 'codex', program: '/usr/local/bin/codex' },
        { name: 'opencode', command: ['opencode', 'run', '{prompt}'], adapter: 'opencode', program: null },
    ],
    clients: [{ id: 'c', kind: 'web', origin: 'https://dashql.app', sessions: [{ id: 's1', name: 'Revenue' }], focused: 's1' }],
    turns: [{ turnId: 't', session: 's1', harness: 'claude', state: 'running', status: 'dashql agent catalog' }],
};

function fakeBridge(overrides: Partial<AgentBridge> = {}): AgentBridge {
    return {
        status: AgentConnectionStatus.Connected,
        supported: true,
        port: 47100,
        setPort: vi.fn(),
        harness: null,
        setHarness: vi.fn(),
        accessSessions: [{ id: 's1', name: 'Revenue' }],
        hasAccess: () => true,
        setAccess: vi.fn(),
        request: vi.fn(),
        cancel: vi.fn(() => Promise.resolve()),
        reset: vi.fn(),
        context: vi.fn(),
        info: vi.fn(() => Promise.resolve(INFO)),
        hold: vi.fn(() => () => { }),
        ...overrides,
    };
}

describe('Agent view', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => { act(() => root.unmount()); container.remove(); });

    async function render(bridge: AgentBridge) {
        await act(async () => root.render(
            <LoggerProvider>
                <AgentBridgeContext.Provider value={bridge}>
                    <AgentView onClose={() => { }} />
                </AgentBridgeContext.Provider>
            </LoggerProvider>,
        ));
        // The info of the agent server arrives after the first render
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    }

    it('shows the harnesses and picks one', async () => {
        const bridge = fakeBridge();
        await render(bridge);
        expect(bridge.hold).toHaveBeenCalledOnce();
        expect(container.textContent).not.toContain('/usr/local/bin/claude');
        expect(container.textContent).toContain('dashql agent catalog');
        const harnesses = container.querySelectorAll<HTMLButtonElement>('[data-testid="agent-settings-harness"]');
        expect([...harnesses].map(b => [b.dataset.harness, b.disabled])).toEqual([['claude', false], ['codex', false], ['opencode', true]]);
        expect(harnesses[2].title).toBe('opencode is not installed');
        expect([...harnesses].map(b => b.getAttribute('aria-current'))).toEqual(['true', 'false', 'false']);
        await act(async () => harnesses[1].click());
        expect(bridge.setHarness).toHaveBeenCalledExactlyOnceWith('codex');
    });

    it('shows the picked harness and restores the default of the server', async () => {
        const bridge = fakeBridge({ harness: 'codex' });
        await render(bridge);
        const harnesses = container.querySelectorAll<HTMLButtonElement>('[data-testid="agent-settings-harness"]');
        expect([...harnesses].map(b => b.getAttribute('aria-current'))).toEqual(['false', 'true', 'false']);
        await act(async () => harnesses[0].click());
        expect(bridge.setHarness).toHaveBeenCalledExactlyOnceWith(null);
    });

    it('turns off agent access of a session', async () => {
        const bridge = fakeBridge();
        await render(bridge);
        const session = container.querySelector('[data-testid="agent-settings-session"]')!;
        expect(session.textContent).toContain('Revenue');
        await act(async () => session.querySelector('button')!.click());
        expect(bridge.setAccess).toHaveBeenCalledExactlyOnceWith('s1', false);
    });

    it('resets the port to the default', async () => {
        const bridge = fakeBridge({ port: 47101 });
        await render(bridge);
        expect(container.querySelector<HTMLInputElement>('[data-testid="agent-settings-port"]')!.value).toBe('47101');
        const reset = container.querySelector<HTMLButtonElement>('[aria-label="Reset to the default port"]')!;
        expect(reset.disabled).toBe(false);
        await act(async () => reset.click());
        expect(bridge.setPort).toHaveBeenCalledExactlyOnceWith(null);
    });

    it('explains how to start the agent server while it is not connected', async () => {
        const bridge = fakeBridge({ status: AgentConnectionStatus.Connecting, accessSessions: [] });
        await render(bridge);
        expect(bridge.info).not.toHaveBeenCalled();
        expect(container.textContent).toContain('dashql agent serve');
        expect(container.querySelector('[data-testid="agent-settings-harness"]')).toBeNull();
    });
});
