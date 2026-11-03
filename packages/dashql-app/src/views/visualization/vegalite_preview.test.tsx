import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { QueryExecutionStatus, type QueryExecutionState } from '../../query/query_execution_state.js';
import { VEGALITE_PREVIEW_INSET, VegaLitePreview } from './vegalite_preview.js';
import type { VegaLiteViewDependencies } from './vegalite_view.js';
import { tableFromArrays } from '../../tests/arrow_fixtures.js';

const vegaEmbed = vi.fn<typeof import('vega-embed').default>(() => new Promise<never>(() => { }));
const dependencies = {
    loadVega: async () => ({ embed: vegaEmbed, expressionInterpreter: {} as typeof import('vega-interpreter').expressionInterpreter }),
    useComputationRegistry: () => [{ tableComputations: {}, schedulerTasks: {}, nextSchedulerTaskId: 1 }],
} as VegaLiteViewDependencies;

describe('VegaLitePreview', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vegaEmbed.mockClear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('fits the chart into its box with smaller text and without legends', async () => {
        const query = {
            queryId: 1,
            status: QueryExecutionStatus.SUCCEEDED,
            resultTable: tableFromArrays({ region: ['EU'], amount: [1] }),
        } as QueryExecutionState;
        await act(async () => {
            root.render(
                <VegaLitePreview
                    query={query}
                    vegaLiteSpec={{
                        data: { values: [] },
                        mark: 'bar',
                        encoding: { x: { field: 'region' }, y: { field: 'amount' }, color: { field: 'region' } },
                    }}
                    width={262}
                    height={198}
                    dependencies={dependencies}
                />,
            );
            await Promise.resolve();
        });

        expect(vegaEmbed).toHaveBeenCalledTimes(1);
        const [, spec, options] = vegaEmbed.mock.calls[0] as unknown as [HTMLElement, any, any];
        expect([spec.width, spec.height]).toEqual([262 - 2 * VEGALITE_PREVIEW_INSET, 198 - 2 * VEGALITE_PREVIEW_INSET]);
        expect(JSON.stringify(spec)).toContain('"legend":null');
        expect(options.config.axis.labelFontSize).toBe(8);
        expect(options.config.axisX.labelAngle).toBe(0);
    });
});
