import * as React from 'react';
import { act } from '../../testing/react_act.js';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { VEGALITE_PREVIEW_INSET, VegaLitePreview } from './vegalite_preview.js';
import { createVegaLitePreviewConfig, resolveChartColors } from '../../vegalite/vegalite_theme.js';
import type { VegaLiteViewDependencies } from '../vegalite_view.js';
import { tableFromArrays } from '@akohn/dashql/platform/testing/arrow_fixtures';
import { fakeResultModel } from '../../testing/fake_models.js';

const vegaEmbed = vi.fn<typeof import('vega-embed').default>(() => new Promise<never>(() => { }));
const dependencies = {
    loadVega: async () => ({ embed: vegaEmbed, expressionInterpreter: {} as typeof import('vega-interpreter').expressionInterpreter }),
    useNearViewport: () => true,
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
        const resultTable = tableFromArrays({ region: ['EU'], amount: [1] });
        await act(async () => {
            root.render(
                <VegaLitePreview
                    model={fakeResultModel(resultTable)}
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

        // The chart reads the rows of the result first
        await vi.waitFor(() => expect(vegaEmbed).toHaveBeenCalledTimes(1));
        // The parts of the spec and the options of vega-embed that the preview sets
        const [, spec, options] = vegaEmbed.mock.calls[0] as unknown as [
            HTMLElement,
            { width: number; height: number },
            { config: { axis: { labelFontSize: number }; axisX: { labelAngle: number } } },
        ];
        expect([spec.width, spec.height]).toEqual([262 - 2 * VEGALITE_PREVIEW_INSET, 198 - 2 * VEGALITE_PREVIEW_INSET]);
        expect(JSON.stringify(spec)).toContain('"legend":null');
        // The preview takes the config of the previews
        expect(options.config.axis.labelFontSize).toBe(createVegaLitePreviewConfig(resolveChartColors()).axis?.labelFontSize);
        expect(options.config.axisX.labelAngle).toBe(0);
    });
});
