import * as React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

import { QueryResultPanel } from '../../views/query_result/query_result_header.js';
import { VisualizationDispatch } from '../../views/visualization/visualization_dispatch.js';
import { useQueryState } from '../../connections/query_executor.js';
import type { ScriptData } from '../scripts/session_scripts.js';
import { scriptDisplayName, type ResolvedVisualizeQuery } from '../scripts/script_types.js';
import { ScriptEditor } from '../scripts/script_editor.js';
import { QueryExecutionStatus } from '../../query/query_execution_state.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { ButtonGroup } from '../../ui/foundations/button_group.js';
import { SegmentedControl, SegmentedControlSize } from '../../ui/foundations/segmented_control.js';
import { GraphIcon, PencilIcon, SymbolIcon, TableIcon } from '../../ui/foundations/symbol_icon.js';
import { dashboardCardHeight, type DashboardPlacement } from './dashboard_layout.js';
import { markdownTemplate, type DashboardRenderer } from './dashboard_source.js';
import * as styles from './dashboard.module.css';

const DragHandleIcon = SymbolIcon('drag_handle_16');
const MarkdownIcon = SymbolIcon('mark_text_16');

export interface DashboardCardDependencies {
    useQueryState: typeof useQueryState;
    QueryResultPanel: typeof QueryResultPanel;
    VisualizationDispatch: typeof VisualizationDispatch;
    ScriptEditor: typeof ScriptEditor;
}

const DEFAULT_DEPENDENCIES: DashboardCardDependencies = {
    useQueryState,
    QueryResultPanel,
    VisualizationDispatch,
    ScriptEditor,
};

interface Props {
    sessionId: string;
    script: ScriptData;
    placement: DashboardPlacement;
    columnStep: number;
    rowStep: number;
    onResize: (scriptId: number, width: number, height: number, commit: boolean) => void;
    onResizeCancel: () => void;
    shifted: boolean;
    /// Give a collapsed card a renderer, the chart opens the chart builder instead
    onVisualize: (scriptId: number, renderer: Exclude<DashboardRenderer, 'vegalite'>, body: string) => void;
    onOpenChart: (scriptId: number) => void;
    onOpenEditor: (scriptId: number) => void;
    dependencies?: DashboardCardDependencies;
}

