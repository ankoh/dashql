import * as React from 'react';
import * as arrow from 'apache-arrow';
import type * as dashql from '@ankoh/dashql-core';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { QueryExecutionStatus } from '../../../query/query_execution_state.js';
import {
    ShellQueryResultOverlay,
    type ShellQueryResultOverlayDependencies,
} from './shell_query_result_overlay.js';

const dependencies: ShellQueryResultOverlayDependencies = {
    QueryResultDetails: () => <div data-testid="mock-query-results" style={{ height: 240 }}>Query results</div>,
    useHyperPlan: (planText: string | null) => ({
        plan: planText?.includes('executiontarget')
            ? { read: () => ({}) } as unknown as dashql.FlatBufferPtr<dashql.buffers.view.PlanViewModel>
            : null,
        rejected: planText != null && !planText.includes('executiontarget'),
    }),
    PlanView: () => <div data-testid="mock-plan-view">Query plan viewer</div>,
};

// Tab ids of the vertical tabs in the overlay
const DATA_TAB = 0;
const PLAN_TAB = 1;

function dialog(): HTMLElement {
    return document.querySelector<HTMLElement>('[role="dialog"]')!;
}

function tabButton(tab: number): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>(`[data-tab="${tab}"] button`);
}

function planView(): Element | null {
    return document.querySelector('[data-testid="mock-plan-view"]');
}

function queryResults(): Element | null {
    return document.querySelector('[data-testid="mock-query-results"]');
}

function expandToggle(): HTMLButtonElement {
    return document.querySelector<HTMLButtonElement>('[data-testid="plan-expand-toggle"]')!;
}

describe('ShellQueryResultOverlay', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        vi.restoreAllMocks();
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
                dependencies={dependencies}
            />,
        ));

        act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));

        expect(onClose).not.toHaveBeenCalled();
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    });

    it('retains outside mouse dismissal by default', () => {
        const onClose = vi.fn();
        act(() => root.render(
            <ShellQueryResultOverlay
                query={{ queryId: 42, status: QueryExecutionStatus.SUCCEEDED } as any}
                onClose={onClose}
                dependencies={dependencies}
            />,
        ));

        act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));

        expect(onClose).toHaveBeenCalledOnce();
    });

    it('initially focuses the dialog rather than its close button', () => {
        act(() => root.render(
            <ShellQueryResultOverlay
                query={{ queryId: 42, status: QueryExecutionStatus.SUCCEEDED } as any}
                onClose={vi.fn()}
                dependencies={dependencies}
            />,
        ));

        expect(document.activeElement).toBe(dialog());
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
                dependencies={dependencies}
            />,
        ));

        const planButton = tabButton(PLAN_TAB)!;
        const resultsButton = tabButton(DATA_TAB)!;
        expect(planButton.getAttribute('aria-current')).toBe('page');
        expect(resultsButton.getAttribute('aria-current')).toBeNull();
        expect(planView()).not.toBeNull();
        expect(queryResults()).toBeNull();
        expect(dialog().style.minHeight).toBe('min(360px, 80vh)');

        act(() => resultsButton.click());
        expect(resultsButton.getAttribute('aria-current')).toBe('page');
        expect(planButton.getAttribute('aria-current')).toBeNull();
        expect(queryResults()).not.toBeNull();
        expect(planView()).toBeNull();
        expect(dialog().style.minHeight).toBe('');

        act(() => planButton.click());
        expect(planButton.getAttribute('aria-current')).toBe('page');
        expect(resultsButton.getAttribute('aria-current')).toBeNull();
        expect(planView()).not.toBeNull();
        expect(queryResults()).toBeNull();
        expect(dialog().style.minHeight).toBe('min(360px, 80vh)');
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
                dependencies={dependencies}
            />,
        ));

        expect(tabButton(PLAN_TAB)).toBeNull();
        expect(queryResults()).not.toBeNull();
        expect(dialog().style.height).toBe('');
    });

    it('expands the Plan tab to fill the window', () => {
        const plan = '{"operator":"executiontarget","operatorId":1}';
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 272 } as DOMRect);
        act(() => root.render(
            <ShellQueryResultOverlay
                query={{
                    queryId: 42,
                    status: QueryExecutionStatus.SUCCEEDED,
                    resultTable: arrow.tableFromArrays({ value: [plan] }),
                } as any}
                onClose={vi.fn()}
                dependencies={dependencies}
            />,
        ));

        const overlayExpanded = () => dialog().closest('[data-expanded]')!.getAttribute('data-expanded');
        expect(overlayExpanded()).toBe('false');
        expect(dialog().style.height).toBe('272px');
        expect(expandToggle().getAttribute('aria-pressed')).toBe('false');

        act(() => expandToggle().click());
        expect(expandToggle().getAttribute('aria-pressed')).toBe('true');
        expect(overlayExpanded()).toBe('true');
        expect(dialog().style.height).toBe('');
        expect(dialog().style.minHeight).toBe('');

        // The Data tab keeps its regular size
        act(() => tabButton(DATA_TAB)!.click());
        expect(overlayExpanded()).toBe('false');

        act(() => tabButton(PLAN_TAB)!.click());
        act(() => expandToggle().click());
        expect(expandToggle().getAttribute('aria-pressed')).toBe('false');
        expect(overlayExpanded()).toBe('false');
        expect(dialog().style.height).toBe('272px');
    });

    it('locks the initial result height before selecting the Plan tab', () => {
        const plan = '{"operator":"executiontarget","operatorId":1}';
        const getBoundingClientRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
            .mockReturnValue({ height: 272 } as DOMRect);

        act(() => root.render(
            <ShellQueryResultOverlay
                query={{
                    queryId: 42,
                    status: QueryExecutionStatus.SUCCEEDED,
                    resultTable: arrow.tableFromArrays({ value: [plan] }),
                } as any}
                onClose={vi.fn()}
                dependencies={dependencies}
            />,
        ));

        expect(dialog().style.height).toBe('272px');
        expect(dialog().style.minHeight).toBe('min(360px, 80vh)');
        expect(getBoundingClientRect).toHaveBeenCalled();
    });
});
