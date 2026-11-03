import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { QueryExecutionStatus, type QueryExecutionState } from '../../query/query_execution_state.js';
import { useNearViewport, VegaLiteView, type VegaLiteViewDependencies } from './vegalite_view.js';
import { tableFromArrays } from '../../tests/arrow_fixtures.js';

const vegaEmbed = vi.fn<typeof import('vega-embed').default>(() => new Promise<never>(() => { }));
const expressionInterpreter: typeof import('vega-interpreter').expressionInterpreter = {
    operator: vi.fn(),
    parameter: vi.fn(),
    event: vi.fn(),
    handler: vi.fn(),
    encode: vi.fn(),
};
const dependencies = {
    loadVega: async () => ({
        embed: vegaEmbed,
        expressionInterpreter,
    }),
    useComputationRegistry: () => [{ tableComputations: {}, schedulerTasks: {}, nextSchedulerTaskId: 1 }],
    useNearViewport: () => true,
} as VegaLiteViewDependencies;

describe('VegaLiteView', () => {
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

    it('reserves an explicit chart height while Vega loads', () => {
        const query = {
            queryId: 1,
            status: QueryExecutionStatus.SUCCEEDED,
            resultTable: tableFromArrays({ value: [1] }),
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
                    dependencies={dependencies}
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
            resultTable: tableFromArrays({ value: [1] }),
        } as QueryExecutionState;
        const render = (spec: object) => root.render(
            <VegaLiteView query={query} vegaLiteSpec={spec as any} height={180} dependencies={dependencies} />,
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

    it('embeds a chart only when it comes near the viewport', async () => {
        const query = {
            queryId: 1,
            status: QueryExecutionStatus.SUCCEEDED,
            resultTable: tableFromArrays({ value: [1] }),
        } as QueryExecutionState;
        // A scroll container whose chart lies far below its visible area
        const scroller = document.createElement('div');
        // Fixed at the top, the page of the test runner may show its report above the tests
        scroller.style.position = 'fixed';
        scroller.style.top = '0';
        scroller.style.width = '400px';
        scroller.style.height = '200px';
        scroller.style.overflowY = 'auto';
        const spacer = document.createElement('div');
        spacer.style.height = '5000px';
        container.style.height = '200px';
        scroller.append(spacer, container);
        document.body.appendChild(scroller);

        await act(async () => {
            root.render(
                <VegaLiteView
                    query={query}
                    vegaLiteSpec={{ data: { values: [] }, mark: 'point', encoding: { x: { field: 'value' } } }}
                    height={180}
                    dependencies={{ ...dependencies, useNearViewport }}
                />,
            );
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        expect(vegaEmbed).not.toHaveBeenCalled();

        await act(async () => {
            container.scrollIntoView();
            await Promise.resolve();
        });
        await vi.waitFor(() => expect(vegaEmbed).toHaveBeenCalledTimes(1));
        scroller.remove();
    });
});
