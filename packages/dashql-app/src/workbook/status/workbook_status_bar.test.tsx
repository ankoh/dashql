import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkbookStatusBar, WorkbookStatusBarVariant } from './workbook_status_bar.js';
import { WorkbookStatusContext, WorkbookStatusStore } from './workbook_status_store.js';
import { WorkbookStatusSource, WorkbookStatusTone, type WorkbookStatus } from './workbook_status.js';
import type { ComposerAgent, ComposerAgentTurn } from '../../agent/agent_prompt_panel.js';
import { AgentBridgeContext, type AgentBridge } from '../../agent/agent_bridge.js';
import { AgentQuestionStore } from '../../agent/agent_question_store.js';
import { AgentConnectionStatus } from '../../agent/agent_client.js';
import { getGlobalLogger, LoggerProvider } from '../../platform/logger/logger_provider.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

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
        accessWorkbooks: [],
        hasAccess: () => true,
        setAccess: vi.fn(),
        request: vi.fn(),
        cancel: vi.fn(() => Promise.resolve()),
        reset: vi.fn(() => Promise.resolve()),
        context: vi.fn(),
        info: vi.fn(),
        hold: vi.fn(() => () => { }),
        questions: new AgentQuestionStore(),
        ...overrides,
    };
}

function composerAgent(turns: ComposerAgentTurn[] = []): ComposerAgent {
    return {
        connected: true,
        port: 47100,
        context: { folder: '/agent', harness: 'claude', harnessSession: null, terminalCommand: null },
        turns,
        onStop: vi.fn(),
        onDismiss: vi.fn(),
        onShowScript: vi.fn(),
    };
}

const working: ComposerAgentTurn = {
    questionId: 1,
    question: { question: 'how many orders', status: 'dashql agent catalog', error: null, note: null, scripts: [] },
    scripts: [],
};
const answered: ComposerAgentTurn = {
    questionId: 1,
    question: { question: 'how many orders', status: null, error: null, note: 'There are 42 orders', scripts: [] },
    scripts: [],
};

function status(key: string, tone: WorkbookStatusTone, text: string, extra: Partial<WorkbookStatus> = {}): WorkbookStatus {
    return { key, source: WorkbookStatusSource.Query, tone, text, at: Date.UTC(2026, 10, 14, 10, 0, 0), ...extra };
}

