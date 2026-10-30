import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSessionMenu } from './agent_session_menu.js';
import { AgentBridgeContext, type AgentBridge } from './agent_bridge.js';
import { AgentConnectionStatus } from '../../platform/agent/agent_client.js';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';

function fakeBridge(overrides: Partial<AgentBridge> = {}): AgentBridge {
    return {
        status: AgentConnectionStatus.Connected,
        supported: true,
        port: 47100,
        setPort: vi.fn(),
        harness: null,
        setHarness: vi.fn(),
        model: null,
        setModel: vi.fn(),
        effort: null,
        setEffort: vi.fn(),
        accessSessions: [],
        hasAccess: () => false,
        setAccess: vi.fn(),
        request: vi.fn(),
        cancel: vi.fn(() => Promise.resolve()),
        reset: vi.fn(() => Promise.resolve()),
        context: vi.fn(),
        info: vi.fn(),
        hold: vi.fn(() => () => { }),
        ...overrides,
    };
}

describe('Agent session menu', () => {
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
                    <AgentSessionMenu sessionId="s1" />
                </AgentBridgeContext.Provider>
            </LoggerProvider>,
        ));
    }

    function trigger(): HTMLButtonElement {
        return container.querySelector<HTMLButtonElement>('[data-testid="agent-access"]')!;
    }

    async function openItems(): Promise<HTMLElement[]> {
        await act(async () => trigger().click());
        return [...document.body.querySelectorAll<HTMLElement>('[data-testid="agent-menu-item"]')];
    }

    it('renders nothing without an agent bridge', async () => {
        await act(async () => root.render(<LoggerProvider><AgentSessionMenu sessionId="s1" /></LoggerProvider>));
        expect(trigger()).toBeNull();
    });

    it('starts the session right away', async () => {
        const bridge = fakeBridge();
        await render(bridge);
        expect(trigger().textContent).toContain('Start Session');
        expect(trigger().dataset.state).toBe('off');
        await act(async () => trigger().click());
        expect(bridge.setAccess).toHaveBeenCalledExactlyOnceWith('s1', true);
        expect(document.body.querySelector('[data-testid="agent-menu-item"]')).toBeNull();
    });

    it('cannot start a session in a browser without access to the agent server', async () => {
        await render(fakeBridge({ supported: false }));
        expect(trigger().disabled).toBe(true);
    });

    it('controls a started session', async () => {
        const bridge = fakeBridge({ hasAccess: () => true });
        await render(bridge);
        expect(trigger().textContent).toContain('Control Session');
        expect(trigger().dataset.state).toBe('connected');
        const items = await openItems();
        expect(items.map(item => [item.dataset.action, item.textContent])).toEqual([
            ['disconnect', 'Disconnect the Session'], ['reset', 'Reset the Session'], ['terminal', 'Continue in terminal'],
        ]);
        await act(async () => items[0].click());
        expect(bridge.setAccess).toHaveBeenCalledExactlyOnceWith('s1', false);
    });
});
