import * as React from 'react';
import { DndContext } from '@dnd-kit/core';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QueryExecutionStatus } from '@akohn/dashql/platform/query/query_execution_state';
import type { ScriptData } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { DashboardCard, type DashboardCardDependencies, type DashboardCardProps } from './dashboard_card.js';
import { markdownTemplate } from './dashboard_source.js';
import { NEW_CHART_SPEC } from '../chart_builder/chart_spec_paths.js';
import { queryModelOf, resultTableOf, WithResultTables } from '../../tests/result_tables.js';
import { RenderScheduleContext } from '@akohn/dashql-react/components/deferred';
import { IMMEDIATE_SCHEDULE, type RenderSchedule } from '@akohn/dashql-react/dom/calm_frames';
import { fakeScriptModel } from '@akohn/dashql-react/testing/fake_models';
import type { QueryModel } from '@akohn/dashql-react/models/query_model';
import type { ScriptModel } from '@akohn/dashql-react/models/script_model';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

/// The model of the latest query of the script
const SEVEN = queryModelOf({ queryId: 7 } as never);

const dependencies = {
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

/// A card of a script with a model, the latest query and the props that a test gives
function card(options: { script?: ScriptData; query?: QueryModel | null; model?: Partial<ScriptModel> } & Partial<Omit<DashboardCardProps, 'model'>> = {}): React.ReactElement {
    const { script: cardScript = script, query = SEVEN, model, ...props } = options;
    return (
        <DndContext>
            <WithResultTables><DashboardCard
                model={fakeScriptModel({ script: cardScript, query, ...model })}
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
                onRename={vi.fn()}
                onDelete={vi.fn()}
                online
                dependencies={dependencies}
                {...props}
            /></WithResultTables>
        </DndContext>
    );
}

describe('DashboardCard', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root.render(card()));
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('shows the skeleton of a result until a calm frame renders it', () => {
        // The schedule runs its tasks when the test says so
        const tasks: (() => void)[] = [];
        const schedule: RenderSchedule = { ...IMMEDIATE_SCHEDULE, schedule: task => { tasks.push(task); return () => {}; }, hold: vi.fn() };
        const result = { schema: { fields: [{ name: 'region' }] } };
        const model = queryModelOf({ queryId: 7, status: QueryExecutionStatus.SUCCEEDED, resultTable: resultTableOf(result as never) } as never);
        act(() => root.render(
            <RenderScheduleContext.Provider value={schedule}>
                {card({ query: model })}
            </RenderScheduleContext.Provider>,
        ));
        expect(container.querySelector('[data-testid="skeleton"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="visualization"]')).toBeNull();
        expect(tasks).toHaveLength(1);
        act(() => tasks.shift()!());
        expect(container.querySelector('[data-testid="skeleton"]')).toBeNull();
        expect(container.querySelector('[data-testid="visualization"]')).not.toBeNull();
    });

    it('opens the editor and collapses the card from the header', () => {
        const onOpenEditor = vi.fn();
        const onRemoveVisualization = vi.fn();
        act(() => root.render(
            card({ placement: { id: 1, section: 'visualizations', row: 0, column: 0, width: 2, height: 1 }, onRemoveVisualization, onOpenEditor }),
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
            card({ onRename, onDelete }),
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
        const render = (shown: ScriptData, queryState: unknown) => act(() => root.render(
            card({ script: shown, query: queryModelOf(queryState as never), onVisualize, onOpenChart }),
        ));
        const button = (id: string) => container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);

        // A table offers the chart and Markdown, the selected renderer does nothing
        const result = { schema: { fields: [{ name: 'region' }, { name: 'revenue' }] } };
        render(tableScript, { queryId: 7, status: QueryExecutionStatus.SUCCEEDED, resultTable: resultTableOf(result as never) });
        expect(button('dashboard-card-chart-builder')).toBeNull();
        act(() => button('dashboard-card-renderer-table')!.click());
        expect(onVisualize).not.toHaveBeenCalled();
        act(() => button('dashboard-card-renderer-chart')!.click());
        expect(onVisualize).toHaveBeenCalledWith(1, 'vegalite', JSON.stringify(NEW_CHART_SPEC));
        expect(onOpenChart).not.toHaveBeenCalled();
        act(() => button('dashboard-card-renderer-markdown')!.click());
        expect(onVisualize).toHaveBeenCalledWith(1, 'markdown', markdownTemplate(['region', 'revenue']));

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
        const acceptDiff = vi.fn(async () => { });
        const rejectDiff = vi.fn(async () => { });
        const onOpenEditor = vi.fn();
        const staged = { ...script, pendingDiff: { priorText: 'select 1', diffBuffer: null } } as unknown as ScriptData;
        act(() => root.render(
            card({ script: staged, model: { acceptDiff, rejectDiff }, onOpenEditor }),
        ));
        const button = (id: string) => container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);

        // The card shows the staged visualization, its renderer waits for the change
        expect(container.querySelector('[data-testid="visualization"]')).not.toBeNull();
        expect(button('dashboard-card-renderer-table')).toBeNull();
        expect(button('dashboard-card-renderer-collapsed')).toBeNull();
        act(() => button('dashboard-card-accept')!.click());
        expect(acceptDiff).toHaveBeenCalledOnce();
        act(() => button('dashboard-card-reject')!.click());
        expect(rejectDiff).toHaveBeenCalledOnce();
        act(() => button('dashboard-card-edit')!.click());
        expect(onOpenEditor).toHaveBeenCalledWith(1);
    });

    it('runs a card without a result, refreshes one with a result and stops a running one', () => {
        const run = vi.fn(async () => { });
        const cancel = vi.fn(async () => { });
        const render = (queryState: unknown, online: boolean, runActive = false) => act(() => root.render(
            card({ query: queryModelOf(queryState as never), online, model: { run, cancel, runActive } }),
        ));
        const button = () => container.querySelector<HTMLButtonElement>('[data-testid="dashboard-card-run"]')!;

        // Without a result the card runs and may read cached results
        render(null, true);
        expect(button().dataset.runAction).toBe('run');
        act(() => button().click());
        expect(run).toHaveBeenLastCalledWith({ refresh: false });

        // With a result it refreshes without them
        render({ queryId: 7, status: QueryExecutionStatus.SUCCEEDED }, true);
        expect(button().dataset.runAction).toBe('refresh');
        act(() => button().click());
        expect(run).toHaveBeenLastCalledWith({ refresh: true });
        // Neither offline nor while a run holds the workbook
        render({ queryId: 7, status: QueryExecutionStatus.SUCCEEDED }, false);
        expect(button().disabled).toBe(true);
        render({ queryId: 7, status: QueryExecutionStatus.SUCCEEDED }, true, true);
        expect(button().disabled).toBe(true);

        // A running card stops, also while the workbook holds the run
        render({ queryId: 7, status: QueryExecutionStatus.RUNNING }, false, true);
        expect(button().dataset.runAction).toBe('stop');
        expect(button().disabled).toBe(false);
        act(() => button().click());
        expect(cancel).toHaveBeenCalledOnce();
    });

    it('uses the query result view for table content and opens the full table from it', () => {
        const onOpenTable = vi.fn();
        const tableScript = {
            ...script,
            annotations: { visualizeQuery: { renderer: 'table', sql: 'select 1', statementId: 0 } },
        } as ScriptData;
        act(() => root.render(
            card({ script: tableScript, onOpenTable }),
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
        const callbacks = { onVisualize: vi.fn(), onOpenChart: vi.fn(), onRemoveVisualization: vi.fn(), onOpenEditor: vi.fn(), onOpenTable: vi.fn() };

        function renderCollapsed(shown: ScriptData, queryState: unknown) {
            act(() => root.render(
                card({ script: shown, query: queryModelOf(queryState as never), placement: { id: 1, section: 'scripts', row: 0, column: 0, width: 6, height: 1 }, online: false, ...callbacks }),
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
            renderCollapsed(plainScript, { queryId: 7, status: QueryExecutionStatus.SUCCEEDED, resultTable: resultTableOf(result as never) });
            expect(container.querySelector('[data-testid="output"]')).toBeNull();
            // An offline card does not run
            expect(button('dashboard-card-run').disabled).toBe(true);
            // The collapsed segment is selected, selecting it again changes nothing
            act(() => button('dashboard-card-renderer-collapsed').click());
            expect(callbacks.onRemoveVisualization).not.toHaveBeenCalled();

            act(() => button('dashboard-card-renderer-table').click());
            expect(callbacks.onVisualize).toHaveBeenCalledWith(1, 'table', '');
            act(() => button('dashboard-card-renderer-markdown').click());
            expect(callbacks.onVisualize).toHaveBeenCalledWith(1, 'markdown', markdownTemplate(['region', 'revenue', 'year']));
            act(() => button('dashboard-card-renderer-chart').click());
            expect(callbacks.onVisualize).toHaveBeenCalledWith(1, 'vegalite', JSON.stringify(NEW_CHART_SPEC));
            // A KPI card starts with the defaults of its tag
            act(() => button('dashboard-card-renderer-kpi').click());
            expect(callbacks.onVisualize).toHaveBeenCalledWith(1, 'kpi', '');
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
            expect(button('dashboard-card-renderer-kpi').disabled).toBe(true);
            expect(button('dashboard-card-edit').disabled).toBe(false);
        });
    });
});