/// Memoized, a resize of one card only renders the cards whose placement changed.
/// A script without a visualization is a collapsed card: a header of one row that offers the renderers and an editor.
export const DashboardCard = React.memo(function DashboardCard(props: Props): React.ReactElement {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const query = dependencies.useQueryState(props.sessionId, props.script.latestQueryId);
    const visualizeQuery: ResolvedVisualizeQuery | null = props.script.annotations.visualizeQuery;
    const collapsed = visualizeQuery == null;
    const displayName = scriptDisplayName(props.script.fileName);
    const [contentSelected, setContentSelected] = React.useState(false);
    const resizeStart = React.useRef<{ x: number; y: number; width: number; height: number; pointerId: number } | null>(null);
    const draggable = useDraggable({ id: props.script.scriptKey });
    const transform = draggable.transform == null ? undefined : CSS.Translate.toString(draggable.transform);

    const resizeFromPointer = React.useCallback((event: PointerEvent, commit: boolean) => {
        const start = resizeStart.current;
        if (start == null || event.pointerId !== start.pointerId) return;
        const width = start.width + Math.round((event.clientX - start.x) / Math.max(1, props.columnStep));
        // A collapsed card is one row high, it only changes its width
        const height = collapsed ? start.height : start.height + Math.round((event.clientY - start.y) / Math.max(1, props.rowStep));
        props.onResize(props.script.scriptKey, width, height, commit);
        if (commit) resizeStart.current = null;
    }, [props.columnStep, props.rowStep, props.onResize, props.script.scriptKey, collapsed]);

    const startResize = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        resizeStart.current = {
            x: event.clientX,
            y: event.clientY,
            width: props.placement.width,
            height: props.placement.height,
            pointerId: event.pointerId,
        };
        const move = (next: PointerEvent) => resizeFromPointer(next, false);
        const finish = (next: PointerEvent) => {
            resizeFromPointer(next, true);
            cleanup();
        };
        const cancel = () => {
            resizeStart.current = null;
            props.onResizeCancel();
            cleanup();
        };
        const cleanup = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('pointercancel', cancel);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', cancel);
    }, [props.placement.width, props.placement.height, props.onResizeCancel, resizeFromPointer]);

    const resizeWithKeyboard = React.useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
        let width = props.placement.width;
        let height = props.placement.height;
        if (event.key === 'ArrowLeft') width -= 1;
        else if (event.key === 'ArrowRight') width += 1;
        else if (event.key === 'ArrowUp' && !collapsed) height -= 1;
        else if (event.key === 'ArrowDown' && !collapsed) height += 1;
        else return;
        event.preventDefault();
        props.onResize(props.script.scriptKey, width, height, true);
    }, [props.placement, props.onResize, props.script.scriptKey, collapsed]);

    // The Markdown template starts with the columns of the latest result
    const resultColumns = query?.status === QueryExecutionStatus.SUCCEEDED
        ? query.resultTable?.schema.fields.map(field => field.name) ?? []
        : [];
    const template = markdownTemplate(resultColumns);
    const visualizable = props.script.annotations.lastStatementIsQuery === true;
    // The output shows the icon of its renderer, like the renderers of a collapsed card
    const OutputIcon = visualizeQuery?.renderer === 'table' ? TableIcon : visualizeQuery?.renderer === 'markdown' ? MarkdownIcon : GraphIcon;
    const notVisualizable = 'Only a query is visualized';

    return (
        <article
            ref={draggable.setNodeRef}
            className={`${styles.card} ${collapsed ? styles.card_collapsed : contentSelected ? styles.card_content : ''}`}
            data-dashboard-card={props.script.scriptKey}
            style={{
                gridColumn: `${props.placement.column + 1} / span ${props.placement.width}`,
                gridRow: `${props.placement.row + 1} / span ${props.placement.height}`,
                transform,
                zIndex: draggable.isDragging ? 2 : undefined,
                '--dashboard-card-rows': props.placement.height,
                '--dashboard-card-height': `${dashboardCardHeight(props.placement.height)}px`,
            } as React.CSSProperties}
        >
            <header className={styles.card_header}>
                <button
                    type="button"
                    className={styles.drag_handle}
                    aria-label={`Move ${displayName}`}
                    {...draggable.listeners}
                    {...draggable.attributes}
                >
                    <DragHandleIcon />
                </button>
                <h2 className={styles.card_title}>{displayName}</h2>
                {props.shifted && <span className={styles.shifted_badge} title="Moved to avoid overlapping another dashboard card">Shifted</span>}
                {collapsed ? (
                    <>
                        <ButtonGroup className={styles.card_renderers} aria-label={`Visualize or edit ${displayName}`}>
                            <IconButton
                                size={ButtonSize.Small}
                                variant={ButtonVariant.Default}
                                disabled={!visualizable}
                                aria-label="Table"
                                description={visualizable ? 'Show the result table' : notVisualizable}
                                data-testid="dashboard-card-table"
                                onClick={() => props.onVisualize(props.script.scriptKey, 'table', '')}
                            >
                                <TableIcon size={12} />
                            </IconButton>
                            <IconButton
                                size={ButtonSize.Small}
                                variant={ButtonVariant.Default}
                                disabled={!visualizable}
                                aria-label="Chart"
                                description={visualizable ? 'Build a chart' : notVisualizable}
                                data-testid="dashboard-card-chart"
                                onClick={() => props.onOpenChart(props.script.scriptKey)}
                            >
                                <GraphIcon size={12} />
                            </IconButton>
                            <IconButton
                                size={ButtonSize.Small}
                                variant={ButtonVariant.Default}
                                disabled={!visualizable || template == null}
                                aria-label="Markdown"
                                description={!visualizable ? notVisualizable : template == null ? 'Run the script first' : 'Render every row as Markdown'}
                                data-testid="dashboard-card-markdown"
                                onClick={() => template != null && props.onVisualize(props.script.scriptKey, 'markdown', template)}
                            >
                                <MarkdownIcon size={12} />
                            </IconButton>
                            <IconButton
                                size={ButtonSize.Small}
                                variant={ButtonVariant.Default}
                                aria-label={`Edit ${displayName}`}
                                description="Edit the script"
                                data-testid="dashboard-card-edit"
                                onClick={() => props.onOpenEditor(props.script.scriptKey)}
                            >
                                <PencilIcon size={12} />
                            </IconButton>
                        </ButtonGroup>
                    </>
                ) : (
                    <SegmentedControl
                        aria-label={`Card view for ${displayName}`}
                        className={styles.card_segments}
                        size={SegmentedControlSize.Tiny}
                        onChange={index => setContentSelected(index === 1)}
                    >
                        <SegmentedControl.IconButton
                            aria-label="Output"
                            icon={<OutputIcon size={12} />}
                            data-testid="dashboard-card-output-tab"
                            selected={!contentSelected}
                        />
                        <SegmentedControl.IconButton
                            aria-label="Edit"
                            icon={<PencilIcon size={12} />}
                            data-testid="dashboard-card-content-tab"
                            selected={contentSelected}
                        />
                    </SegmentedControl>
                )}
            </header>
            {!collapsed && <div className={styles.card_body}>
                {contentSelected ? (
                    <dependencies.ScriptEditor
                        sessionId={props.sessionId}
                        scriptKey={props.script.scriptKey}
                        className={styles.card_editor}
                    />
                ) : visualizeQuery.renderer === 'table' ? (
                    // A table shows the header of the result over it, a chart only the chart
                    <dependencies.QueryResultPanel query={query} cellBackground="white" headerTopBorder />
                ) : (
                    <dependencies.VisualizationDispatch
                        query={query}
                        visualizeQuery={visualizeQuery}
                        hideLegend={props.placement.width < 5}
                    />
                )}
            </div>}
            <button
                type="button"
                className={styles.resize_handle}
                aria-label={collapsed
                    ? `Resize ${displayName}. Current width ${props.placement.width} columns`
                    : `Resize ${displayName}. Current size ${props.placement.width} columns by ${props.placement.height} rows`}
                onPointerDown={startResize}
                onKeyDown={resizeWithKeyboard}
            >
                <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
                    <path d="M7 1V7H1Z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                </svg>
            </button>
        </article>
    );
});
