import * as React from 'react';
import type { TopLevelSpec } from 'vega-lite';

import { ButtonSize, ButtonVariant, IconButton } from '../../../../ui/foundations/button.js';
import { useFocusTrap } from '../../../../ui/foundations/focus.js';
import { Overlay, OverlaySize } from '../../../../ui/foundations/overlay.js';
import { SegmentedControl, SegmentedControlSize } from '../../../../ui/foundations/segmented_control.js';
import { AlertIcon, BracesIcon, ScreenFullIcon, ScreenNormalIcon, ToolsIcon, XIcon } from '../../../../ui/foundations/symbol_icon.js';
import { checkVegaLiteSpec } from '../../../../ui/vegalite/vegalite_check.js';
import { QueryExecutionStatus, type QueryExecutionState } from '../../../../query/query_execution_state.js';
import { VegaLiteView } from '../../compute/ui/visualization/vegalite_view.js';
import type { ResolvedVisualizeQuery } from '../../scripts/script_types.js';
import { chartColumns } from './chart_columns.js';
import { ChartSpecBuilder } from './chart_spec_builder.js';
import { ChartSpecJsonEditor } from './chart_spec_json_editor.js';
import { encodedFields, type ChartSpec } from './chart_spec_paths.js';
import * as styles from './chart_builder.module.css';

const IGNORE_OUTSIDE_CLICK = () => {};
const VEGA_LITE_SCHEMA = 'https://vega.github.io/schema/vega-lite/v6.json';
/// The spec of a script without a chart
const NEW_CHART_SPEC: ChartSpec = { mark: 'bar' };
/// Checking the spec compiles it, wait until the user pauses
const CHECK_DELAY_MS = 200;

const enum ChartBuilderMode {
    Builder = 0,
    Json = 1,
}

/// The spec that the user authored, without the `$schema` and the `data` that the compiler adds
export function authoredChartSpec(visualizeQuery: ResolvedVisualizeQuery | null): ChartSpec {
    if (visualizeQuery?.renderer !== 'vegalite') return { ...NEW_CHART_SPEC };
    const spec: ChartSpec = { ...(visualizeQuery.vegaLiteSpec as unknown as ChartSpec) };
    delete spec.$schema;
    delete spec.data;
    return spec;
}

export interface ChartBuilderOverlayProps {
    /// The display name of the script
    scriptName: string;
    /// The chart of the script when the overlay opens
    visualizeQuery: ResolvedVisualizeQuery | null;
    /// The latest query of the script, the preview shows its result
    queryState: QueryExecutionState | null;
    /// Write the spec into the `@vis vegalite` tag of the script
    onChange: (spec: string) => void;
    onClose: () => void;
    dependencies?: ChartBuilderOverlayDependencies;
}

export interface ChartBuilderOverlayDependencies {
    VegaLiteView: typeof VegaLiteView;
}

const DEFAULT_DEPENDENCIES: ChartBuilderOverlayDependencies = { VegaLiteView };

