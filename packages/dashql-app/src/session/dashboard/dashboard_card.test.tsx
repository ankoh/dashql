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
    QueryResultPanel: () => <div data-testid="output">output</div>,
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
                    onOpenEditor={vi.fn()}
                    dependencies={dependencies}
                />
            </DndContext>,
        ));
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('switches between visualization content and query output', () => {
        expect(container.querySelector('[data-testid="visualization"]')).not.toBeNull();
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="dashboard-card-content-tab"]')!.click());
        expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="visualization"]')).toBeNull();

        act(() => container.querySelector<HTMLButtonElement>('[data-testid="dashboard-card-output-tab"]')!.click());
        expect(container.querySelector('[data-testid="visualization"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="content"]')).toBeNull();
    });

    it('uses the query result view for table content', () => {
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
                    onOpenEditor={vi.fn()}
                    dependencies={dependencies}
                />
            </DndContext>,
        ));

        expect(container.querySelector('[data-testid="output"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="content"]')).toBeNull();
    });

    describe('without a visualization', () => {
        const plainScript = {
            ...script,
            annotations: { visualizeQuery: null, lastStatementIsQuery: true },
        } as unknown as ScriptData;
        const callbacks = { onVisualize: vi.fn(), onOpenChart: vi.fn(), onOpenEditor: vi.fn() };

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
        });

        it('collapses to its header with the renderers and an editor', () => {
            const result = { schema: { fields: [{ name: 'region' }, { name: 'revenue' }, { name: 'year' }] } };
            renderCollapsed(plainScript, { queryId: 7, status: QueryExecutionStatus.SUCCEEDED, resultTable: result });
            expect(container.querySelector('[data-testid="output"]')).toBeNull();
            expect(container.querySelector('[data-testid="dashboard-card-output-tab"]')).toBeNull();

            act(() => button('dashboard-card-table').click());
            expect(callbacks.onVisualize).toHaveBeenCalledWith(1, 'table', '');
            act(() => button('dashboard-card-markdown').click());
            expect(callbacks.onVisualize).toHaveBeenCalledWith(1, 'markdown', '### {{region}}\n{{revenue}} · {{year}}');
            act(() => button('dashboard-card-chart').click());
            expect(callbacks.onOpenChart).toHaveBeenCalledWith(1);
            act(() => button('dashboard-card-edit').click());
            expect(callbacks.onOpenEditor).toHaveBeenCalledWith(1);
        });

        it('needs a result for a Markdown template', () => {
            renderCollapsed(plainScript, null);
            expect(button('dashboard-card-table').disabled).toBe(false);
            expect(button('dashboard-card-markdown').disabled).toBe(true);
        });

        it('visualizes only a query', () => {
            const ddl = { ...plainScript, annotations: { visualizeQuery: null, lastStatementIsQuery: false } } as unknown as ScriptData;
            renderCollapsed(ddl, null);
            expect(button('dashboard-card-table').disabled).toBe(true);
            expect(button('dashboard-card-chart').disabled).toBe(true);
            expect(button('dashboard-card-markdown').disabled).toBe(true);
            expect(button('dashboard-card-edit').disabled).toBe(false);
        });
    });
});
