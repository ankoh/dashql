import * as React from 'react';
import { DndContext } from '@dnd-kit/core';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QueryExecutionStatus } from '../../query/query_execution_state.js';
import type { ScriptData } from '../scripts/session_scripts.js';
import { DashboardCard, type DashboardCardDependencies } from './dashboard_card.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const dependencies = {
    useQueryState: () => ({ queryId: 7 }),
    QueryResultPanel: (props: { onShowTable?: () => void }) => <div data-testid="output" onClick={props.onShowTable}>output</div>,
    VisualizationDispatch: () => <div data-testid="visualization">visualization</div>,
    ScriptEditor: () => <div data-testid="content">content</div>,
} as unknown as DashboardCardDependencies;

const script = {
    scriptKey: 1,
    fileName: '1_sales.sql',
    latestQueryId: 7,
    annotations: {
        visualizeQuery: { renderer: 'vegalite', sql: 'select 1', statementId: 0, vegaLiteSpec: {} },
    },
} as ScriptData;

describe('DashboardCard', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root.render(
            <DndContext>
                <DashboardCard
                    sessionId="session"
                    script={script}
                    placement={{ id: 1, section: 'visualizations', row: 0, column: 0, width: 6, height: 3 }}
                    columnStep={100}
                    rowStep={108}
                    onResize={vi.fn()}
                    onResizeCancel={vi.fn()}
                    shifted={false}
                    onVisualize={vi.fn()}
                    onOpenChart={vi.fn()}
                    onRemoveVisualization={vi.fn()}
                    onOpenEditor={vi.fn()}
                    onOpenTable={vi.fn()}
                    onAcceptDiff={vi.fn()}
                    onRejectDiff={vi.fn()}
                    runnable
                    onRun={vi.fn()}
                    onStop={vi.fn()}
                    dependencies={dependencies}
                />
            </DndContext>,
        ));
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('opens the editor and collapses the card from the header', () => {
        const onOpenEditor = vi.fn();
        const onRemoveVisualization = vi.fn();
        act(() => root.render(
            <DndContext>
                <DashboardCard
                    sessionId="session"
                    script={script}
                    placement={{ id: 1, section: 'visualizations', row: 0, column: 0, width: 2, height: 1 }}
                    columnStep={100}
                    rowStep={108}
                    onResize={vi.fn()}
                    onResizeCancel={vi.fn()}
                    shifted={false}
                    onVisualize={vi.fn()}
                    onOpenChart={vi.fn()}
                    onRemoveVisualization={onRemoveVisualization}
                    onOpenEditor={onOpenEditor}
                    onOpenTable={vi.fn()}
                    onAcceptDiff={vi.fn()}
                    onRejectDiff={vi.fn()}
                    runnable
                    onRun={vi.fn()}
                    onStop={vi.fn()}
                    dependencies={dependencies}
                />
            </DndContext>,
        ));

        // The card keeps its visualization, the editor opens in an overlay of the board
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="dashboard-card-edit"]')!.click());
        expect(onOpenEditor).toHaveBeenCalledWith(1);
        expect(container.querySelector('[data-testid="visualization"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="content"]')).toBeNull();

        act(() => container.querySelector<HTMLButtonElement>('[data-testid="dashboard-card-renderer-collapsed"]')!.click());
        expect(onRemoveVisualization).toHaveBeenCalledWith(1);
    });

    it('groups run, chart builder, edit and the menu, the menu renames and deletes the script', async () => {
        const onRename = vi.fn();
        const onDelete = vi.fn();
        act(() => root.render(
            <DndContext>
                <DashboardCard
                    sessionId="session"
                    script={script}
                    placement={{ id: 1, section: 'visualizations', row: 0, column: 0, width: 6, height: 3 }}
                    columnStep={100}
                    rowStep={108}
                    onResize={vi.fn()}
                    onResizeCancel={vi.fn()}
                    shifted={false}
                    onVisualize={vi.fn()}
                    onOpenChart={vi.fn()}
                    onRemoveVisualization={vi.fn()}
                    onOpenEditor={vi.fn()}
                    onOpenTable={vi.fn()}
                    onAcceptDiff={vi.fn()}
                    onRejectDiff={vi.fn()}
                    runnable
                    onRun={vi.fn()}
                    onStop={vi.fn()}
                    onRename={onRename}
                    onDelete={onDelete}
                    dependencies={dependencies}
                />
            </DndContext>,
        ));
        const group = container.querySelector('[role="group"][aria-label="Actions of 1_sales"]')!;
        expect([...group.querySelectorAll('button')].map(b => b.getAttribute('data-testid')))
            .toEqual(['dashboard-card-run', 'dashboard-card-chart-builder', 'dashboard-card-edit', 'dashboard-card-more']);

        const menuItem = (action: string) => document.querySelector<HTMLElement>(`[data-testid="dashboard-card-menu-item"][data-action="${action}"]`)!;
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="dashboard-card-more"]')!.click());
        act(() => menuItem('rename').click());
        await act(() => new Promise(resolve => requestAnimationFrame(() => resolve(null))));
        const input = container.querySelector<HTMLInputElement>('input[aria-label="Script name"]')!;
        expect(document.activeElement).toBe(input);
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'revenue');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        expect(onRename).toHaveBeenCalledWith(1, 'revenue');
        expect(container.querySelector('input[aria-label="Script name"]')).toBeNull();

        act(() => container.querySelector<HTMLButtonElement>('[data-testid="dashboard-card-more"]')!.click());
        act(() => menuItem('delete').click());
        expect(onDelete).toHaveBeenCalledWith(1);
    });

    it('switches the renderer and opens the chart builder of a chart', () => {
        const onVisualize = vi.fn();
        const onOpenChart = vi.fn();
        const tableScript = {
            ...script,
            annotations: { visualizeQuery: { renderer: 'table', sql: 'select 1', statementId: 0 } },
        } as ScriptData;
        const render = (card: ScriptData, queryState: unknown) => act(() => root.render(
            <DndContext>
                <DashboardCard
                    sessionId="session"
                    script={card}
                    placement={{ id: 1, section: 'visualizations', row: 0, column: 0, width: 6, height: 3 }}
                    columnStep={100}
                    rowStep={108}
                    onResize={vi.fn()}
                    onResizeCancel={vi.fn()}
                    shifted={false}
                    onVisualize={onVisualize}
                    onOpenChart={onOpenChart}
                    onRemoveVisualization={vi.fn()}
                    onOpenEditor={vi.fn()}
                    onOpenTable={vi.fn()}
                    onAcceptDiff={vi.fn()}
                    onRejectDiff={vi.fn()}
                    runnable
                    onRun={vi.fn()}
                    onStop={vi.fn()}
                    dependencies={{ ...dependencies, useQueryState: () => queryState } as unknown as DashboardCardDependencies}
                />
            </DndContext>,
        ));
        const button = (id: string) => container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);

        // A table offers the chart and Markdown, the selected renderer does nothing
        const result = { schema: { fields: [{ name: 'region' }, { name: 'revenue' }] } };
        render(tableScript, { queryId: 7, status: QueryExecutionStatus.SUCCEEDED, resultTable: result });
        expect(button('dashboard-card-chart-builder')).toBeNull();
        act(() => button('dashboard-card-renderer-table')!.click());
        expect(onVisualize).not.toHaveBeenCalled();
        act(() => button('dashboard-card-renderer-chart')!.click());
        expect(onVisualize).toHaveBeenCalledWith(1, 'vegalite', '{"mark":"bar"}');
        expect(onOpenChart).not.toHaveBeenCalled();
        act(() => button('dashboard-card-renderer-markdown')!.click());
        expect(onVisualize).toHaveBeenCalledWith(1, 'markdown', '### {{region}}\n{{revenue}}');

        // Markdown needs a result for its template
        render(tableScript, null);
        expect(button('dashboard-card-renderer-markdown')!.disabled).toBe(true);

        // A chart switches to a table and opens its chart builder
        onOpenChart.mockReset();
        render(script, null);
        act(() => button('dashboard-card-renderer-table')!.click());
        expect(onVisualize).toHaveBeenCalledWith(1, 'table', '');
        act(() => button('dashboard-card-chart-builder')!.click());
        expect(onOpenChart).toHaveBeenCalledWith(1);
    });

    it('accepts or rejects a staged change instead of changing the card', () => {
        const onAcceptDiff = vi.fn();
        const onRejectDiff = vi.fn();
        const onOpenEditor = vi.fn();
        const staged = { ...script, pendingDiff: { priorText: 'select 1', diffBuffer: null } } as unknown as ScriptData;
        act(() => root.render(
            <DndContext>
                <DashboardCard
                    sessionId="session"
                    script={staged}
                    placement={{ id: 1, section: 'visualizations', row: 0, column: 0, width: 6, height: 3 }}
                    columnStep={100}
                    rowStep={108}
                    onResize={vi.fn()}
                    onResizeCancel={vi.fn()}
                    shifted={false}
                    onVisualize={vi.fn()}
                    onOpenChart={vi.fn()}
                    onRemoveVisualization={vi.fn()}
                    onOpenEditor={onOpenEditor}
                    onOpenTable={vi.fn()}
                    onAcceptDiff={onAcceptDiff}
                    onRejectDiff={onRejectDiff}
                    runnable
                    onRun={vi.fn()}
                    onStop={vi.fn()}
                    dependencies={dependencies}
                />
            </DndContext>,
        ));
        const button = (id: string) => container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);

        // The card shows the staged visualization, its renderer waits for the change
        expect(container.querySelector('[data-testid="visualization"]')).not.toBeNull();
        expect(button('dashboard-card-renderer-table')).toBeNull();
        expect(button('dashboard-card-renderer-collapsed')).toBeNull();
        act(() => button('dashboard-card-accept')!.click());
        expect(onAcceptDiff).toHaveBeenCalledWith(1);
        act(() => button('dashboard-card-reject')!.click());
        expect(onRejectDiff).toHaveBeenCalledWith(1);
        act(() => button('dashboard-card-edit')!.click());
        expect(onOpenEditor).toHaveBeenCalledWith(1);
    });

    it('runs a card without a result, refreshes one with a result and stops a running one', () => {
        const onRun = vi.fn();
        const onStop = vi.fn();
        const render = (queryState: unknown, runnable: boolean) => act(() => root.render(
            <DndContext>
                <DashboardCard
                    sessionId="session"
                    script={script}
                    placement={{ id: 1, section: 'visualizations', row: 0, column: 0, width: 6, height: 3 }}
                    columnStep={100}
                    rowStep={108}
                    onResize={vi.fn()}
                    onResizeCancel={vi.fn()}
                    shifted={false}
                    onVisualize={vi.fn()}
                    onOpenChart={vi.fn()}
                    onRemoveVisualization={vi.fn()}
                    onOpenEditor={vi.fn()}
                    onOpenTable={vi.fn()}
                    onAcceptDiff={vi.fn()}
                    onRejectDiff={vi.fn()}
                    runnable={runnable}
                    onRun={onRun}
                    onStop={onStop}
                    dependencies={{ ...dependencies, useQueryState: () => queryState } as unknown as DashboardCardDependencies}
                />
            </DndContext>,
        ));
        const run = () => container.querySelector<HTMLButtonElement>('[data-testid="dashboard-card-run"]')!;

        // Without a result the card runs and may read cached results
        render(null, true);
        expect(run().dataset.runAction).toBe('run');
        act(() => run().click());
        expect(onRun).toHaveBeenLastCalledWith(1, false);

        // With a result it refreshes without them
        render({ queryId: 7, status: QueryExecutionStatus.SUCCEEDED, cacheDeleted: false }, true);
        expect(run().dataset.runAction).toBe('refresh');
        act(() => run().click());
        expect(onRun).toHaveBeenLastCalledWith(1, true);
        render({ queryId: 7, status: QueryExecutionStatus.SUCCEEDED, cacheDeleted: false }, false);
        expect(run().disabled).toBe(true);

        // A running card stops, also while the session holds the run
        render({ queryId: 7, status: QueryExecutionStatus.RUNNING }, false);
        expect(run().dataset.runAction).toBe('stop');
        expect(run().disabled).toBe(false);
        act(() => run().click());
        expect(onStop).toHaveBeenCalledWith(1);
    });

    it('uses the query result view for table content and opens the full table from it', () => {
        const onOpenTable = vi.fn();
        const tableScript = {
            ...script,
            annotations: { visualizeQuery: { renderer: 'table', sql: 'select 1', statementId: 0 } },
        } as ScriptData;
        act(() => root.render(
            <DndContext>
                <DashboardCard
                    sessionId="session"
                    script={tableScript}
                    placement={{ id: 1, section: 'visualizations', row: 0, column: 0, width: 6, height: 3 }}
                    columnStep={100}
                    rowStep={108}
                    onResize={vi.fn()}
                    onResizeCancel={vi.fn()}
                    shifted={false}
                    onVisualize={vi.fn()}
                    onOpenChart={vi.fn()}
                    onRemoveVisualization={vi.fn()}
                    onOpenEditor={vi.fn()}
                    onOpenTable={onOpenTable}
                    onAcceptDiff={vi.fn()}
                    onRejectDiff={vi.fn()}
                    runnable
                    onRun={vi.fn()}
                    onStop={vi.fn()}
                    dependencies={dependencies}
                />
            </DndContext>,
        ));

        expect(container.querySelector('[data-testid="output"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="content"]')).toBeNull();
        act(() => container.querySelector<HTMLElement>('[data-testid="output"]')!.click());
        expect(onOpenTable).toHaveBeenCalledWith(1);
    });

    describe('without a visualization', () => {
        const plainScript = {
            ...script,
            annotations: { visualizeQuery: null, lastStatementIsQuery: true },
        } as unknown as ScriptData;
        const callbacks = { onVisualize: vi.fn(), onOpenChart: vi.fn(), onRemoveVisualization: vi.fn(), onAcceptDiff: vi.fn(), onRejectDiff: vi.fn(), onRun: vi.fn(), onStop: vi.fn(), onOpenEditor: vi.fn(), onOpenTable: vi.fn() };

        function renderCollapsed(card: ScriptData, queryState: unknown) {
            const collapsedDependencies = { ...dependencies, useQueryState: () => queryState } as unknown as DashboardCardDependencies;
            act(() => root.render(
                <DndContext>
                    <DashboardCard
                        sessionId="session"
                        script={card}
                        placement={{ id: 1, section: 'scripts', row: 0, column: 0, width: 6, height: 1 }}
                        columnStep={100}
                        rowStep={108}
                        onResize={vi.fn()}
                        onResizeCancel={vi.fn()}
                        shifted={false}
                        runnable={false}
                        {...callbacks}
                        dependencies={collapsedDependencies}
                    />
                </DndContext>,
            ));
        }
        const button = (id: string) => container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;

        beforeEach(() => {
            callbacks.onVisualize.mockReset();
            callbacks.onOpenChart.mockReset();
            callbacks.onOpenEditor.mockReset();
            callbacks.onRemoveVisualization.mockReset();
        });

        it('collapses to its header with the renderers and an editor', () => {
            const result = { schema: { fields: [{ name: 'region' }, { name: 'revenue' }, { name: 'year' }] } };
            renderCollapsed(plainScript, { queryId: 7, status: QueryExecutionStatus.SUCCEEDED, resultTable: result });
            expect(container.querySelector('[data-testid="output"]')).toBeNull();
            // An offline card does not run
            expect(button('dashboard-card-run').disabled).toBe(true);
            // The collapsed segment is selected, selecting it again changes nothing
            act(() => button('dashboard-card-renderer-collapsed').click());
            expect(callbacks.onRemoveVisualization).not.toHaveBeenCalled();

            act(() => button('dashboard-card-renderer-table').click());
            expect(callbacks.onVisualize).toHaveBeenCalledWith(1, 'table', '');
            act(() => button('dashboard-card-renderer-markdown').click());
            expect(callbacks.onVisualize).toHaveBeenCalledWith(1, 'markdown', '### {{region}}\n{{revenue}} · {{year}}');
            act(() => button('dashboard-card-renderer-chart').click());
            expect(callbacks.onVisualize).toHaveBeenCalledWith(1, 'vegalite', '{"mark":"bar"}');
            act(() => button('dashboard-card-edit').click());
            expect(callbacks.onOpenEditor).toHaveBeenCalledWith(1);
        });

        it('needs a result for a Markdown template', () => {
            renderCollapsed(plainScript, null);
            expect(button('dashboard-card-renderer-table').disabled).toBe(false);
            expect(button('dashboard-card-renderer-markdown').disabled).toBe(true);
        });

        it('visualizes only a query', () => {
            const ddl = { ...plainScript, annotations: { visualizeQuery: null, lastStatementIsQuery: false } } as unknown as ScriptData;
            renderCollapsed(ddl, null);
            expect(button('dashboard-card-renderer-table').disabled).toBe(true);
            expect(button('dashboard-card-renderer-chart').disabled).toBe(true);
            expect(button('dashboard-card-renderer-markdown').disabled).toBe(true);
            expect(button('dashboard-card-edit').disabled).toBe(false);
        });
    });
});
