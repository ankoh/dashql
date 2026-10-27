import type { TopLevelSpec } from 'vega-lite';

import { loadVega, type VegaModules } from './vegalite_loader.js';
import { createVegaLiteConfig, resolveChartColors } from './vegalite_theme.js';

/// The size of a chart image in CSS pixels, the image has `scale` times as many pixels
export const CHART_IMAGE_WIDTH = 800;
export const CHART_IMAGE_HEIGHT = 500;
export const CHART_IMAGE_SCALE = 2;

/// The background of chart images, the colors of the app charts are made for a light background
const CHART_IMAGE_BACKGROUND = '#ffffff';
/// The margin of chart images in CSS pixels, the charts of the app have none and touch the edges of the image
const CHART_IMAGE_PADDING = 16;

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
    const sizedSpec = {
        ...spec,
        data: { values: rows },
        width: options.width ?? CHART_IMAGE_WIDTH,
        height: options.height ?? CHART_IMAGE_HEIGHT,
        autosize: { type: 'fit', contains: 'padding' },
    } as TopLevelSpec;
    const config = { ...createVegaLiteConfig(resolveChartColors()), background: CHART_IMAGE_BACKGROUND, padding: CHART_IMAGE_PADDING };
    const compiled = vegaLite.compile(sizedSpec, { config }).spec;
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
