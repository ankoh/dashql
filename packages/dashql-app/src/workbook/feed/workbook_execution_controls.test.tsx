import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkbookRunState } from '@akohn/dashql';

import { WorkbookConnectionAttentionContext } from '../connections/workbook_connection_attention.js';
import { WorkbookExecutionControls, useSkippedRunAttention, type WorkbookExecutionModel } from './workbook_execution_controls.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

/// A run of a workbook in a phase
function runState(phase: WorkbookRunState['phase'], extra: Partial<WorkbookRunState> = {}): WorkbookRunState {
    return {
        phase, busy: phase === 'planning' || phase === 'running' || phase === 'stopping', totalScripts: 5, completedScripts: 2,
        totalStatements: 9, completedStatements: 4, activeFileName: null, activeStatementIndex: null, activeStatementCount: null,
        error: null, skippedScripts: 0, skippedFiles: [], ...extra,
    };
}

/// The run of a workbook as a plain model, its operations are spies
function fakeExecution(state: WorkbookRunState | null, extra: Partial<WorkbookExecutionModel> = {}): WorkbookExecutionModel {
    return { state, busy: state?.busy ?? false, ready: true, runActive: state?.busy ?? false, start: vi.fn(), stop: vi.fn(), ...extra };
}

describe('WorkbookExecutionControls', () => {
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

    const render = (execution: WorkbookExecutionModel, startable = true) => act(() => root.render(
        <WorkbookExecutionControls workbookId="workbook" execution={execution} startable={startable} />,
    ));
    const executeAll = () => container.querySelector<HTMLButtonElement>('[data-testid="execute-all"]');
    const stopButton = () => container.querySelector<HTMLButtonElement>('[data-testid="stop-execution"]');
    const status = () => container.querySelector('[data-testid="execution-status"]')!;
    const details = () => document.querySelector('[data-testid="execution-details"]');
    const toggleDetails = () => act(() => container.querySelector<HTMLButtonElement>('[data-testid="execution-details-toggle"]')!.click());
    const closeDetails = () => act(() => document.querySelector<HTMLButtonElement>('[data-testid="execution-details-close"]')!.click());

    it('starts the workbook once it can run', () => {
        const execution = fakeExecution(null);
        render(execution);
        expect(executeAll()?.disabled).toBe(false);
        expect(executeAll()?.getAttribute('aria-label')).toBe('Execute All');
        act(() => executeAll()!.click());
        expect(execution.start).toHaveBeenCalledWith();
        // Not while the scripts can't run, e.g. a connection is busy or there are none
        render(execution, false);
        expect(executeAll()?.disabled).toBe(true);
        // Nor while a script of the workbook runs
        render(fakeExecution(null, { runActive: true }));
        expect(executeAll()?.disabled).toBe(true);
        // Nor before the compute database that reads the cached results is set up
        render(fakeExecution(null, { ready: false }));
        expect(executeAll()?.disabled).toBe(true);
    });

    it('shows the execution progress and stops the running workbook', () => {
        const running = runState('running', { activeFileName: '3_customers.sql', activeStatementIndex: 2, activeStatementCount: 3 });
        const execution = fakeExecution(running);
        render(execution);
        expect(status().getAttribute('data-phase')).toBe('running');
        expect(container.querySelector('[data-testid="execution-indicator"]')).not.toBeNull();
        expect(details()).toBeNull();
        toggleDetails();
        expect(details()?.textContent).toContain('3_customers.sql');
        closeDetails();
        expect(details()).toBeNull();
        expect(executeAll()).toBeNull();
        const button = stopButton()!;
        expect(button.disabled).toBe(false);
        act(() => button.click());
        expect(execution.stop).toHaveBeenCalledOnce();

        render(fakeExecution({ ...running, phase: 'stopping' }));
        expect(status().getAttribute('data-phase')).toBe('stopping');
        expect(stopButton()?.disabled).toBe(true);
        expect(stopButton()).toBe(button);

        render(fakeExecution({ ...running, phase: 'failed', busy: false, error: 'Backend failure' }));
        expect(status().getAttribute('data-phase')).toBe('failed');
        expect(stopButton()).toBeNull();
        expect(executeAll()).toBe(button);
        expect(status().getAttribute('aria-label')).toContain('Backend failure');
        expect(details()).toBeNull();
        toggleDetails();
        expect(details()?.textContent).toContain('Backend failure');
        expect(details()?.textContent).toContain('3_customers.sql');
        closeDetails();
        expect(details()).toBeNull();

        render(fakeExecution({ ...running, phase: 'succeeded', busy: false, completedScripts: 5 }));
        expect(status().getAttribute('data-phase')).toBe('succeeded');
        expect(status().textContent).toContain('5/5 succeeded');
        toggleDetails();
        expect(details()).not.toBeNull();
    });

    it('keeps the running status indicator mounted as execution progress changes', () => {
        const running = runState('running', { completedScripts: 1, completedStatements: 1 });
        render(fakeExecution(running));
        const indicator = container.querySelector('[data-testid="execution-indicator"] svg');
        expect(indicator).not.toBeNull();
        render(fakeExecution({ ...running, completedScripts: 2, completedStatements: 4 }));
        expect(container.querySelector('[data-testid="execution-indicator"] svg')).toBe(indicator);
    });

    it('names the scripts that a run skipped for their connections', () => {
        render(fakeExecution(runState('succeeded', { completedScripts: 3, skippedScripts: 2, skippedFiles: ['2.sql', '3.sql'] })));
        expect(status().textContent).toContain('3/5 completed · 2 need a connection');
        expect(status().getAttribute('title')).toBe('Need a connection: 2.sql, 3.sql');
        render(fakeExecution(runState('succeeded', { completedScripts: 3 })));
        expect(status().textContent).toContain('3/5 succeeded');
    });
});

describe('useSkippedRunAttention', () => {
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

    function Probe(props: { execution: WorkbookExecutionModel }) {
        useSkippedRunAttention('workbook', props.execution);
        return null;
    }

    it('points at the connections once a run skipped the scripts that need them', async () => {
        const attention = { active: false, request: vi.fn<() => void>() };
        const render = (phase: WorkbookRunState['phase'], skippedScripts: number) => act(() => root.render(
            <WorkbookConnectionAttentionContext.Provider value={attention}>
                <Probe execution={fakeExecution(runState(phase, { skippedScripts, skippedFiles: ['2.sql', '3.sql'].slice(0, skippedScripts) }))} />
            </WorkbookConnectionAttentionContext.Provider>,
        ));
        // A run that settled before the page mounted points at nothing
        render('succeeded', 2);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(attention.request).not.toHaveBeenCalled();
        render('running', 2);
        expect(attention.request).not.toHaveBeenCalled();
        // The request lands with the commit of the settled run
        render('succeeded', 2);
        await vi.waitFor(() => expect(attention.request).toHaveBeenCalledExactlyOnceWith());
        render('succeeded', 2);
        expect(attention.request).toHaveBeenCalledOnce();
        // A run that skipped nothing points at nothing
        render('running', 0);
        render('succeeded', 0);
        expect(attention.request).toHaveBeenCalledOnce();
    });
});
