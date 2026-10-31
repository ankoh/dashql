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

    function render(props: Partial<React.ComponentProps<typeof ChartBuilderOverlay>>) {
        act(() => root.render(
            <LoggerProvider>
                <ChartBuilderOverlay
                    scriptName="sales"
                    visualizeQuery={null}
                    queryState={null}
                    onApply={vi.fn()}
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

    const applied = (onApply: ReturnType<typeof vi.fn>) => JSON.parse(onApply.mock.lastCall![0] as string);

    it('applies the builder edits to the script', () => {
        const onApply = vi.fn();
        const onClose = vi.fn();
        render({ onApply, onClose, visualizeQuery: vegaLite({ mark: 'bar', encoding: { x: { field: 'region', type: 'nominal', axis: { labelAngle: 0 } } } }) });
        expect(byTestId('chart-builder')).not.toBeNull();
        expect(byTestId('chart-preview')?.textContent).toContain('Run the query');
        // The spec of the script is nothing to apply
        expect((byTestId('chart-builder-apply') as HTMLButtonElement).disabled).toBe(true);

        act(() => byTestId('chart-mark-line')!.click());
        expect(byTestId('chart-mark-line')?.getAttribute('aria-pressed')).toBe('true');
        pick('chart-channel-y-field', '\u001fcount');
        act(() => byTestId('chart-channel-x-remove')!.click());
        // The edits wait for the user to apply them
        expect(onApply).not.toHaveBeenCalled();

        act(() => byTestId('chart-builder-apply')!.click());
        expect(onApply).toHaveBeenCalledTimes(1);
        expect(applied(onApply)).toEqual({
            mark: 'line',
            encoding: { x: { axis: { labelAngle: 0 } }, y: { aggregate: 'count', type: 'quantitative' } },
        });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('drops the edits on cancel', () => {
        const onApply = vi.fn();
        const onClose = vi.fn();
        render({ onApply, onClose, visualizeQuery: vegaLite({ mark: 'bar' }) });
        act(() => byTestId('chart-mark-line')!.click());
        expect((byTestId('chart-builder-apply') as HTMLButtonElement).disabled).toBe(false);
        act(() => byTestId('chart-builder-cancel')!.click());
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onApply).not.toHaveBeenCalled();
    });

    it('applies the default spec to a script without a chart', () => {
        const onApply = vi.fn();
        render({ onApply });
        act(() => byTestId('chart-builder-apply')!.click());
        expect(applied(onApply)).toEqual({ mark: 'bar' });
    });

    it('lists the columns of the result in the field dropdown', () => {
        const onApply = vi.fn();
        const resultTable = arrow.tableFromArrays({ region: ['a', 'b'], revenue: Float64Array.from([1, 2]) });
        const queryState = { queryId: 1, status: QueryExecutionStatus.SUCCEEDED, resultTable } as unknown as QueryExecutionState;
        render({ onApply, queryState });
        expect(Array.from(document.querySelectorAll('[data-testid="chart-column"]')).map(c => c.textContent)).toEqual(['Nregion', 'Qrevenue']);
        pick('chart-channel-y-field', 'revenue');
        // The preview shows the edited spec before it is applied
        expect(JSON.parse(byTestId('chart-preview-spec')!.textContent!)).toMatchObject({ mark: 'bar', encoding: { y: { field: 'revenue' } } });
        act(() => byTestId('chart-builder-apply')!.click());
        expect(applied(onApply).encoding.y).toEqual({ field: 'revenue', type: 'quantitative' });
    });

    it('shows the spec as JSON and applies valid edits', () => {
        const onApply = vi.fn();
        render({ onApply, visualizeQuery: vegaLite({ mark: 'point' }) });
        act(() => byTestId('chart-mode-json')!.click());
        const editor = byTestId('chart-json-editor')!.querySelector('.cm-editor') as HTMLElement;
        const view = EditorView.findFromDOM(editor)!;
        expect(JSON.parse(view.state.doc.toString())).toEqual({ mark: 'point' });

        const apply = byTestId('chart-builder-apply') as HTMLButtonElement;
        act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '{"mark": "area"}' } }));
        expect(apply.disabled).toBe(false);
        // An invalid text cannot be applied, the last valid spec is not what the user sees
        act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '{"mark": "area"' } }));
        expect(byTestId('chart-json-error')).not.toBeNull();
        expect(apply.disabled).toBe(true);

        act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '{"mark": "area"}' } }));
        expect(byTestId('chart-json-error')).toBeNull();
        expect(apply.disabled).toBe(false);

        // The builder shows the edit of the JSON
        act(() => byTestId('chart-mode-builder')!.click());
        expect(byTestId('chart-mark-area')?.getAttribute('aria-pressed')).toBe('true');
        act(() => apply.click());
        expect(onApply).toHaveBeenCalledTimes(1);
        expect(onApply).toHaveBeenLastCalledWith('{"mark":"area"}');
    });

    it('sends composed views to the JSON', () => {
        render({ visualizeQuery: vegaLite({ layer: [{ mark: 'bar' }, { mark: 'rule' }] }) });
        expect(byTestId('chart-builder-unsupported')).not.toBeNull();
        act(() => (byTestId('chart-builder-unsupported')!.querySelector('button') as HTMLButtonElement).click());
        expect(byTestId('chart-json-editor')).not.toBeNull();
    });
});
