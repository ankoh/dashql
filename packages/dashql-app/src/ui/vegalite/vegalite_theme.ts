import type { Config } from 'vega-lite';
import type { EmbedOptions } from 'vega-embed';

import './vegalite_tooltip.css';

/// The categorical colors of series in the order they are assigned, as color tokens of the app.
/// The order is validated: adjacent colors stay apart for color-blind readers (CVD ΔE >= 16).
export const CATEGORICAL_COLOR_TOKENS = [
    '--base_color_blue_5',
    '--base_color_orange_4',
    '--base_color_purple_5',
    '--base_color_green_5',
    '--base_color_pink_4',
    '--base_color_yellow_4',
    '--base_color_blue_3',
    '--base_color_orange_6',
] as const;

/// The fallbacks of the color tokens, used when a token is not defined, e.g. outside of the app styles
const TOKEN_FALLBACKS: Record<string, string> = {
    '--base_color_blue_5': '#0969da',
    '--base_color_orange_4': '#e16f24',
    '--base_color_purple_5': '#8250df',
    '--base_color_green_5': '#1a7f37',
    '--base_color_pink_4': '#e85aad',
    '--base_color_yellow_4': '#bf8700',
    '--base_color_blue_3': '#54aeff',
    '--base_color_orange_6': '#953800',
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
        primary: colors.get('--base_color_blue_5')!,
        critical: colors.get('--base_color_red_5')!,
        grid: colors.get('--base_color_neutral_1')!,
        label: colors.get('--base_color_neutral_5')!,
        title: colors.get('--base_color_neutral_6')!,
        text: colors.get('--base_color_neutral_9')!,
    };
}

/// The font of the app
const FONT = 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/// The Vega-Lite config of all charts of the app: recessive axes and grids, thin marks, square bars.
export function createVegaLiteConfig(colors: ChartColors): Config {
    return {
        background: 'transparent',
        font: FONT,
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
    };
}
