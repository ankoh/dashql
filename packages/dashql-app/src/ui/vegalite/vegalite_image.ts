import type { TopLevelSpec } from 'vega-lite';

import {
    CHART_IMAGE_HEIGHT,
    CHART_IMAGE_SCALE,
    CHART_IMAGE_WIDTH,
    chartImageConfig,
    chartImageSpec,
} from '@akohn/dashql/platform/workbook/chart_config';

import { loadVega, type VegaModules } from './vegalite_loader.js';
import { createVegaLiteConfig, resolveChartColors } from './vegalite_theme.js';

export { CHART_IMAGE_HEIGHT, CHART_IMAGE_SCALE, CHART_IMAGE_WIDTH };

/// The Vega log level that only logs errors (vega.Error)
const VEGA_LOG_LEVEL_ERROR = 1;

export interface ChartImageOptions {
    /// The width in CSS pixels
    width?: number;
    /// The height in CSS pixels
    height?: number;
    /// The pixels per CSS pixel
    scale?: number;
    /// Load the Vega modules, for tests
    loader?: () => Promise<VegaModules>;
}

/// A chart as PNG
export interface ChartImage {
    png: Uint8Array;
    /// The width in pixels
    width: number;
    /// The height in pixels
    height: number;
}

/// Render a Vega-Lite spec with the theme of the app as PNG, without a DOM element.
/// The rows are the data of the spec, like the query result of a `@vis vegalite` tag.
export async function renderVegaLitePng(spec: TopLevelSpec, rows: readonly object[], options: ChartImageOptions = {}): Promise<ChartImage> {
    const { vega, vegaLite, expressionInterpreter } = await (options.loader ?? loadVega)();
    const sizedSpec = chartImageSpec(spec, rows, options.width ?? CHART_IMAGE_WIDTH, options.height ?? CHART_IMAGE_HEIGHT);
    const compiled = vegaLite.compile(sizedSpec, { config: chartImageConfig(createVegaLiteConfig(resolveChartColors('light'))) }).spec;
    // The expression interpreter avoids the eval of Vega that CSP forbids, it needs the parsed ASTs
    const view = new vega.View(vega.parse(compiled, undefined, { ast: true }), {
        renderer: 'none',
        expr: expressionInterpreter,
        logLevel: VEGA_LOG_LEVEL_ERROR,
    });
    try {
        await view.runAsync();
        const canvas = await view.toCanvas(options.scale ?? CHART_IMAGE_SCALE);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
        if (blob == null) throw new Error('The chart cannot be encoded as PNG');
        return { png: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
    } finally {
        view.finalize();
    }
}
