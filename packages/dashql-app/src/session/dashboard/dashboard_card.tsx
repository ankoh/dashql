import * as React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

import { QueryResultPanel } from '../../views/query_result/query_result_header.js';
import { VisualizationDispatch } from '../../views/visualization/visualization_dispatch.js';
import { useQueryState } from '../../connections/query_executor.js';
import type { ScriptData } from '../scripts/session_scripts.js';
import { scriptDisplayName, type ResolvedVisualizeQuery } from '../scripts/script_types.js';
import { ScriptEditor } from '../scripts/script_editor.js';
import { QueryExecutionStatus, queryIsDone } from '../../query/query_execution_state.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { ButtonGroup } from '../../ui/foundations/button_group.js';
import { SegmentedControl, SegmentedControlSize } from '../../ui/foundations/segmented_control.js';
import { CheckIcon, EyeClosedIcon, GraphIcon, PaperAirplaneIcon, PencilIcon, SquareFillIcon, SymbolIcon, SyncIcon, TableIcon, ToolsIcon, XIcon } from '../../ui/foundations/symbol_icon.js';
import * as ActionList from '../../ui/foundations/action_list.js';
import { AnchorAlignment, AnchorSide } from '../../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../../ui/foundations/anchored_overlay.js';
import { NameInput } from '../../ui/foundations/name_input.js';
import * as menuStyles from '../../app/action_menu.module.css';
import { dashboardCardHeight, type DashboardPlacement } from './dashboard_layout.js';
import { NEW_CHART_SPEC } from '../chart_builder/chart_spec_paths.js';
import { markdownTemplate, type DashboardRenderer } from './dashboard_source.js';
import * as styles from './dashboard.module.css';

const DragHandleIcon = SymbolIcon('drag_handle_16');
const MarkdownIcon = SymbolIcon('mark_text_16');
const MoreIcon = SymbolIcon('kebab_horizontal');
const RenameIcon = SymbolIcon('pencil_16');
const TrashIcon = SymbolIcon('trash_16');

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
    /// Give a card a renderer with a starter body
    onVisualize: (scriptId: number, renderer: DashboardRenderer, body: string) => void;
    /// Open the chart builder of a chart card
    onOpenChart: (scriptId: number) => void;
    /// Remove the renderer of a card, it collapses to its script
    onRemoveVisualization: (scriptId: number) => void;
    onOpenEditor: (scriptId: number) => void;
    /// Open the full result table of a table card
    onOpenTable: (scriptId: number) => void;
    /// Accept or reject the staged rewrite of the script
    onAcceptDiff: (scriptId: number) => void;
    onRejectDiff: (scriptId: number) => void;
    /// Can the script run? Its connection is online and no other run holds the session.
    runnable: boolean;
    /// Run the script, a refresh runs it and the scripts it references without cached results
    onRun: (scriptId: number, refresh: boolean) => void;
    /// Stop the running query of the script
    onStop: (scriptId: number) => void;
    /// Rename the script, the name is the new display name. The menu of the card offers it.
    onRename?: (scriptId: number, name: string) => void;
    /// Delete the script, the menu of the card offers it
    onDelete?: (scriptId: number) => void;
    dependencies?: DashboardCardDependencies;
}

