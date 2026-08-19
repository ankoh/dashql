import * as React from 'react';
import * as arrow from 'apache-arrow';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { fakeButtonModule, fakeSymbolIconModule } from '../../../test/view_mocks.js';

vi.mock('../../../ui/foundations/button.js', async () => fakeButtonModule(await import('react')));
vi.mock('../../../ui/foundations/symbol_icon.js', async () => fakeSymbolIconModule(await import('react')));
vi.mock('../compute/ui/query_result/query_result_details.js', async () => {
    const React = await import('react');
    return { QueryResultDetails: () => React.createElement('div', null, 'Query results') };
});
vi.mock('../compute/ui/plan/hyper_plan_view.js', () => ({
    useHyperPlan: (planText: string | null) => ({
        plan: planText?.includes('executiontarget') ? { read: () => ({}) } : null,
        rejected: planText != null && !planText.includes('executiontarget'),
    }),
}));
vi.mock('../compute/ui/plan/plan_view.js', async () => {
    const React = await import('react');
    return { PlanView: () => React.createElement('div', null, 'Query plan viewer') };
});
vi.mock('../ui/tab_header.js', async () => {
    const React = await import('react');
    return { TabHeader: (props: { title: string; actions?: React.ReactNode }) => React.createElement(
        'div',
        null,
        props.title,
        props.actions,
    ) };
});

import { QueryExecutionStatus } from '../connections/query_execution_state.js';
import { ShellQueryResultOverlay } from './shell_query_result_overlay.js';

describe('ShellQueryResultOverlay', () => {
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
        document.getElementById('__dashqlPortalRoot__')?.remove();
    });

    it('does not dismiss on outside mouse events when disabled', () => {
        const onClose = vi.fn();
        act(() => root.render(
            <ShellQueryResultOverlay
                query={{ queryId: 42, status: QueryExecutionStatus.SUCCEEDED } as any}
                onClose={onClose}
                dismissOnClickOutside={false}
            />,
        ));

        act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));

        expect(onClose).not.toHaveBeenCalled();
        expect(document.querySelector('[aria-label="Shell query results"]')).not.toBeNull();
    });

    it('retains outside mouse dismissal by default', () => {
        const onClose = vi.fn();
        act(() => root.render(
            <ShellQueryResultOverlay
                query={{ queryId: 42, status: QueryExecutionStatus.SUCCEEDED } as any}
                onClose={onClose}
            />,
        ));

        act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));

        expect(onClose).toHaveBeenCalledOnce();
    });

    it('adds and selects a Plan tab for a valid 1x1 plan result', () => {
        const plan = '{"operator":"executiontarget","operatorId":1}';
        act(() => root.render(
            <ShellQueryResultOverlay
                query={{
                    queryId: 42,
                    status: QueryExecutionStatus.SUCCEEDED,
                    resultTable: arrow.tableFromArrays({ value: [plan] }),
                } as any}
                onClose={vi.fn()}
            />,
        ));

        expect(document.querySelector('button[aria-label="Query plan"]')).not.toBeNull();
        expect(document.body.textContent).toContain('Query plan viewer');
        expect(document.body.textContent).not.toContain('Query results');

        act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Query results"]')!.click());
        expect(document.body.textContent).toContain('Query results');

        act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Query plan"]')!.click());
        expect(document.body.textContent).toContain('Query plan viewer');
    });

    it('keeps only the Data tab for ordinary 1x1 JSON results', () => {
        act(() => root.render(
            <ShellQueryResultOverlay
                query={{
                    queryId: 42,
                    status: QueryExecutionStatus.SUCCEEDED,
                    resultTable: arrow.tableFromArrays({ value: ['{"key":1}'] }),
                } as any}
                onClose={vi.fn()}
            />,
        ));

        expect(document.querySelector('button[aria-label="Query plan"]')).toBeNull();
        expect(document.body.textContent).toContain('Query results');
    });
});
