import * as React from 'react';
import { perfMarks } from '@akohn/dashql';
import type { Config, TopLevelSpec } from 'vega-lite';

import * as styles from './vegalite_view.module.css';
import { loadVega } from '../vegalite/vegalite_loader.js';
import { arrowTableToRows, CHART_ROWS } from '../vegalite/vegalite_rows.js';
import { type ChartColors, createEmbedOptions, createVegaLiteConfig, resolveChartColors } from '../vegalite/vegalite_theme.js';
import { withViewEncodings } from '@akohn/dashql/platform/workbook/chart_config';
import { useColorScheme } from '../theme/color_scheme.js';
import { useBrand } from '../brand/brand.js';
import { QueryExecutionStatus } from '@akohn/dashql/platform/query/query_execution_state';
import type { QueryModel } from '../models/query_model.js';
import { useComputationTables, type ComputationTables } from './data_table/computation_tables.js';
import { CardPlaceholder, QueryStatusPlaceholder } from './card_placeholder.js';
import { useResultRows } from './visualization/result_rows.js';
import { CappedRows } from './visualization/capped_rows.js';
import {
    filterTableToVegaCrossFilterRows,
    injectVegaStableScaleDomains,
    injectVegaLiteCrossFilter,
    VegaCrossFilterMask,
    VegaCrossFilterUpdater,
    VegaStableScaleDomain,
} from '../vegalite/vegalite_crossfilter.js';

type VegaEmbed = typeof import('vega-embed').default;
type VegaExpressionInterpreter = typeof import('vega-interpreter').expressionInterpreter;

export interface VegaLiteViewDependencies {
    loadVega(): Promise<{
        embed: VegaEmbed;
        expressionInterpreter: VegaExpressionInterpreter;
    }>;
    useNearViewport(ref: React.RefObject<HTMLElement | null>, mounted: boolean): boolean;
}

/// How far ahead of the viewport a chart is embedded, scrolling then rarely shows an empty chart
const VIEWPORT_MARGIN = '50% 0px';

/// Has the element come near the viewport? Latches once it did.
/// Embedding a chart costs the main thread a lot, the charts out of view wait.
/// The scroll margin also extends nested scroll containers like the feed list.
export function useNearViewport(ref: React.RefObject<HTMLElement | null>, mounted: boolean): boolean {
    const [near, setNear] = React.useState(() => typeof IntersectionObserver === 'undefined');
    React.useEffect(() => {
        const element = ref.current;
        if (near || !mounted || element == null) return;
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) {
                observer.disconnect();
                setNear(true);
            }
        }, { rootMargin: VIEWPORT_MARGIN, scrollMargin: VIEWPORT_MARGIN });
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref, near, mounted]);
    return near;
}

/// The computation of the result of a query: the column of the row numbers and its tables
export interface ResultComputation {
    rowNumberColumnName: string | null;
    tables: ComputationTables;
}

/// The computation of the result of a query with its tables, null without one
export function useResultComputation(model: QueryModel | null): ResultComputation | null {
    const computation = model?.computation?.computation ?? null;
    const tables = useComputationTables(computation, model?.computation?.tables ?? null);
    const rowNumberColumnName = computation?.rowNumberColumnName ?? null;
    const hasComputation = computation != null;
    return React.useMemo(
        () => hasComputation ? { rowNumberColumnName, tables } : null,
        [rowNumberColumnName, hasComputation, tables],
    );
}

const DEFAULT_DEPENDENCIES: VegaLiteViewDependencies = {
    loadVega,
    useNearViewport,
};

