import * as React from 'react';
import * as arrow from 'apache-arrow';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

vi.mock('../../../../../compute/computation_registry.js', () => ({
    useComputationRegistry: () => [{ tableComputations: {} }, vi.fn()],
}));
vi.mock('vega-embed', () => ({
    default: vi.fn(() => new Promise(() => { })),
}));
vi.mock('vega-interpreter', () => ({
    expressionInterpreter: vi.fn(),
}));

import { QueryExecutionStatus, type QueryExecutionState } from '../../../connections/query_execution_state.js';
import { VegaLiteView } from './vegalite_view.js';
import vegaEmbed from 'vega-embed';

describe('VegaLiteView', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.mocked(vegaEmbed).mockClear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('reserves an explicit chart height while Vega loads', () => {
        const query = {
            queryId: 1,
            status: QueryExecutionStatus.SUCCEEDED,
            resultTable: arrow.tableFromArrays({ value: [1] }),
        } as QueryExecutionState;

        act(() => {
            root.render(
                <VegaLiteView
                    query={query}
                    vegaLiteSpec={{
                        data: { values: [] },
                        mark: 'point',
                        encoding: { x: { field: 'value' } },
                    }}
                    height={180}
                />,
            );
        });

        const chart = container.firstElementChild?.lastElementChild as HTMLElement | null;
        expect(chart).not.toBeNull();
        expect(chart?.style.height).toBe('180px');
    });

    it('does not rebuild Vega for an equivalent analyzed spec', async () => {
        const query = {
            queryId: 1,
            status: QueryExecutionStatus.SUCCEEDED,
            resultTable: arrow.tableFromArrays({ value: [1] }),
        } as QueryExecutionState;
        const render = (spec: object) => root.render(
            <VegaLiteView query={query} vegaLiteSpec={spec as any} height={180} />,
        );

        await act(async () => {
            render({ data: { values: [] }, mark: 'point', encoding: { x: { field: 'value' } } });
            await Promise.resolve();
        });
        await act(async () => {
            render({ data: { values: [] }, mark: 'point', encoding: { x: { field: 'value' } } });
            await Promise.resolve();
        });

        expect(vegaEmbed).toHaveBeenCalledTimes(1);
    });
});
