import * as React from 'react';
import type { TopLevelSpec } from 'vega-lite';
import type { View } from 'vega';

import { observeSize } from '../foundations/size_observer.js';
import { loadVega, type VegaModules } from './vegalite_loader.js';
import { createEmbedOptions, resolveChartColors, type ChartColors } from './vegalite_theme.js';
import * as styles from './vegalite_chart.module.css';

/// The items of the named datasets of a spec, by dataset name
export type VegaDatasets = Readonly<Record<string, readonly object[]>>;
/// The values of the top-level params of a spec, by param name
export type VegaSignals = Readonly<Record<string, unknown>>;

interface Props {
    /// The spec, or a function of the chart colors of the app that returns it.
    /// Its data are named datasets, e.g. `data: { name: 'rows' }`, filled from `datasets`.
    /// A new spec object embeds the chart again, keep its identity while it is unchanged.
    spec: TopLevelSpec | ((colors: ChartColors) => TopLevelSpec);
    /// The items of the named datasets. Items keep their identity across updates: an update only inserts the new
    /// items and removes the dropped ones, so that a live chart costs little per update.
    datasets: VegaDatasets;
    /// The values of top-level params of the spec, e.g. the bounds of a sliding time window
    signals?: VegaSignals;
    /// The class of the chart element, it sizes the chart
    className?: string;
    /// Receives the view once it is embedded, and null when it is finalized
    onView?: (view: View | null) => void;
    /// Load the Vega modules, for tests
    loader?: () => Promise<VegaModules>;
    /// The test id of the chart element
    'data-testid'?: string;
}

/// The state of a dataset in the view
interface AppliedDataset {
    /// The items in the view
    items: readonly object[];
    /// The rows of the items, Vega tags the rows it ingests, so every view gets its own copies
    rows: WeakMap<object, object>;
}

/// Apply the datasets and signals that changed since the last update to a view
function applyUpdates(
    vega: VegaModules['vega'],
    view: View,
    applied: Map<string, AppliedDataset>,
    appliedSignals: Map<string, unknown>,
    datasets: VegaDatasets,
    signals: VegaSignals,
): boolean {
    let changed = false;
    for (const [name, items] of Object.entries(datasets)) {
        let state = applied.get(name);
        if (state?.items === items) continue;
        state ??= { items: [], rows: new WeakMap() };
        const previous = new Set(state.items);
        const next = new Set(items);
        const rowOf = (item: object) => {
            let row = state!.rows.get(item);
            if (row == null) {
                row = { ...item };
                state!.rows.set(item, row);
            }
            return row;
        };
        const removed = state.items.filter(item => !next.has(item)).map(rowOf);
        const inserted = items.filter(item => !previous.has(item)).map(rowOf);
        view.change(name, vega.changeset().remove(removed).insert(inserted));
        applied.set(name, { items, rows: state.rows });
        changed = true;
    }
    for (const [name, value] of Object.entries(signals)) {
        if (appliedSignals.has(name) && Object.is(appliedSignals.get(name), value)) continue;
        view.signal(name, value);
        appliedSignals.set(name, value);
        changed = true;
    }
    return changed;
}

const NO_SIGNALS: VegaSignals = {};

/// A Vega-Lite chart with the theme of the app that is embedded once and then updated in place.
/// It fills its element, which the class sizes.
export function VegaLiteChart(props: Props): React.ReactElement {
    const container = React.useRef<HTMLDivElement | null>(null);
    const size = observeSize(container);
    const [error, setError] = React.useState<string | null>(null);
    const [ready, setReady] = React.useState(false);
    const viewRef = React.useRef<{ view: View; vega: VegaModules['vega'] } | null>(null);
    const applied = React.useRef(new Map<string, AppliedDataset>());
    const appliedSignals = React.useRef(new Map<string, unknown>());
    const signals = props.signals ?? NO_SIGNALS;
    const latest = React.useRef({ datasets: props.datasets, signals });
    latest.current = { datasets: props.datasets, signals };
    const onView = React.useRef(props.onView);
    onView.current = props.onView;
    const loader = props.loader ?? loadVega;
    // The sizes of the datasets as data-dataset-<name> attributes
    const datasetSizes = Object.fromEntries(
        Object.entries(props.datasets).map(([name, items]) => [`data-dataset-${name}`, items.length]),
    );

    // Embed the spec, the datasets and signals follow as updates
    React.useEffect(() => {
        const element = container.current;
        if (element == null) return;
        let disposed = false;
        let view: View | null = null;
        setReady(false);
        loader().then(async ({ embed, vega, expressionInterpreter }) => {
            if (disposed) return;
            const colors = resolveChartColors();
            const runtimeSpec = {
                ...(typeof props.spec === 'function' ? props.spec(colors) : props.spec),
                width: 'container',
                height: 'container',
                autosize: { type: 'fit', contains: 'padding', resize: true },
            } as TopLevelSpec;
            const result = await embed(element, runtimeSpec, createEmbedOptions(colors, expressionInterpreter));
            if (disposed) {
                result.view.finalize();
                return;
            }
            view = result.view;
            applied.current = new Map();
            appliedSignals.current = new Map();
            applyUpdates(vega, view, applied.current, appliedSignals.current, latest.current.datasets, latest.current.signals);
            await view.runAsync();
            viewRef.current = { view, vega };
            onView.current?.(view);
            setError(null);
            setReady(true);
        }).catch((e: unknown) => {
            if (!disposed) setError(e instanceof Error ? e.message : String(e));
        });
        return () => {
            disposed = true;
            viewRef.current = null;
            if (view != null) {
                onView.current?.(null);
                view.finalize();
            }
            element.replaceChildren();
        };
    }, [props.spec, loader]);

    // Update the datasets and signals in place
    React.useEffect(() => {
        const current = viewRef.current;
        if (current == null || !ready) return;
        if (applyUpdates(current.vega, current.view, applied.current, appliedSignals.current, props.datasets, signals)) {
            current.view.runAsync().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
        }
    }, [ready, props.datasets, signals]);

    // Follow the size of the element, also when the window keeps its size
    React.useEffect(() => {
        viewRef.current?.view.resize().runAsync().catch(() => {});
    }, [size?.width, size?.height]);

    return (
        <div
            className={props.className}
            data-testid={props['data-testid']}
            data-state={error != null ? 'error' : ready ? 'ready' : 'loading'}
            {...datasetSizes}
        >
            {error != null && <div className={styles.error}>{error}</div>}
            <div ref={container} className={styles.chart} />
        </div>
    );
}