export interface VegaLiteViewProps {
    /// The query of the chart: the chart shows the first rows of its result, at most `CHART_ROWS`, and follows the cross
    /// filters of its computation
    model: QueryModel | null;
    vegaLiteSpec: TopLevelSpec | null;
    /// Optional exact width/height in px for the whole chart. The view is sized to `fit`, so the
    /// entire plot (marks, axes, legend) fits the available box. An unset dimension falls back to
    /// the container.
    width?: number;
    height?: number;
    /// Optional uniform scale factor (<1 shrinks). `fit` only rescales the plot *area*; label fonts,
    /// mark sizes and stroke widths keep their absolute px, so on a tiny box they look oversized.
    /// This renders the chart into a `1/scale` larger logical box and CSS-scales the result down, so
    /// *everything* — text, marks, axes — shrinks uniformly while still landing in the width×height
    /// box. Defaults to 1 (no scaling).
    scale?: number;
    /// Suppress all legends. Legends eat a lot of space in a cramped host (e.g. a grid card
    /// thumbnail), so the compact rendering strips them by injecting `legend: null` into every
    /// encoding channel. Defaults to false (legends shown as authored).
    hideLegend?: boolean;
    /// The Vega-Lite config of the chart, the config of all charts of the app by default
    config?: (colors: ChartColors) => Config;
    /// The class of the root, the root style of the visualizations by default
    className?: string;
    dependencies?: VegaLiteViewDependencies;
}

/// The encoding channels that can produce a legend in Vega-Lite. Setting `legend: null` on any of
/// these suppresses its legend.
const LEGEND_CHANNELS = ['color', 'fill', 'stroke', 'size', 'shape', 'opacity', 'strokeWidth', 'strokeDash', 'angle'];

/// Recursively strip legends from a Vega-Lite spec by setting `legend: null` on every legend-bearing
/// encoding channel. Walks nested specs (layer / hconcat / vconcat / concat / facet / spec) so
/// composed views are covered too. Returns a deep-ish copy with the mutations applied; the input is
/// left untouched.
function stripLegends<T>(spec: T): T {
    if (Array.isArray(spec)) {
        return spec.map(stripLegends) as unknown as T;
    }
    if (spec == null || typeof spec !== 'object') {
        return spec;
    }
    const out: Record<string, unknown> = { ...(spec as Record<string, unknown>) };
    if (out.encoding != null && typeof out.encoding === 'object') {
        const encoding: Record<string, unknown> = { ...(out.encoding as Record<string, unknown>) };
        for (const channel of LEGEND_CHANNELS) {
            const def = encoding[channel];
            if (def != null && typeof def === 'object' && !Array.isArray(def)) {
                encoding[channel] = { ...(def as Record<string, unknown>), legend: null };
            }
        }
        out.encoding = encoding;
    }
    for (const key of ['layer', 'hconcat', 'vconcat', 'concat', 'spec']) {
        if (out[key] != null && typeof out[key] === 'object') {
            out[key] = stripLegends(out[key]);
        }
    }
    return out as unknown as T;
}

/// Structural signatures of specs, computed once per spec object
const specSignatures = new WeakMap<object, string>();

function getSpecSignature(spec: object): string {
    let signature = specSignatures.get(spec);
    if (signature === undefined) {
        signature = JSON.stringify(spec);
        specSignatures.set(spec, signature);
    }
    return signature;
}

