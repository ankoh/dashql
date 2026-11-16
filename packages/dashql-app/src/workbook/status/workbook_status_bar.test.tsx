import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkbookStatusBar, WorkbookStatusBarVariant } from './workbook_status_bar.js';
import { WorkbookStatusContext, WorkbookStatusStore } from './workbook_status_store.js';
import { WorkbookStatusSource, WorkbookStatusTone, type WorkbookStatus } from './workbook_status.js';
import type { AgentSession, AgentTurn } from '../../agent/agent_session.js';
import { getGlobalLogger, LoggerProvider } from '../../platform/logger_provider.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

function agentSession(turns: AgentTurn[] = [], connected = true): AgentSession {
    return {
        harness: 'claude',
        folder: '/agent',
        connected,
        turns,
        logins: [],
        onDismiss: vi.fn(),
        onShowScript: vi.fn(),
    };
}

const working: AgentTurn = {
    questionId: 1,
    question: { question: 'how many orders', status: 'dashql lint scripts/orders.sql', error: null, note: null },
    scripts: [],
};
const answered: AgentTurn = {
    questionId: 1,
    question: { question: 'how many orders', status: null, error: null, note: 'There are 42 orders' },
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

    function render(props: Partial<React.ComponentProps<typeof WorkbookStatusBar>> = {}) {
        act(() => root.render(
            <LoggerProvider>
                <WorkbookStatusContext.Provider value={store}>
                    <WorkbookStatusBar workbookId="w1" variant={WorkbookStatusBarVariant.Prompt} paused {...props} />
                </WorkbookStatusContext.Provider>
            </LoggerProvider>,
        ));
    }

    const statusLine = () => container.querySelector<HTMLElement>('[data-testid="workbook-status"]')!;
    const wobble = () => container.querySelector<HTMLButtonElement>('[data-testid="workbook-wobble"]')!;
    const bubble = () => container.querySelector('[data-testid="workbook-bubble"]');
    const busyDot = () => container.querySelector('[data-testid="workbook-wobble-dot"]');
    const agentState = () => container.querySelector<HTMLElement>('[data-testid="workbook-agent-state"]');

    it('leads with Wobble and is ready while nothing happened', () => {
        render();
        expect(container.querySelector('[data-testid="workbook-status-bar"]')!.firstElementChild).toBe(wobble());
        expect(statusLine().textContent).toBe('Ready');
        expect(busyDot()).toBeNull();
        // Without the session of an agent, the bar shows no agent
        expect(agentState()).toBeNull();
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
        render({ session: agentSession() });
        expect(bubble()).toBeNull();
        expect(agentState()!.dataset.state).toBe('connected');
        expect(agentState()!.textContent).toBe('Claude Code');
        expect(agentState()!.title).toBe('Claude Code in /agent');
        render({ session: agentSession([working]) });
        expect(bubble()).not.toBeNull();
        expect(container.querySelector('[data-testid="composer-agent"]')).not.toBeNull();
        expect(agentState()!.dataset.state).toBe('working');
        // The terminal stops the agent, the page only watches
        expect(container.querySelector('[data-testid="workbook-agent-stop"]')).toBeNull();
        render({ session: agentSession([answered]) });
        expect(bubble()).not.toBeNull();
    });

    it('tells that the page lost the session', () => {
        render({ variant: WorkbookStatusBarVariant.Standalone, session: agentSession([], false) });
        expect(container.querySelector<HTMLElement>('[data-testid="workbook-status-bar"]')!.dataset.variant).toBe('standalone');
        expect(agentState()!.dataset.state).toBe('lost');
    });

    it('leaves Wobble out on the landing view', () => {
        render({ wobble: false });
        expect(container.querySelector('[data-testid="workbook-wobble"]')).toBeNull();
        expect(agentState()).toBeNull();
        expect(statusLine().textContent).toBe('Ready');
    });
});
