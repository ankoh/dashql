import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSettingsView } from './agent_settings_view.js';
import { AgentBridgeContext, type AgentBridge } from '../../agent/agent_bridge.js';
import { AgentConnectionStatus } from '../../../platform/agent/agent_client.js';
import type { AgentServerInfo } from '../../../platform/agent/agent_protocol.js';
import { LoggerProvider } from '../../../platform/logger/logger_provider.js';

const INFO: AgentServerInfo = {
    port: 47100,
    home: '/home/u/.dashql/agent',
    configPath: '/home/u/.dashql/agent/config.json',
    dev: false,
    defaultHarness: 'claude',
    harnesses: [
        { name: 'claude', command: ['claude', '-p', '{prompt}'], adapter: 'claude', program: '/usr/local/bin/claude' },
        { name: 'opencode', command: ['opencode', 'run', '{prompt}'], adapter: 'opencode', program: null },
    ],
    clients: [{ id: 'c', kind: 'web', origin: 'https://dashql.app', sessions: [{ id: 's1', name: 'Revenue' }], focused: 's1' }],
    runs: [{ runId: 'r', session: 's1', harness: 'claude', state: 'running', status: 'dashql agent catalog' }],
};

function fakeBridge(overrides: Partial<AgentBridge> = {}): AgentBridge {
    return {
        status: AgentConnectionStatus.Connected,
        supported: true,
        port: 47100,
        setPort: vi.fn(),
        accessSessions: [{ id: 's1', name: 'Revenue' }],
        hasAccess: () => true,
        setAccess: vi.fn(),
        request: vi.fn(),
        cancel: vi.fn(() => Promise.resolve()),
        reset: vi.fn(),
        context: vi.fn(),
        info: vi.fn(() => Promise.resolve(INFO)),
        setDefaultHarness: vi.fn(() => Promise.resolve()),
        hold: vi.fn(() => () => { }),
        ...overrides,
    };
}

describe('Agent settings', () => {
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
                    <AgentSettingsView onClose={() => { }} />
                </AgentBridgeContext.Provider>
            </LoggerProvider>,
        ));
        // The info of the agent server arrives after the first render
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    }

    it('shows the harnesses and picks the default harness', async () => {
        const bridge = fakeBridge();
        await render(bridge);
        expect(bridge.hold).toHaveBeenCalledOnce();
        expect(container.textContent).toContain('/usr/local/bin/claude');
        expect(container.textContent).toContain('opencode is not installed');
        expect(container.textContent).toContain('dashql agent catalog');
        const harnesses = container.querySelectorAll<HTMLButtonElement>('[data-testid="agent-settings-harness"]');
        expect([...harnesses].map(b => b.dataset.harness)).toEqual(['claude', 'opencode']);
        await act(async () => harnesses[1].click());
        expect(bridge.setDefaultHarness).toHaveBeenCalledExactlyOnceWith('opencode');
    });

    it('turns off agent access of a session', async () => {
        const bridge = fakeBridge();
        await render(bridge);
        const session = container.querySelector('[data-testid="agent-settings-session"]')!;
        expect(session.textContent).toContain('Revenue');
        await act(async () => session.querySelector('button')!.click());
        expect(bridge.setAccess).toHaveBeenCalledExactlyOnceWith('s1', false);
    });

    it('explains how to start the agent server while it is not connected', async () => {
        const bridge = fakeBridge({ status: AgentConnectionStatus.Connecting, accessSessions: [] });
        await render(bridge);
        expect(bridge.info).not.toHaveBeenCalled();
        expect(container.textContent).toContain('dashql agent serve');
        expect(container.querySelector('[data-testid="agent-settings-harness"]')).toBeNull();
    });
});