export function VegaLiteView(props: VegaLiteViewProps): React.ReactElement {
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const crossFilterUpdaterRef = React.useRef<VegaCrossFilterUpdater | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    // The canvas does not follow the color scheme or the flavor, the chart is embedded again with their new colors
    const colorScheme = useColorScheme();
    const flavorId = useBrand().id;

    const succeeded = props.model?.query.status === QueryExecutionStatus.SUCCEEDED;
    // Analysis emits a fresh spec object for editor transactions, including cursor-only updates.
    // Keep one spec object while the authored spec is structurally unchanged so Vega's
    // effect does not finalize and rebuild the canvas while the user types or moves the cursor.
    const specSignature = props.vegaLiteSpec == null ? null : getSpecSignature(props.vegaLiteSpec);
    const spec = React.useMemo(
        () => specSignature == null ? null : JSON.parse(specSignature) as TopLevelSpec,
        [specSignature],
    );

    // The chart reads the first rows of the result with their row numbers from the compute database, the cross filters
    // select rows by them. A result with more rows is capped, the chart says so.
    const tableComputation = useResultComputation(props.model);
    const chartRows = useResultRows(props.model, 'first', CHART_ROWS, true);
    const dataTable = chartRows.table;
    const cappedRows = dataTable != null && chartRows.rows > dataTable.numRows ? chartRows.rows : null;
    const rowNumberColumnName = tableComputation?.rowNumberColumnName ?? null;

    const filterTable = tableComputation?.tables.filterTable ?? null;
    // The chart container is rendered only for a spec with a result, see below
    const nearViewport = dependencies.useNearViewport(containerRef, spec != null && succeeded && dataTable != null);
    // The rows are converted for the embedded chart only
    const rows = React.useMemo<Record<string, unknown>[] | null>(() => {
        if (!succeeded || !dataTable || !nearViewport) return null;
        return perfMarks.measure('render:visRows', () => arrowTableToRows(dataTable), () => `${dataTable.numRows} rows`);
    }, [succeeded, dataTable, nearViewport]);
    const crossFilterBinding = React.useMemo(() => {
        if (spec == null || dataTable == null) {
            return null;
        }
        const baseSpec = props.hideLegend ? stripLegends(spec) : spec;
        return injectVegaLiteCrossFilter(
            baseSpec,
            rowNumberColumnName,
            dataTable.schema.fields.map(field => field.name),
        );
    }, [spec, rowNumberColumnName, dataTable, props.hideLegend]);
    const maskSelectedFieldName = crossFilterBinding?.maskSelectedFieldName ?? null;
    const crossFilterMask = React.useMemo<VegaCrossFilterMask>(() => ({
        active: filterTable != null,
        rows: filterTable != null && maskSelectedFieldName != null
            ? filterTableToVegaCrossFilterRows(filterTable, maskSelectedFieldName)
            : [],
    }), [filterTable, maskSelectedFieldName]);
    const crossFilterMaskRef = React.useRef(crossFilterMask);
    crossFilterMaskRef.current = crossFilterMask;

    React.useEffect(() => {
        crossFilterUpdaterRef.current?.update(crossFilterMask);
    }, [crossFilterMask]);

    // A uniform scale (<1) is applied via CSS transform on the chart container. To still land in the
    // requested width×height box, the chart is laid out into a `1/scale` larger logical box so that
    // scaling it back down recovers the exact size — but with fonts/marks/strokes visually smaller.
    const scale = props.scale != null && props.scale > 0 ? props.scale : 1;
    const width = props.width != null ? Math.round(props.width / scale) : null;
    const height = props.height != null ? Math.round(props.height / scale) : null;
    React.useEffect(() => {
        const el = containerRef.current;
        if (!el || !spec || !rows) return;

        let disposed = false;
        let finalizeView: (() => void) | null = null;
        let stableScaleDomains: VegaStableScaleDomain[] = [];
        const baseSpec = crossFilterBinding?.spec ?? (props.hideLegend ? stripLegends(spec) : spec);
        const runtimeSpec = { ...withViewEncodings(baseSpec) } as TopLevelSpec & {
            width?: unknown;
            height?: unknown;
            autosize?: unknown;
        };
        // Pin whichever exact dimensions were requested; otherwise fill the container.
        runtimeSpec.width = width != null ? width : 'container';
        runtimeSpec.height = height != null ? height : 'container';
        // Include axes, legends and titles in the available size instead of relying on fixed outer padding.
        // The layout is fitted again when the container changes and, by the cross-filter updater, when the data
        // changes, never on every run: a pointer move over the canvas runs the view, and the fit of a temporal axis
        // with flushed labels can alternate between two widths, the x labels then flickered on hover.
        runtimeSpec.autosize = { type: 'fit', contains: 'padding', resize: false };
        // The load of the libraries, the compilation of the spec and the first run of the view
        const embedStarted = perfMarks.start();
        const embedDetail = () => `${rows.length} rows`;
        // Lazy-load vega-embed and vega-interpreter to keep them out of the import graph for non-vis paths.
        dependencies.loadVega().then(({ embed, expressionInterpreter }) => {
            if (disposed) return;
            // The charts of the app share a theme and the embed options, e.g. the CSP-safe expression interpreter
            const colors = resolveChartColors();
            const options = createEmbedOptions(colors, expressionInterpreter);
            const config = (props.config ?? createVegaLiteConfig)(colors);
            return embed(el, runtimeSpec, {
                ...options,
                patch: compiledSpec => {
                    const stableScales = injectVegaStableScaleDomains(compiledSpec);
                    stableScaleDomains = stableScales.domains;
                    return stableScales.spec;
                },
                // `mark.tooltip: true` makes Vega-Lite derive a tooltip from each mark's encoded
                // fields; vega-embed installs the vega-tooltip handler by default, so hovering a
                // mark shows its data. Applied via config so it covers every mark without editing
                // the generated spec.
                config: { ...config, mark: { ...config.mark, tooltip: true } },
            });
        }).then(result => {
            if (!result) return;
            perfMarks.end('render:visEmbed', embedStarted, embedDetail);
            if (disposed) {
                result.view.finalize();
                return;
            }
            finalizeView = () => result.view.finalize();
            if (crossFilterBinding != null) {
                const updater = new VegaCrossFilterUpdater(
                    result.view,
                    crossFilterBinding.sourceDatasetName,
                    rows,
                    crossFilterBinding.maskDatasetName,
                    crossFilterBinding.maskActiveSignalName,
                    e => setError(e instanceof Error ? e.message : String(e)),
                    stableScaleDomains,
                );
                crossFilterUpdaterRef.current = updater;
                updater.update(crossFilterMaskRef.current);
            }
            setError(null);
        }).catch((e: unknown) => {
            setError(e instanceof Error ? e.message : String(e));
        });
        return () => {
            disposed = true;
            crossFilterUpdaterRef.current?.dispose();
            crossFilterUpdaterRef.current = null;
            finalizeView?.();
            if (el) el.replaceChildren();
        };
    }, [spec, rows, crossFilterBinding, width, height, scale, props.hideLegend, props.config, dependencies, colorScheme, flavorId]);

    if (!spec) {
        return <CardPlaceholder message="No visualization available" />;
    }
    if (!succeeded) {
        return <QueryStatusPlaceholder query={props.model?.query ?? null} />;
    }
    if (!dataTable && !chartRows.reading) {
        return <CardPlaceholder message="Result is empty" />;
    }
    // A remounted chart reads its rows again, its placeholder keeps the size of the chart. In the virtualized feed a
    // collapsed placeholder would publish a smaller height of its row until the rows arrive.
    if (!dataTable) {
        return (
            <div className={props.className ?? styles.root}>
                <div className={styles.chart} style={{ width: props.width, height: props.height }}>
                    <CardPlaceholder />
                </div>
            </div>
        );
    }

    // When scaling, the chart container is laid out at the enlarged logical size and shrunk with a
    // CSS transform anchored top-left, so the whole plot renders smaller within the requested box.
    // Reserve explicit dimensions before the async vega-embed import finishes. This is important in
    // the virtualized feed: a remounted chart otherwise collapses temporarily, causing its row's
    // ResizeObserver to publish a smaller height before the canvas restores the final height.
    const chartStyle: React.CSSProperties | undefined = width != null || height != null || scale !== 1
        ? {
            width: width ?? undefined,
            height: height ?? undefined,
            transform: scale !== 1 ? `scale(${scale})` : undefined,
            transformOrigin: scale !== 1 ? 'top left' : undefined,
        }
        : undefined;

    return (
        <div className={props.className ?? styles.root}>
            {error && <div className={styles.error}>{error}</div>}
            <div ref={containerRef} className={styles.chart} style={chartStyle} />
            {cappedRows != null && <CappedRows className={styles.capped} part="first" shown={dataTable.numRows} rows={cappedRows} />}
        </div>
    );
}
