import * as React from 'react';
import * as arrow from 'apache-arrow';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import type { TopLevelSpec } from 'vega-lite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoggerProvider } from '../../../../platform/logger/logger_provider.js';
import { QueryExecutionStatus, type QueryExecutionState } from '../../../../query/query_execution_state.js';
import type { ResolvedVisualizeQuery } from '../../scripts/script_types.js';
import { authoredChartSpec, ChartBuilderOverlay, type ChartBuilderOverlayDependencies } from './chart_builder_overlay.js';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

/// The preview renders the spec it gets as text, Vega needs a computation registry
const dependencies: ChartBuilderOverlayDependencies = {
    VegaLiteView: (props => <pre data-testid="chart-preview-spec">{JSON.stringify(props.vegaLiteSpec)}</pre>) as ChartBuilderOverlayDependencies['VegaLiteView'],
};

function vegaLite(spec: Record<string, unknown>): ResolvedVisualizeQuery {
    return {
        renderer: 'vegalite',
        sql: 'select 1',
        statementId: 0,
        vegaLiteSpec: { $schema: 'https://vega.github.io/schema/vega-lite/v6.json', data: { $sql: 'select 1' }, ...spec } as unknown as TopLevelSpec,
    };
}

describe('ChartBuilderOverlay', () => {
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

    function render(props: Partial<React.ComponentProps<typeof ChartBuilderOverlay>> & { onChange: (spec: string) => void }) {
        act(() => root.render(
            <LoggerProvider>
                <ChartBuilderOverlay
                    scriptName="sales"
                    visualizeQuery={null}
                    queryState={null}
                    onClose={vi.fn()}
                    dependencies={dependencies}
                    {...props}
                />
            </LoggerProvider>,
        ));
    }

    const byTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

    function pick(triggerTestId: string, value: string) {
        act(() => byTestId(triggerTestId)!.click());
        const option = document.querySelector(`[role="option"][data-item="${CSS.escape(value)}"]`) as HTMLButtonElement | null;
        expect(option).not.toBeNull();
        act(() => option!.click());
    }

    it('strips the schema and the data of the compiled spec', () => {
        expect(authoredChartSpec(vegaLite({ mark: 'bar' }))).toEqual({ mark: 'bar' });
        expect(authoredChartSpec(null)).toEqual({ mark: 'bar' });
    });

    it('sends every builder edit to the script', () => {
        const onChange = vi.fn();
        render({ onChange, visualizeQuery: vegaLite({ mark: 'bar', encoding: { x: { field: 'region', type: 'nominal', axis: { labelAngle: 0 } } } }) });
        expect(byTestId('chart-builder')).not.toBeNull();
        expect(byTestId('chart-preview')?.textContent).toContain('Run the query');

        act(() => byTestId('chart-mark-line')!.click());
        expect(byTestId('chart-mark-line')?.getAttribute('aria-pressed')).toBe('true');
        expect(JSON.parse(onChange.mock.lastCall![0])).toEqual({
            mark: 'line',
            encoding: { x: { field: 'region', type: 'nominal', axis: { labelAngle: 0 } } },
        });

        pick('chart-channel-y-field', '\u001fcount');
        expect(JSON.parse(onChange.mock.lastCall![0]).encoding.y).toEqual({ aggregate: 'count', type: 'quantitative' });

        act(() => byTestId('chart-channel-x-remove')!.click());
        expect(JSON.parse(onChange.mock.lastCall![0]).encoding).toEqual({ x: { axis: { labelAngle: 0 } }, y: { aggregate: 'count', type: 'quantitative' } });
    });

    it('lists the columns of the result in the field dropdown', () => {
        const onChange = vi.fn();
        const resultTable = arrow.tableFromArrays({ region: ['a', 'b'], revenue: Float64Array.from([1, 2]) });
        const queryState = { queryId: 1, status: QueryExecutionStatus.SUCCEEDED, resultTable } as unknown as QueryExecutionState;
        render({ onChange, queryState });
        expect(Array.from(document.querySelectorAll('[data-testid="chart-column"]')).map(c => c.textContent)).toEqual(['Nregion', 'Qrevenue']);
        pick('chart-channel-y-field', 'revenue');
        expect(JSON.parse(onChange.mock.lastCall![0]).encoding.y).toEqual({ field: 'revenue', type: 'quantitative' });
        // The preview shows the edited spec
        expect(JSON.parse(byTestId('chart-preview-spec')!.textContent!)).toMatchObject({ mark: 'bar', encoding: { y: { field: 'revenue' } } });
    });

    it('shows the spec as JSON and sends valid edits to the script', () => {
        const onChange = vi.fn();
        render({ onChange, visualizeQuery: vegaLite({ mark: 'point' }) });
        act(() => byTestId('chart-mode-json')!.click());
        const editor = byTestId('chart-json-editor')!.querySelector('.cm-editor') as HTMLElement;
        const view = EditorView.findFromDOM(editor)!;
        expect(JSON.parse(view.state.doc.toString())).toEqual({ mark: 'point' });

        act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '{"mark": "area"' } }));
        expect(onChange).not.toHaveBeenCalled();
        expect(byTestId('chart-json-error')).not.toBeNull();

        act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '{"mark": "area"}' } }));
        expect(onChange).toHaveBeenLastCalledWith('{"mark":"area"}');
        expect(byTestId('chart-json-error')).toBeNull();

        // The builder shows the edit of the JSON
        act(() => byTestId('chart-mode-builder')!.click());
        expect(byTestId('chart-mark-area')?.getAttribute('aria-pressed')).toBe('true');
    });

    it('focuses the dialog instead of its first button', () => {
        render({ onChange: vi.fn() });
        expect(document.activeElement).toBe(byTestId('chart-builder-overlay'));
    });

    it('edits the selected layer of a layered chart', () => {
        const onChange = vi.fn();
        render({ onChange, visualizeQuery: vegaLite({ title: 't', layer: [{ mark: 'bar' }, { mark: 'rule', encoding: { y: { field: 'v', type: 'quantitative' } } }] }) });
        expect(byTestId('chart-builder-unsupported')).toBeNull();
        expect(byTestId('chart-layer-0')?.getAttribute('aria-pressed')).toBe('true');
        expect(byTestId('chart-mark-bar')?.getAttribute('aria-pressed')).toBe('true');

        // The mark and the encoding show the selected layer
        act(() => byTestId('chart-layer-1')!.click());
        expect(byTestId('chart-mark-rule')?.getAttribute('aria-pressed')).toBe('true');
        expect(byTestId('chart-channel-y-field')?.textContent).toContain('v');
        act(() => byTestId('chart-mark-line')!.click());
        expect(JSON.parse(onChange.mock.lastCall![0])).toEqual({
            title: 't',
            layer: [{ mark: 'bar' }, { mark: 'line', encoding: { y: { field: 'v', type: 'quantitative' } } }],
        });
        expect(byTestId('chart-layer-1')?.textContent).toContain('line');
    });

    it('opens the collapsed view settings of the chart', () => {
        const onChange = vi.fn();
        render({ onChange, visualizeQuery: vegaLite({ mark: 'bar', title: 'Revenue' }) });
        const toggle = byTestId('chart-view-toggle')!;
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(byTestId('chart-title')).toBeNull();
        // Collapsed, the heading shows the title
        expect(toggle.textContent).toContain('Revenue');

        act(() => toggle.click());
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect((byTestId('chart-title') as HTMLInputElement).value).toBe('Revenue');
    });

    it('adds and removes layers', () => {
        const onChange = vi.fn();
        render({ onChange, visualizeQuery: vegaLite({ mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' } } }) });
        expect(byTestId('chart-layer-remove')).toBeNull();

        // A new layer shares x and is selected
        act(() => byTestId('chart-layer-add')!.click());
        expect(JSON.parse(onChange.mock.lastCall![0])).toEqual({
            layer: [
                { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' } } },
                { mark: 'line', encoding: { x: { field: 'region', type: 'nominal' } } },
            ],
        });
        expect(byTestId('chart-layer-1')?.getAttribute('aria-pressed')).toBe('true');
        expect(byTestId('chart-mark-line')?.getAttribute('aria-pressed')).toBe('true');

        // Removing the layer restores the single view
        act(() => byTestId('chart-layer-remove')!.click());
        expect(JSON.parse(onChange.mock.lastCall![0])).toEqual({ mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' } } });
        expect(byTestId('chart-layer-1')).toBeNull();
        expect(byTestId('chart-mark-bar')?.getAttribute('aria-pressed')).toBe('true');
    });

    it('sends composed views to the JSON', () => {
        render({ onChange: vi.fn(), visualizeQuery: vegaLite({ hconcat: [{ mark: 'bar' }, { mark: 'rule' }] }) });
        expect(byTestId('chart-builder-unsupported')).not.toBeNull();
        act(() => (byTestId('chart-builder-unsupported')!.querySelector('button') as HTMLButtonElement).click());
        expect(byTestId('chart-json-editor')).not.toBeNull();
    });
});