describe('Workbook status bar', () => {
    let container: HTMLDivElement;
    let root: Root;
    let store: WorkbookStatusStore;
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        store = new WorkbookStatusStore();
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function render(props: Partial<React.ComponentProps<typeof WorkbookStatusBar>> = {}, bridge: AgentBridge | null = fakeBridge({ hasAccess: () => false })) {
        act(() => root.render(
            <LoggerProvider>
                <WorkbookStatusContext.Provider value={store}>
                    <AgentBridgeContext.Provider value={bridge}>
                        <WorkbookStatusBar workbookId="w1" variant={WorkbookStatusBarVariant.Prompt} bridge={bridge} paused {...props} />
                    </AgentBridgeContext.Provider>
                </WorkbookStatusContext.Provider>
            </LoggerProvider>,
        ));
    }

    const statusLine = () => container.querySelector<HTMLElement>('[data-testid="workbook-status"]')!;
    const wobble = () => container.querySelector<HTMLButtonElement>('[data-testid="workbook-wobble"]')!;
    const bubble = () => container.querySelector('[data-testid="workbook-bubble"]');
    const busyDot = () => container.querySelector('[data-testid="workbook-wobble-dot"]');
    const access = () => container.querySelector<HTMLButtonElement>('[data-testid="agent-access"]')!;

    it('leads with Wobble and is ready while nothing happened', () => {
        render();
        expect(container.querySelector('[data-testid="workbook-status-bar"]')!.firstElementChild).toBe(wobble());
        expect(statusLine().textContent).toBe('Ready');
        expect(busyDot()).toBeNull();
        expect(access().textContent).toContain('Enable Agent');
    });

    it('tells what runs first, then what needs the user, then what happened last', () => {
        render();
        act(() => store.setOutcome('w1', status('a', WorkbookStatusTone.Success, '1_orders ran', { detail: 'in 12 ms' })));
        expect(statusLine().textContent).toBe('1_orders ran in 12 ms');
        act(() => store.setLive('w1', 'connections', [status('c', WorkbookStatusTone.Attention, 'Trino is not connected', { source: WorkbookStatusSource.Connection })]));
        expect(statusLine().textContent).toBe('Trino is not connected');
        act(() => store.setLive('w1', 'queries', [status('q', WorkbookStatusTone.Progress, 'Running 2_revenue')]));
        expect(statusLine().textContent).toBe('Running 2_revenue');
        expect(statusLine().dataset.tone).toBe('progress');
        expect(busyDot()).not.toBeNull();
        act(() => store.setLive('w1', 'queries', []));
        expect(busyDot()).toBeNull();
        // Another workbook has a status of its own
        act(() => store.setOutcome('w2', status('b', WorkbookStatusTone.Failed, '1_other failed')));
        expect(statusLine().textContent).toBe('Trino is not connected');
    });

    it('shows the records of the log of the app that belong to the workbook in the bubble of Wobble', async () => {
        render();
        const logger = getGlobalLogger()!;
        act(() => wobble().click());
        expect(container.querySelector('[data-testid="workbook-bubble-empty"]')).not.toBeNull();
        // The log is dark in both color schemes
        expect(getComputedStyle(bubble()!).colorScheme).toBe('dark');
        act(() => {
            logger.info('1_orders ran', { workbookId: 'w1', scriptKey: '1', detail: 'in 12 ms' }, 'workbook_status');
            logger.info('Another workbook ran', { workbookId: 'w2' }, 'workbook_status');
            logger.warn('Running all scripts failed', { workbookId: 'w1', error: 'boom' }, 'workbook_execution');
        });
        await vi.waitFor(() => expect(container.querySelectorAll('[data-testid="workbook-log-line"]')).toHaveLength(2));
        const lines = [...container.querySelectorAll<HTMLElement>('[data-testid="workbook-log-line"]')];
        expect(lines.map(line => line.dataset.level)).toEqual(['info', 'warn']);
        // A line is short: the time, the level, the message and the target
        expect(lines[0].textContent).toContain('1_orders ran');
        expect(lines[0].textContent).toContain('workbook_status');
        expect(lines[0].textContent).not.toContain('in 12 ms');
        // A click shows the fields of the record, as in the log window
        act(() => lines[0].querySelector('button')!.click());
        expect(lines[0].hasAttribute('data-selected')).toBe(true);
        await vi.waitFor(() => expect(document.body.textContent).toContain('in 12 ms'));
        act(() => document.body.querySelector<HTMLButtonElement>('[aria-label="Next log"]')!.click());
        await vi.waitFor(() => expect(document.body.textContent).toContain('boom'));
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="workbook-bubble-close"]')!.click());
        expect(bubble()).toBeNull();
    });

    it('opens the bubble when the agent starts to work and keeps it open after the answer', () => {
        const bridge = fakeBridge();
        render({ agent: composerAgent() }, bridge);
        expect(bubble()).toBeNull();
        expect(container.querySelector<HTMLElement>('[data-testid="workbook-agent-state"]')!.dataset.state).toBe('connected');
        const agent = composerAgent([working]);
        render({ agent }, bridge);
        expect(bubble()).not.toBeNull();
        expect(container.querySelector('[data-testid="composer-agent"]')).not.toBeNull();
        expect(container.querySelector<HTMLElement>('[data-testid="workbook-agent-state"]')!.dataset.state).toBe('working');
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="workbook-agent-stop"]')!.click());
        expect(agent.onStop).toHaveBeenCalledExactlyOnceWith(1);
        render({ agent: composerAgent([answered]) }, bridge);
        expect(bubble()).not.toBeNull();
    });

    it('stands alone without the agent of the feed, the agent state comes from the bridge', () => {
        render({ variant: WorkbookStatusBarVariant.Standalone }, fakeBridge({ status: AgentConnectionStatus.Connecting }));
        expect(container.querySelector<HTMLElement>('[data-testid="workbook-status-bar"]')!.dataset.variant).toBe('standalone');
        expect(container.querySelector<HTMLElement>('[data-testid="workbook-agent-state"]')!.dataset.state).toBe('connecting');
        expect(access().getAttribute('aria-label')).toBe('Control Agent');
        expect(container.querySelector('[data-testid="workbook-agent-stop"]')).toBeNull();
    });

    it('leaves Wobble out on the landing view and the agent out without a bridge', () => {
        render({ wobble: false }, null);
        expect(container.querySelector('[data-testid="workbook-wobble"]')).toBeNull();
        expect(container.querySelector('[data-testid="agent-access"]')).toBeNull();
        expect(statusLine().textContent).toBe('Ready');
    });
});
