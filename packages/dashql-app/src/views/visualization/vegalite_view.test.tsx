import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { useNearViewport, VegaLiteView, type VegaLiteViewDependencies } from './vegalite_view.js';
import { tableFromArrays } from '@ankoh/dashql/platform/testing/arrow_fixtures';
import { succeededQuery, WithResultTables } from '../../tests/result_tables.js';

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
    useResultComputation: () => null,
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
        const query = succeededQuery(tableFromArrays({ value: [1] }));

        act(() => {
            root.render(
                <WithResultTables><VegaLiteView
                    query={query}
                    vegaLiteSpec={{
                        data: { values: [] },
                        mark: 'point',
                        encoding: { x: { field: 'value' } },
                    }}
                    height={180}
                    dependencies={dependencies}
                /></WithResultTables>,
            );
        });

        const chart = container.firstElementChild?.lastElementChild as HTMLElement | null;
        expect(chart).not.toBeNull();
        expect(chart?.style.height).toBe('180px');
    });

    it('does not rebuild Vega for an equivalent analyzed spec', async () => {
        const query = succeededQuery(tableFromArrays({ value: [1] }));
        const render = (spec: object) => root.render(
            <WithResultTables><VegaLiteView query={query} vegaLiteSpec={spec as any} height={180} dependencies={dependencies} /></WithResultTables>,
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
        // The tests run in a frame of the test dashboard that may lie outside the viewport of the page,
        // a stubbed observer reports the intersections instead of the layout of the dashboard.
        const observers: StubIntersectionObserver[] = [];
        class StubIntersectionObserver {
            readonly observed: Element[] = [];
            disconnected = false;
            constructor(
                readonly callback: IntersectionObserverCallback,
                readonly options?: IntersectionObserverInit,
            ) {
                observers.push(this);
            }
            observe(element: Element) {
                this.observed.push(element);
            }
            disconnect() {
                this.disconnected = true;
            }
            report(isIntersecting: boolean) {
                const entries = this.observed.map(target => ({ target, isIntersecting }) as IntersectionObserverEntry);
                this.callback(entries, this as unknown as IntersectionObserver);
            }
        }
        const intersectionObserver = globalThis.IntersectionObserver;
        globalThis.IntersectionObserver = StubIntersectionObserver as unknown as typeof IntersectionObserver;
        try {
            const query = succeededQuery(tableFromArrays({ value: [1] }));

            await act(async () => {
                root.render(
                    <WithResultTables><VegaLiteView
                        query={query}
                        vegaLiteSpec={{ data: { values: [] }, mark: 'point', encoding: { x: { field: 'value' } } }}
                        height={180}
                        dependencies={{ ...dependencies, useNearViewport }}
                    /></WithResultTables>,
                );
                await Promise.resolve();
            });
            expect(observers).toHaveLength(1);
            const observer = observers[0];
            expect(observer.observed).toHaveLength(1);
            expect(container.contains(observer.observed[0])).toBe(true);

            // Far from the viewport, the chart waits
            await act(async () => {
                observer.report(false);
                await Promise.resolve();
            });
            expect(vegaEmbed).not.toHaveBeenCalled();
            expect(observer.disconnected).toBe(false);

            // Near the viewport, the chart is embedded and the observer is done
            await act(async () => {
                observer.report(true);
                await Promise.resolve();
            });
            await vi.waitFor(() => expect(vegaEmbed).toHaveBeenCalledTimes(1));
            expect(observer.disconnected).toBe(true);
            expect(observers).toHaveLength(1);
        } finally {
            globalThis.IntersectionObserver = intersectionObserver;
        }
    });
});
