// The charts of the `@vis vegalite` tags of scripts: the theme that the app and `dashql vis` render them with, and the
// checks of a spec against the result of its query. Only the types of Vega-Lite, the callers load its compiler.
import type { Config, TopLevelSpec } from 'vega-lite';

import { stringifyError } from '../logger/logger.js';

/// The colors of the app that charts use, resolved to values that a renderer understands
export interface ChartColors {
    /// The colors of series in the order they are assigned
    categorical: string[];
    /// The color of a single series
    primary: string;
    /// The color of failures
    critical: string;
    /// The color of grid lines
    grid: string;
    /// The color of axis labels and legends
    label: string;
    /// The color of titles and reference lines
    title: string;
    /// The color of text in marks
    text: string;
    /// The color of the surface below the chart, the outline of points
    surface: string;
}

/// The light colors of the theme, the base colors of @akohn/dashql-react/styles/tokens.css. The app resolves the tokens
/// of its flavor and falls back to these, images of charts take them in both color schemes.
/// The order of the categorical colors is validated: adjacent colors stay apart for color-blind readers (CVD ΔE >= 16).
export const LIGHT_CHART_COLORS: ChartColors = {
    categorical: ['#0969da', '#e16f24', '#8250df', '#1a7f37', '#e85aad', '#bf8700', '#54aeff', '#953800'],
    primary: '#0969da',
    critical: '#cf222e',
    grid: '#eaeef2',
    label: '#6e7781',
    title: '#57606a',
    text: '#24292f',
    surface: '#ffffff',
};

/// The fallback fonts of charts behind the font of the app
export const CHART_FALLBACK_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/// The Vega-Lite config of all charts of the app: recessive axes and grids, thin marks, square bars
export function createChartConfig(colors: ChartColors, font: string): Config {
    return {
        background: 'transparent',
        font,
        padding: 0,
        view: { stroke: null },
        range: { category: colors.categorical },
        mark: { color: colors.primary },
        bar: { cornerRadius: 0, binSpacing: 1, continuousBandSize: 2 },
        line: { strokeWidth: 2, strokeCap: 'round', strokeJoin: 'round' },
        area: { line: false },
        point: { filled: true, size: 50, stroke: colors.surface, strokeWidth: 2, opacity: 1 },
        rule: { color: colors.title, strokeWidth: 1 },
        tick: { thickness: 2 },
        text: { color: colors.text, fontSize: 11 },
        axis: {
            domain: false,
            ticks: false,
            grid: true,
            gridColor: colors.grid,
            gridWidth: 1,
            labelColor: colors.label,
            labelFontSize: 10,
            labelPadding: 6,
            titleColor: colors.title,
            titleFontSize: 11,
            titleFontWeight: 500,
            titlePadding: 8,
        },
        axisX: { grid: false, labelFlush: true, labelOverlap: true },
        axisBand: { grid: false },
        legend: {
            labelColor: colors.label,
            labelFontSize: 11,
            titleColor: colors.title,
            titleFontSize: 11,
            titleFontWeight: 500,
            symbolSize: 64,
            symbolStrokeWidth: 0,
        },
        header: { labelColor: colors.title, titleColor: colors.title, labelFontSize: 11, titleFontSize: 11 },
        title: { color: colors.text, fontSize: 13, fontWeight: 600, anchor: 'start', offset: 8 },
    };
}

/// The size of a chart image in CSS pixels, the image has `scale` times as many pixels
export const CHART_IMAGE_WIDTH = 800;
export const CHART_IMAGE_HEIGHT = 500;
export const CHART_IMAGE_SCALE = 2;
/// The background of chart images, the images take the light colors of the theme in both color schemes
export const CHART_IMAGE_BACKGROUND = '#ffffff';
/// The margin of chart images in CSS pixels, the charts of the app have none and touch the edges of the image
export const CHART_IMAGE_PADDING = 16;

/// The spec of a chart image: the rows as its data, the size of the image, fitted with its padding
export function chartImageSpec(spec: TopLevelSpec, rows: readonly object[], width: number, height: number): TopLevelSpec {
    return {
        ...withViewEncodings(spec),
        data: { values: rows },
        width,
        height,
        autosize: { type: 'fit', contains: 'padding' },
    } as TopLevelSpec;
}

/// The config of chart images: the config of the charts with a white background and a margin
export function chartImageConfig(config: Config): Config {
    return { ...config, background: CHART_IMAGE_BACKGROUND, padding: CHART_IMAGE_PADDING };
}

/// The keys of a Vega-Lite spec that hold the views it composes
const VIEW_LIST_KEYS = ['layer', 'concat', 'hconcat', 'vconcat'];

