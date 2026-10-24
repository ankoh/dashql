import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import type { View } from 'vega';
import type { TopLevelSpec } from 'vega-lite';
import { afterEach, beforeEach, vi } from 'vitest';

import { VegaLiteChart, type VegaDatasets } from './vegalite_chart.js';
import { createVegaLiteConfig, resolveChartColors } from './vegalite_theme.js';

const SPEC: TopLevelSpec = {
    params: [{ name: 'windowEnd', value: 0 }],
    data: { name: 'rows' },
    mark: 'bar',
    encoding: {
        x: { field: 't', type: 'quantitative', scale: { domainMax: { expr: 'windowEnd' } } },
        y: { field: 'v', type: 'quantitative' },
    },
};

describe('VegaLiteChart', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        container.style.width = '400px';
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    async function renderChart(datasets: VegaDatasets, signals: Record<string, unknown>, onView: (view: View | null) => void) {
        await act(async () => root.render(
            <VegaLiteChart spec={SPEC} datasets={datasets} signals={signals} onView={onView} className="chart" />,
        ));
    }

    it('embeds once and updates the datasets and signals in place', async () => {
        const views: (View | null)[] = [];
        const a = { t: 1, v: 1 };
        const b = { t: 2, v: 2 };
        const c = { t: 3, v: 3 };
        await renderChart({ rows: [a, b] }, { windowEnd: 10 }, view => views.push(view));
        await vi.waitFor(() => expect(container.querySelector('[data-state="ready"]')).not.toBeNull(), { timeout: 10_000 });
        const view = views[0]!;
        expect(view.data('rows').map((row: { t: number }) => row.t)).toEqual([1, 2]);
        expect(view.signal('windowEnd')).toBe(10);

        await renderChart({ rows: [b, c] }, { windowEnd: 20 }, view => views.push(view));
        await view.runAsync();
        expect(view.data('rows').map((row: { t: number }) => row.t).sort()).toEqual([2, 3]);
        expect(view.signal('windowEnd')).toBe(20);
        // The rows are copies, Vega tags the rows it ingests
        expect(Object.getOwnPropertySymbols(b)).toHaveLength(0);
        // The view stays embedded
        expect(views).toEqual([view]);
        expect(container.querySelector('[data-dataset-rows]')?.getAttribute('data-dataset-rows')).toBe('2');
    }, 20_000);

    it('builds the theme from the color tokens of the app', () => {
        const colors = resolveChartColors();
        expect(colors.categorical).toHaveLength(8);
        expect(new Set(colors.categorical).size).toBe(8);
        const config = createVegaLiteConfig(colors);
        expect(config.range?.category).toEqual(colors.categorical);
        expect(config.bar?.cornerRadius).toBe(0);
    });
});