/// Memoized, a resize of one card only renders the cards whose placement changed.
/// A script without a visualization is a collapsed card: a header of one row with the renderers and an editor.
export const DashboardCard = React.memo(function DashboardCard(props: Props): React.ReactElement {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const query = dependencies.useQueryState(props.sessionId, props.script.latestQueryId);
    const visualizeQuery: ResolvedVisualizeQuery | null = props.script.annotations.visualizeQuery;
    const collapsed = visualizeQuery == null;
    // A staged rewrite, e.g. of the renderer, shows on the card and waits to be accepted or rejected like in the feed
    const staged = props.script.pendingDiff != null;
    const displayName = scriptDisplayName(props.script.fileName);
    const resizeStart = React.useRef<{ x: number; y: number; width: number; height: number; pointerId: number } | null>(null);
    const draggable = useDraggable({ id: props.script.scriptKey });
    // Is the name being edited in the title of the card? Rename in the menu of the card starts it
    const [renaming, setRenaming] = React.useState(false);
    const renameInputRef = React.useRef<HTMLInputElement>(null);
    React.useEffect(() => {
        if (!renaming) return;
        // Focus after the frame, a closing menu returns the focus to its trigger first
        const frame = requestAnimationFrame(() => {
            renameInputRef.current?.focus();
            renameInputRef.current?.select();
        });
        return () => cancelAnimationFrame(frame);
    }, [renaming]);
    const onRename = props.onRename;
    const scriptKey = props.script.scriptKey;
    const commitRename = React.useCallback((name: string) => {
        setRenaming(false);
        if (name.trim() !== '' && name.trim() !== displayName) onRename?.(scriptKey, name.trim());
    }, [onRename, scriptKey, displayName]);
    const cancelRename = React.useCallback(() => setRenaming(false), []);
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
    // A visualized card shows a query, the tag can be on a statement before the last one
    const visualizable = visualizeQuery != null || props.script.annotations.lastStatementIsQuery === true;
    const notVisualizable = 'Only a query is visualized';
    // One button runs the card: a card without a result runs and may read cached results, a card with a result
    // refreshes without them, a running card stops
    const running = query != null && !queryIsDone(query.status);
    const hasResult = query?.status === QueryExecutionStatus.SUCCEEDED && query.cacheDeleted !== true;
    const runAction = running
        ? { label: `Stop ${displayName}`, description: 'Stop the query', icon: <SquareFillIcon size={10} />, onClick: () => props.onStop(props.script.scriptKey) }
        : hasResult
            ? { label: `Refresh ${displayName}`, description: 'Refresh, skips cached results', icon: <SyncIcon size={12} />, onClick: () => props.onRun(props.script.scriptKey, true) }
            : { label: `Run ${displayName}`, description: 'Run, may use cached results', icon: <PaperAirplaneIcon size={12} />, onClick: () => props.onRun(props.script.scriptKey, false) };
    const markdownDescription = template == null ? 'Run the script first' : 'Render every row as Markdown';

    // The renderers of a card in the order of its segments, the last one collapses the card to its script. A chart
    // starts as a bar chart, the board opens its chart builder.
    const renderers: (DashboardRenderer | null)[] = ['table', 'vegalite', 'markdown', null];
    const currentRenderer = visualizeQuery?.renderer ?? null;
    const switchRenderer = (index: number) => {
        const renderer = renderers[index];
        if (renderer === currentRenderer) return;
        if (renderer == null) props.onRemoveVisualization(props.script.scriptKey);
        else if (renderer === 'vegalite') props.onVisualize(props.script.scriptKey, 'vegalite', JSON.stringify(NEW_CHART_SPEC));
        else if (renderer === 'table') props.onVisualize(props.script.scriptKey, 'table', '');
        else if (template != null) props.onVisualize(props.script.scriptKey, 'markdown', template);
    };

    return (
        <article
            ref={draggable.setNodeRef}
            className={`${styles.card} ${collapsed ? styles.card_collapsed : ''}`}
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
                {renaming ? (
                    <NameInput
                        ref={renameInputRef}
                        className={styles.card_title_input}
                        name={displayName}
                        onCommit={commitRename}
                        onCancel={cancelRename}
                        ariaLabel="Script name"
                        placeholder="Name this script"
                    />
                ) : (
                    <h2 className={styles.card_title}>{displayName}</h2>
                )}
                {props.shifted && <span className={styles.shifted_badge} title="Moved to avoid overlapping another dashboard card">Shifted</span>}
                {staged ? (
                    <>
                        {/* The script editor shows the change, accept and reject decide it */}
                        <ButtonGroup className={styles.card_actions} aria-label={`Change ${displayName}`}>
                            <IconButton
                                size={ButtonSize.Small}
                                variant={ButtonVariant.Default}
                                aria-label={`Edit ${displayName}`}
                                description="Show the change in the script"
                                data-testid="dashboard-card-edit"
                                onClick={() => props.onOpenEditor(props.script.scriptKey)}
                            >
                                <PencilIcon size={12} />
                            </IconButton>
                        </ButtonGroup>
                        <ButtonGroup className={styles.card_actions} aria-label={`Accept or reject the change of ${displayName}`}>
                            <IconButton
                                size={ButtonSize.Small}
                                variant={ButtonVariant.Default}
                                aria-label="Accept change"
                                description="Keep the change of the script"
                                data-testid="dashboard-card-accept"
                                onClick={() => props.onAcceptDiff(props.script.scriptKey)}
                            >
                                <CheckIcon size={12} />
                            </IconButton>
                            <IconButton
                                size={ButtonSize.Small}
                                variant={ButtonVariant.Default}
                                aria-label="Reject change"
                                description="Restore the script"
                                data-testid="dashboard-card-reject"
                                onClick={() => props.onRejectDiff(props.script.scriptKey)}
                            >
                                <XIcon size={12} />
                            </IconButton>
                        </ButtonGroup>
                    </>
                ) : (
                    <>
                        {/* The immediate actions, the editors open in an overlay of the board since a small card has no room
                            for them. The renderers follow at the right edge. */}
                        <ButtonGroup className={styles.card_actions} aria-label={`Actions of ${displayName}`}>
                            <IconButton
                                size={ButtonSize.Small}
                                variant={ButtonVariant.Default}
                                aria-label={runAction.label}
                                description={runAction.description}
                                data-testid="dashboard-card-run"
                                data-run-action={running ? 'stop' : hasResult ? 'refresh' : 'run'}
                                disabled={!running && !props.runnable}
                                onClick={runAction.onClick}
                            >
                                {runAction.icon}
                            </IconButton>
                            {currentRenderer === 'vegalite' && (
                                <IconButton
                                    size={ButtonSize.Small}
                                    variant={ButtonVariant.Default}
                                    aria-label="Chart builder"
                                    description="Build the chart"
                                    data-testid="dashboard-card-chart-builder"
                                    onClick={() => props.onOpenChart(props.script.scriptKey)}
                                >
                                    <ToolsIcon size={12} />
                                </IconButton>
                            )}
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
                            {(props.onRename != null || props.onDelete != null) && (
                                <DashboardCardMenu
                                    scriptName={displayName}
                                    onRename={props.onRename != null ? () => setRenaming(true) : undefined}
                                    onDelete={props.onDelete != null ? () => props.onDelete!(props.script.scriptKey) : undefined}
                                />
                            )}
                        </ButtonGroup>
                        <SegmentedControl
                            aria-label={`Renderer of ${displayName}`}
                            className={styles.card_segments}
                            size={SegmentedControlSize.Tiny}
                            onChange={switchRenderer}
                        >
                            <SegmentedControl.IconButton
                                aria-label="Table"
                                description={visualizable ? 'Show the result table' : notVisualizable}
                                icon={<TableIcon size={12} />}
                                data-testid="dashboard-card-renderer-table"
                                disabled={!visualizable && currentRenderer !== 'table'}
                                selected={currentRenderer === 'table'}
                            />
                            <SegmentedControl.IconButton
                                aria-label="Chart"
                                description={visualizable ? 'Build a chart' : notVisualizable}
                                icon={<GraphIcon size={12} />}
                                data-testid="dashboard-card-renderer-chart"
                                disabled={!visualizable && currentRenderer !== 'vegalite'}
                                selected={currentRenderer === 'vegalite'}
                            />
                            <SegmentedControl.IconButton
                                aria-label="Markdown"
                                description={visualizable ? markdownDescription : notVisualizable}
                                icon={<MarkdownIcon size={12} />}
                                data-testid="dashboard-card-renderer-markdown"
                                disabled={(!visualizable || template == null) && currentRenderer !== 'markdown'}
                                selected={currentRenderer === 'markdown'}
                            />
                            <SegmentedControl.IconButton
                                aria-label="Collapsed"
                                description="Show only the script, without a visualization"
                                icon={<EyeClosedIcon size={12} />}
                                data-testid="dashboard-card-renderer-collapsed"
                                selected={currentRenderer == null}
                            />
                        </SegmentedControl>
                    </>
                )}
            </header>
            {!collapsed && <div className={styles.card_body}>
                {visualizeQuery.renderer === 'table' ? (
                    // A table shows the header of the result over the rows that fit, a chart only the chart
                    <dependencies.QueryResultPanel query={query} cellBackground="white" onShowTable={() => props.onOpenTable(props.script.scriptKey)} />
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

/// The menu of a card with the actions that change the script itself
function DashboardCardMenu(props: { scriptName: string; onRename?: () => void; onDelete?: () => void }): React.ReactElement {
    const [open, setOpen] = React.useState(false);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const run = (action: () => void) => {
        setOpen(false);
        action();
    };
    return (
        <AnchoredOverlay
            open={open}
            onOpen={() => setOpen(true)}
            onClose={() => setOpen(false)}
            side={AnchorSide.OutsideBottom}
            align={AnchorAlignment.End}
            anchorOffset={4}
            anchorRef={triggerRef}
            returnFocusRef={triggerRef}
            renderAnchor={anchorProps => (
                <IconButton
                    {...anchorProps}
                    ref={triggerRef}
                    size={ButtonSize.Small}
                    variant={ButtonVariant.Default}
                    aria-label={`More actions for ${props.scriptName}`}
                    data-testid="dashboard-card-more"
                >
                    <MoreIcon size={12} />
                </IconButton>
            )}
        >
            <div className={menuStyles.menu} role="dialog" aria-label={`Actions for ${props.scriptName}`}>
                <ActionList.List aria-label={`Actions for ${props.scriptName}`}>
                    {/* The list takes elements only, the fragments wrap the optional items */}
                    <>{props.onRename != null && (
                        <ActionList.ListItem data-testid="dashboard-card-menu-item" data-action="rename" onClick={() => run(props.onRename!)}>
                            <ActionList.Leading><RenameIcon size={16} /></ActionList.Leading>
                            <ActionList.ItemText>Rename</ActionList.ItemText>
                        </ActionList.ListItem>
                    )}</>
                    <>{props.onDelete != null && (
                        <ActionList.ListItem
                            data-testid="dashboard-card-menu-item"
                            data-action="delete"
                            className={menuStyles.delete_action}
                            onClick={() => run(props.onDelete!)}
                        >
                            <ActionList.Leading><TrashIcon size={16} /></ActionList.Leading>
                            <ActionList.ItemText>Delete</ActionList.ItemText>
                        </ActionList.ListItem>
                    )}</>
                </ActionList.List>
            </div>
        </AnchoredOverlay>
    );
}
