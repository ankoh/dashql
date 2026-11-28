import type { Spec as VegaSpec } from 'vega';
import type { Config } from 'vega-lite';
import type { EmbedOptions } from 'vega-embed';

import { CHART_FALLBACK_FONT, createChartConfig, LIGHT_CHART_COLORS, type ChartColors } from '@akohn/dashql/platform/workbook/chart_config';

import type { ColorScheme } from '../theme/color_scheme.js';

import './vegalite_tooltip.css';

export type { ChartColors };

/// The categorical colors of series in the order they are assigned, as chart color tokens of the app.
/// The tokens default to the base colors in @akohn/dashql-react/styles/tokens.css, flavors override them.
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

/// The fallbacks of the color tokens, used when a token is not defined, e.g. outside of the app styles.
/// They are the light colors of the theme.
const TOKEN_FALLBACKS: Record<string, string> = {
    ...Object.fromEntries(CATEGORICAL_COLOR_TOKENS.map((token, i) => [token, LIGHT_CHART_COLORS.categorical[i]])),
    '--color_danger_fg': LIGHT_CHART_COLORS.critical,
    '--color_border_muted': LIGHT_CHART_COLORS.grid,
    '--color_neutral_fg': LIGHT_CHART_COLORS.label,
    '--color_fg_muted': LIGHT_CHART_COLORS.title,
    '--color_fg': LIGHT_CHART_COLORS.text,
    '--color_bg_card': LIGHT_CHART_COLORS.surface,
};

/// Resolve color tokens of the app to rgb values.
/// The tokens may reference other variables, calc() and light-dark(), which the canvas renderer of Vega cannot
/// resolve. They resolve in the color scheme of the document, or in the given one.
function resolveColorTokens(tokens: readonly string[], scheme?: ColorScheme): Map<string, string> {
    const resolved = new Map<string, string>();
    const rootStyle = getComputedStyle(document.documentElement);
    const probe = document.createElement('span');
    probe.style.display = 'none';
    if (scheme !== undefined) {
        probe.style.colorScheme = scheme;
    }
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

/// The chart colors of the current app styles, in the color scheme of the document or in the given one.
/// Charts drawn on a canvas resolve them again when the color scheme changes, see useColorScheme.
export function resolveChartColors(scheme?: ColorScheme): ChartColors {
    const tokens = [...CATEGORICAL_COLOR_TOKENS, ...Object.keys(TOKEN_FALLBACKS)];
    const colors = resolveColorTokens([...new Set(tokens)], scheme);
    return {
        categorical: CATEGORICAL_COLOR_TOKENS.map(token => colors.get(token)!),
        primary: colors.get('--chart_color_1')!,
        critical: colors.get('--color_danger_fg')!,
        grid: colors.get('--color_border_muted')!,
        label: colors.get('--color_neutral_fg')!,
        title: colors.get('--color_fg_muted')!,
        text: colors.get('--color_fg')!,
        surface: colors.get('--color_bg_card')!,
    };
}

/// The font of the app, a theme token that the app flavor may override
function resolveFont(): string {
    const family = getComputedStyle(document.documentElement).getPropertyValue('--font_family').trim();
    return family === '' ? CHART_FALLBACK_FONT : `${family}, ${CHART_FALLBACK_FONT}`;
}

/// The Vega-Lite config of all charts of the app: recessive axes and grids, thin marks, square bars.
export function createVegaLiteConfig(colors: ChartColors): Config {
    return createChartConfig(colors, resolveFont());
}

/// The Vega-Lite config of chart previews in small boxes, e.g. on the dataflow canvas: the config of all charts with
/// smaller text and marks, fewer ticks and horizontal labels on the x axis.
export function createVegaLitePreviewConfig(colors: ChartColors): Config {
    const base = createVegaLiteConfig(colors);
    return {
        ...base,
        line: { ...base.line, strokeWidth: 1.5 },
        point: { ...base.point, size: 24, strokeWidth: 1 },
        text: { ...base.text, fontSize: 9 },
        axis: {
            ...base.axis,
            labelFontSize: 8,
            labelPadding: 3,
            labelLimit: 64,
            tickCount: 4,
            titleFontSize: 9,
            titlePadding: 4,
        },
        axisX: { ...base.axisX, labelAngle: 0 },
        legend: { ...base.legend, labelFontSize: 8, titleFontSize: 9, symbolSize: 32 },
        header: { ...base.header, labelFontSize: 9, titleFontSize: 9 },
        title: { ...base.title, fontSize: 10, offset: 4 },
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
        patch: withoutWindowResize,
    };
}

/// The event of the window that Vega-Lite updates a size of `container` on, next to `container:resize`
const WINDOW_RESIZE = 'window:resize';

/// Drops `window:resize` from the updates of the signals of a compiled spec. Vega-Lite fits a size of `container` on it
/// for Vega before 6.4, and on `container:resize`, the resize observer of the container, which sees every change of the
/// size of the chart. Every step of a resize of the window ran every chart, also the hidden ones of a suspended render
/// schedule (`Deferred`), whose containers keep their size.
export function withoutWindowResize(spec: VegaSpec): VegaSpec {
    if (spec.signals == null) return spec;
    return {
        ...spec,
        signals: spec.signals.map(signal => {
            if (!('on' in signal) || signal.on == null) return signal;
            const on = signal.on.filter(update => update.events !== WINDOW_RESIZE);
            return on.length === signal.on.length ? signal : { ...signal, on };
        }),
    };
}

/// The Vega log level that only logs errors (vega.Error).
/// Charts are embedded with empty datasets and filled by updates, and windows can be empty,
/// on empty data the extent transforms warn "Infinite extent" for every scale.
const VEGA_LOG_LEVEL_ERROR = 1;