/// Build the chart of a script: a builder or the JSON of the Vega-Lite spec on the left, the chart on the right.
/// Every edit updates the chart and the `@vis vegalite` tag of the script right away.
export function ChartBuilderOverlay(props: ChartBuilderOverlayProps): React.ReactElement {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const dialogRef = React.useRef<HTMLElement | null>(null);
    const [expanded, setExpanded] = React.useState(false);
    const [mode, setMode] = React.useState<ChartBuilderMode>(ChartBuilderMode.Builder);
    // The overlay owns the spec while it is open, the script follows it
    const [spec, setSpec] = React.useState<ChartSpec>(() => authoredChartSpec(props.visualizeQuery));
    const [problems, setProblems] = React.useState<string[]>([]);

    const onChangeRef = React.useRef(props.onChange);
    onChangeRef.current = props.onChange;
    const updateSpec = React.useCallback((next: ChartSpec) => {
        setSpec(next);
        onChangeRef.current(JSON.stringify(next));
    }, []);

    // Check the spec once the user pauses, the problems show in the header
    React.useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(() => {
            checkVegaLiteSpec(spec)
                .then(found => { if (!cancelled) setProblems(found); })
                .catch(() => {});
        }, CHECK_DELAY_MS);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [spec]);

    const query = props.queryState;
    const resultTable = query?.status === QueryExecutionStatus.SUCCEEDED ? query.resultTable : null;
    const columns = React.useMemo(() => chartColumns(resultTable?.schema ?? null, encodedFields(spec)), [resultTable, spec]);
    const previewSpec = React.useMemo(() => ({ $schema: VEGA_LITE_SCHEMA, ...spec }) as unknown as TopLevelSpec, [spec]);

    useFocusTrap({
        containerRef: dialogRef as React.RefObject<HTMLElement>,
        restoreFocusOnCleanUp: true,
    });

    return (
        <Overlay
            centered
            width={OverlaySize.XXL}
            height={OverlaySize.XL}
            maxHeight={OverlaySize.XL}
            preventFocusOnOpen
            onEscape={props.onClose}
            onClickOutside={IGNORE_OUTSIDE_CLICK}
            expanded={expanded}
        >
            <section
                ref={dialogRef}
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-label={`Visualize ${props.scriptName} as Chart`}
                data-expanded={expanded || undefined}
                data-testid="chart-builder-overlay"
            >
                <header className={styles.header}>
                    <h2 className={styles.title}>Visualize as Chart</h2>
                    <div className={styles.spacer} />
                    {problems.length > 0 && (
                        <div className={styles.diagnostic} role="status" title={problems.join('\n')} data-testid="chart-problems">
                            <AlertIcon size={16} aria-hidden="true" />
                            <span className={styles.diagnostic_text}>{problems[0]}</span>
                        </div>
                    )}
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label={expanded ? 'Restore size' : 'Expand'}
                        aria-pressed={expanded}
                        onClick={() => setExpanded(e => !e)}
                    >
                        {expanded ? <ScreenNormalIcon size={16} /> : <ScreenFullIcon size={16} />}
                    </IconButton>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label="Close chart builder"
                        data-testid="chart-builder-close"
                        onClick={props.onClose}
                    >
                        <XIcon size={16} />
                    </IconButton>
                </header>
                <div className={styles.body}>
                    <div className={styles.editor_pane}>
                        <div className={styles.mode_bar}>
                            <SegmentedControl
                                aria-label="Chart editor"
                                size={SegmentedControlSize.Small}
                                onChange={index => setMode(index as ChartBuilderMode)}
                            >
                                <SegmentedControl.IconButton
                                    icon={ToolsIcon}
                                    aria-label="Builder"
                                    selected={mode === ChartBuilderMode.Builder}
                                    data-testid="chart-mode-builder"
                                />
                                <SegmentedControl.IconButton
                                    icon={BracesIcon}
                                    aria-label="JSON"
                                    selected={mode === ChartBuilderMode.Json}
                                    data-testid="chart-mode-json"
                                />
                            </SegmentedControl>
                        </div>
                        <div className={styles.editor_content}>
                            {mode === ChartBuilderMode.Builder ? (
                                <ChartSpecBuilder
                                    spec={spec}
                                    columns={columns}
                                    onChange={updateSpec}
                                    onEditJson={() => setMode(ChartBuilderMode.Json)}
                                />
                            ) : (
                                <ChartSpecJsonEditor initialSpec={spec} onChange={updateSpec} />
                            )}
                        </div>
                    </div>
                    <div className={styles.preview_pane} data-testid="chart-preview">
                        {resultTable != null ? (
                            <dependencies.VegaLiteView query={query} vegaLiteSpec={previewSpec} />
                        ) : (
                            <p className={styles.preview_empty}>Run the query to preview the chart.</p>
                        )}
                    </div>
                </div>
            </section>
        </Overlay>
    );
}