function isObject(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

/// Give every view with a mark an encoding, an empty one if it has none.
///
/// This works around a bug of Vega-Lite (seen in 6.5.0): `getPointOverlay` decides whether line, area and trail
/// marks get a point overlay and reads `encoding.shape` without checking for an encoding. When neither the mark
/// nor the config sets `point`, compiling a view without an encoding throws
/// "Cannot read properties of undefined (reading 'shape')". Bars and the other marks never reach that code.
///
/// The chart builder creates such views: a new chart is `{ mark: 'bar' }` without fields, switching its mark gives
/// `{ mark: 'line' }`, and a new layer is `{ mark: 'line' }` too. Hand-written specs of scripts can be the same.
/// A view in a layer, a concat, a facet or a repeat fails alike, unless the parent has an encoding that the
/// layers inherit. The empty encoding is added only to the spec that is compiled, every place that compiles
/// Vega-Lite calls this, so the authored spec in the script keeps its keys.
///
/// Returns the spec itself when no view lacks an encoding.
export function withViewEncodings<T>(spec: T): T {
    if (!isObject(spec)) return spec;
    let out: Record<string, unknown> | null = null;
    const set = (key: string, value: unknown) => {
        out ??= { ...spec };
        out[key] = value;
    };
    if ('mark' in spec && !isObject(spec.encoding)) set('encoding', {});
    for (const key of VIEW_LIST_KEYS) {
        const views = spec[key];
        if (!Array.isArray(views)) continue;
        const next = views.map(withViewEncodings);
        if (next.some((view, i) => view !== views[i])) set(key, next);
    }
    // The view of a facet or a repeat
    if (isObject(spec.spec)) {
        const view = withViewEncodings(spec.spec);
        if (view !== spec.spec) set('spec', view);
    }
    return (out ?? spec) as T;
}

/// The keys of a spec that set the size of a chart, DashQL fits every chart to its card
const SIZE_KEYS = ['width', 'height', 'autosize', 'padding'];

/// The fields that the encodings of a spec read and the fields that its transforms make, in all of its views
function collectFields(spec: unknown, read: Set<string>, made: Set<string>): void {
    if (Array.isArray(spec)) {
        for (const item of spec) collectFields(item, read, made);
        return;
    }
    if (!isObject(spec)) return;
    if (Array.isArray(spec.transform)) {
        for (const transform of spec.transform) {
            if (!isObject(transform)) continue;
            // `as` names the outputs of calculate, bin, timeUnit, fold, window, joinaggregate, aggregate, ...
            const outputs = [transform.as, ...(['aggregate', 'window', 'joinaggregate'] as const).flatMap(key =>
                Array.isArray(transform[key]) ? (transform[key] as unknown[]).map(op => isObject(op) ? op.as : null) : [])];
            for (const output of outputs.flat()) if (typeof output === 'string') made.add(output);
        }
    }
    if (isObject(spec.encoding)) {
        for (const channel of Object.values(spec.encoding)) {
            for (const definition of Array.isArray(channel) ? channel : [channel]) {
                if (!isObject(definition)) continue;
                if (typeof definition.field === 'string') read.add(definition.field);
                // The conditions of a channel read fields too
                const condition = definition.condition;
                for (const branch of Array.isArray(condition) ? condition : [condition]) {
                    if (isObject(branch) && typeof branch.field === 'string') read.add(branch.field);
                }
            }
        }
    }
    for (const key of [...VIEW_LIST_KEYS, 'spec']) collectFields(spec[key], read, made);
}

/// The problems of a chart that compiles: fields that the result doesn't have and sizes that DashQL decides. The
/// columns are the columns of the result of its query, null without a result.
export function chartSpecProblems(spec: Record<string, unknown>, columns: readonly string[] | null): string[] {
    const problems: string[] = [];
    const sizes = SIZE_KEYS.filter(key => key in spec);
    if (sizes.length > 0) problems.push(`leave the size to DashQL, it fits every chart to its card: remove ${sizes.join(', ')}`);
    if (columns != null) {
        const read = new Set<string>();
        const made = new Set<string>();
        collectFields(spec, read, made);
        const known = new Set(columns);
        // A field of a nested value or with escapes starts with the name of its column
        const missing = [...read].filter(field => !made.has(field) && !known.has(field) && !known.has(field.split(/(?<!\\)[.[]/)[0].replace(/\\(.)/g, '$1')));
        for (const field of missing) problems.push(`the field ${JSON.stringify(field)} is no column of the result, its columns are ${columns.join(', ') || 'none'}`);
    }
    return problems;
}

/// The logger that Vega-Lite reports problems to
interface VegaLiteLogger {
    level(): VegaLiteLogger;
    error(...message: unknown[]): VegaLiteLogger;
    warn(...message: unknown[]): VegaLiteLogger;
    info(...message: unknown[]): VegaLiteLogger;
    debug(...message: unknown[]): VegaLiteLogger;
}

/// The compiler of Vega-Lite, the callers load it
export type VegaLiteCompile = (spec: TopLevelSpec, options: { logger: VegaLiteLogger }) => unknown;

/// The problems of a Vega-Lite spec: the errors and warnings of compiling it without data
export function compileProblems(compile: VegaLiteCompile, spec: Record<string, unknown>): string[] {
    const problems: string[] = [];
    const text = (message: unknown) => typeof message === 'string' ? message : stringifyError(message);
    const collect = (...message: unknown[]) => {
        problems.push(message.map(text).join(' '));
        return logger;
    };
    const logger: VegaLiteLogger = { level: () => logger, error: collect, warn: collect, info: () => logger, debug: () => logger };
    try {
        compile({ ...withViewEncodings(spec), data: { values: [] } } as TopLevelSpec, { logger });
    } catch (e: unknown) {
        problems.push(text(e));
    }
    return problems;
}
