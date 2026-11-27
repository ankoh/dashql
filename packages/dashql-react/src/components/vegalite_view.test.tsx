import * as React from 'react';
import { act, waitForRender } from '../testing/react_act.js';
import { createRoot, type Root } from 'react-dom/client';
import type { TopLevelSpec } from 'vega-lite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { useNearViewport, VegaLiteView, type VegaLiteViewDependencies } from './vegalite_view.js';
import { tableFromArrays } from '@akohn/dashql/platform/testing/arrow_fixtures';
import { fakeResultModel } from '../testing/fake_models.js';
import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';
import { LoggerContext } from '../logger.js';

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
    useNearViewport: () => true,
} as VegaLiteViewDependencies;

/// A query that succeeded with an analyzed result of one row
function succeededQuery() {
    return fakeResultModel(tableFromArrays({ value: [1] }));
}

/// Wait until the chart read the rows of its result: the placeholder of the read is gone
async function rowsRead(container: HTMLElement) {
    await waitForRender(() => expect(container.querySelector('[data-testid="card-placeholder"]')).toBeNull());
}

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

    it('reserves an explicit chart height while Vega loads', async () => {
        const model = succeededQuery();

        act(() => {
            root.render(
                <VegaLiteView
                    model={model}
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
        await rowsRead(container);

        const chart = container.firstElementChild?.lastElementChild as HTMLElement | null;
        expect(chart).not.toBeNull();
        expect(chart?.style.height).toBe('180px');
    });

    it('does not rebuild Vega for an equivalent analyzed spec', async () => {
        const model = succeededQuery();
        const render = (spec: TopLevelSpec) => root.render(
            <VegaLiteView model={model} vegaLiteSpec={spec} height={180} dependencies={dependencies} />,
        );

        await act(async () => {
            render({ data: { values: [] }, mark: 'point', encoding: { x: { field: 'value' } } });
            await Promise.resolve();
        });
        await rowsRead(container);
        await vi.waitFor(() => expect(vegaEmbed).toHaveBeenCalledTimes(1));
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
            const model = succeededQuery();

            await act(async () => {
                root.render(
                    <VegaLiteView
                        model={model}
                        vegaLiteSpec={{ data: { values: [] }, mark: 'point', encoding: { x: { field: 'value' } } }}
                        height={180}
                        dependencies={{ ...dependencies, useNearViewport }}
                    />,
                );
                await Promise.resolve();
            });
            await rowsRead(container);
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

    it('draws the first rows of a long result and says that it capped them', async () => {
        const model = fakeResultModel(tableFromArrays({ value: Int32Array.from({ length: 10_050 }, (_, i) => i) }));
        act(() => root.render(
            <VegaLiteView
                model={model}
                vegaLiteSpec={{ data: { values: [] }, mark: 'point', encoding: { x: { field: 'value' } } }}
                height={180}
                dependencies={dependencies}
            />,
        ));
        await rowsRead(container);
        expect(model.computation!.previewRows).toHaveBeenCalledWith(0, 10_000, true);
        expect(container.querySelector('[data-testid="capped-rows"]')?.textContent).toBe('Showing the first 10,000 of 10,050 rows');
    });

    it('says why the read of the rows failed', async () => {
        const model = succeededQuery();
        vi.mocked(model.computation!.previewRows).mockRejectedValueOnce(new Error('the result is not analyzed'));
        act(() => root.render(
            <LoggerContext.Provider value={new TestLogger()}>
                <VegaLiteView
                    model={model}
                    vegaLiteSpec={{ data: { values: [] }, mark: 'point', encoding: { x: { field: 'value' } } }}
                    dependencies={dependencies}
                />
            </LoggerContext.Provider>,
        ));
        await waitForRender(() => {
            expect(container.querySelector('[data-testid="card-placeholder"]')?.textContent).toBe('Failed to read the rows: the result is not analyzed');
        });
        expect(vegaEmbed).not.toHaveBeenCalled();
    });
});
