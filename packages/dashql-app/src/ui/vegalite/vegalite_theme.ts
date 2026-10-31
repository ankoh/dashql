import type { Config } from 'vega-lite';
import type { EmbedOptions } from 'vega-embed';

import './vegalite_tooltip.css';

/// The categorical colors of series in the order they are assigned, as chart color tokens of the app.
/// The tokens default to the base colors in @ankoh/dashql-ui/styles/tokens.css, flavors override them.
/// The default order is validated: adjacent colors stay apart for color-blind readers (CVD ΔE >= 16).
export const CATEGORICAL_COLOR_TOKENS = [
    '--chart_color_1',
    '--chart_color_2',
    '--chart_color_3',
    '--chart_color_4',
    '--chart_color_5',
    '--chart_color_6',
    '--chart_color_7',
    '--chart_color_8',
] as const;

/// The fallbacks of the color tokens, used when a token is not defined, e.g. outside of the app styles
const TOKEN_FALLBACKS: Record<string, string> = {
    '--chart_color_primary': '#0969da',
    '--chart_color_1': '#0969da',
    '--chart_color_2': '#e16f24',
    '--chart_color_3': '#8250df',
    '--chart_color_4': '#1a7f37',
    '--chart_color_5': '#e85aad',
    '--chart_color_6': '#bf8700',
    '--chart_color_7': '#54aeff',
    '--chart_color_8': '#953800',
    '--base_color_red_5': '#cf222e',
    '--base_color_neutral_1': '#eaeef2',
    '--base_color_neutral_5': '#6e7781',
    '--base_color_neutral_6': '#57606a',
    '--base_color_neutral_9': '#24292f',
};

/// The colors of the app that charts use, resolved to values that the canvas understands.
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
}

/// Resolve color tokens of the app to rgb values.
/// The tokens may reference other variables and calc(), which the canvas renderer of Vega cannot resolve.
function resolveColorTokens(tokens: readonly string[]): Map<string, string> {
    const resolved = new Map<string, string>();
    const rootStyle = getComputedStyle(document.documentElement);
    const probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.appendChild(probe);
    try {
        for (const token of tokens) {
            if (rootStyle.getPropertyValue(token).trim() === '') {
                resolved.set(token, TOKEN_FALLBACKS[token]);
                continue;
            }
            probe.style.color = `var(${token})`;
            resolved.set(token, getComputedStyle(probe).color);
        }
    } finally {
        probe.remove();
    }
    return resolved;
}

/// The chart colors of the current app styles
export function resolveChartColors(): ChartColors {
    const tokens = [...CATEGORICAL_COLOR_TOKENS, ...Object.keys(TOKEN_FALLBACKS)];
    const colors = resolveColorTokens([...new Set(tokens)]);
    return {
        categorical: CATEGORICAL_COLOR_TOKENS.map(token => colors.get(token)!),
        primary: colors.get('--chart_color_primary')!,
        critical: colors.get('--base_color_red_5')!,
        grid: colors.get('--base_color_neutral_1')!,
        label: colors.get('--base_color_neutral_5')!,
        title: colors.get('--base_color_neutral_6')!,
        text: colors.get('--base_color_neutral_9')!,
    };
}

/// The fallback fonts of charts behind the font of the app
const FALLBACK_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/// The font of the app, a theme token that the app flavor may override
function resolveFont(): string {
    const family = getComputedStyle(document.documentElement).getPropertyValue('--font_family').trim();
    return family === '' ? FALLBACK_FONT : `${family}, ${FALLBACK_FONT}`;
}

/// The Vega-Lite config of all charts of the app: recessive axes and grids, thin marks, square bars.
export function createVegaLiteConfig(colors: ChartColors): Config {
    return {
        background: 'transparent',
        font: resolveFont(),
        padding: 0,
        view: { stroke: null },
        range: { category: colors.categorical },
        mark: { color: colors.primary },
        bar: { cornerRadius: 0, binSpacing: 1, continuousBandSize: 2 },
        line: { strokeWidth: 2, strokeCap: 'round', strokeJoin: 'round' },
        area: { line: false },
        point: { filled: true, size: 50, stroke: 'white', strokeWidth: 2, opacity: 1 },
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

/// The name of the theme of the Vega tooltips, styled by the class dashql-theme
export const VEGA_TOOLTIP_THEME = 'dashql';

/// The embed options of all charts of the app.
/// The canvas renderer draws many marks fast, the expression interpreter avoids the eval that CSP forbids.
export function createEmbedOptions(
    colors: ChartColors,
    expressionInterpreter: EmbedOptions['expr'],
): EmbedOptions {
    return {
        actions: false,
        renderer: 'canvas',
        ast: true,
        expr: expressionInterpreter,
        config: createVegaLiteConfig(colors),
        tooltip: { theme: VEGA_TOOLTIP_THEME },
        logLevel: VEGA_LOG_LEVEL_ERROR,
    };
}

/// The Vega log level that only logs errors (vega.Error).
/// Charts are embedded with empty datasets and filled by updates, and windows can be empty,
/// on empty data the extent transforms warn "Infinite extent" for every scale.
const VEGA_LOG_LEVEL_ERROR = 1;
