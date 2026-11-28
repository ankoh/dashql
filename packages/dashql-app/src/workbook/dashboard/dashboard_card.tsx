import * as React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

import { QueryResultPanel } from '../../results/query_result_header.js';
import { VisualizationDispatch } from '../../results/visualization_dispatch.js';
import type { ScriptModel } from '@akohn/dashql-react/models/script_model';
import { scriptDisplayName, type ResolvedVisualizeQuery } from '@akohn/dashql/platform/workbook/script_types';
import { ScriptEditor } from '../scripts/script_editor.js';
import { QueryExecutionStatus, queryIsDone } from '@akohn/dashql/platform/query/query_execution_state';
import { ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { ButtonGroup } from '@akohn/dashql-react/components/button_group';
import { SegmentedControl, SegmentedControlSize } from '@akohn/dashql-react/components/segmented_control';
import { CheckIcon, EyeClosedIcon, GraphIcon, PaperAirplaneIcon, PencilIcon, SquareFillIcon, SymbolIcon, SyncIcon, TableIcon, ToolsIcon, XIcon } from '@akohn/dashql-react/components/symbol_icon';
import * as ActionList from '@akohn/dashql-react/components/action_list';
import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import { NameInput } from '@akohn/dashql-react/components/name_input';
import { Deferred } from '@akohn/dashql-react/components/deferred';
import { Skeleton } from '@akohn/dashql-react/components/skeleton';
import * as menuStyles from '../../app/action_menu.module.css';
import { dashboardCardHeight, type DashboardPlacement } from './dashboard_layout.js';
import { NEW_CHART_SPEC } from '../chart_builder/chart_spec_paths.js';
import { markdownTemplate, type DashboardRenderer } from './dashboard_source.js';
import * as styles from './dashboard.module.css';

const DragHandleIcon = SymbolIcon('drag_handle_16');
const MarkdownIcon = SymbolIcon('mark_text_16');
const KpiIcon = SymbolIcon('hash_16');
const MoreIcon = SymbolIcon('kebab_horizontal');
const RenameIcon = SymbolIcon('pencil_16');
const TrashIcon = SymbolIcon('trash_16');

export interface DashboardCardDependencies {
    QueryResultPanel: typeof QueryResultPanel;
    VisualizationDispatch: typeof VisualizationDispatch;
    ScriptEditor: typeof ScriptEditor;
}

const DEFAULT_DEPENDENCIES: DashboardCardDependencies = {
    QueryResultPanel,
    VisualizationDispatch,
    ScriptEditor,
};

export interface DashboardCardProps {
    /// The script of the card with its latest query, it runs, stops, accepts and rejects the staged rewrite
    model: ScriptModel;
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
    /// Is the connection of the script online? The card runs only then, and while no run holds the workbook.
    online: boolean;
    /// Rename the script, the name is the new display name. The menu of the card offers it.
    onRename: (scriptId: number, name: string) => void;
    /// Delete the script, the menu of the card offers it
    onDelete: (scriptId: number) => void;
    dependencies?: DashboardCardDependencies;
}

/// Memoized, a resize of one card only renders the cards whose placement changed.
/// A script without a visualization is a collapsed card: a header of one row with the renderers and an editor.
export const DashboardCard = React.memo(function DashboardCard(props: DashboardCardProps): React.ReactElement {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const script = props.model.script;
    const model = props.model.query;
    const query = model?.query ?? null;
    const visualizeQuery: ResolvedVisualizeQuery | null = script.annotations.visualizeQuery;
    const collapsed = visualizeQuery == null;
    // A staged rewrite, e.g. of the renderer, shows on the card and waits to be accepted or rejected like in the feed
    const staged = script.pendingDiff != null;
    const displayName = scriptDisplayName(script.fileName);
    const resizeStart = React.useRef<{ x: number; y: number; width: number; height: number; pointerId: number } | null>(null);
    const draggable = useDraggable({ id: script.scriptKey });
    // Is the name being edited in the title of the card? Rename in the menu of the card starts it
    const [renaming, setRenaming] = React.useState(false);
    const onRename = props.onRename;
    const scriptKey = script.scriptKey;
    const commitRename = React.useCallback((name: string) => {
        setRenaming(false);
        if (name.trim() !== '' && name.trim() !== displayName) onRename(scriptKey, name.trim());
    }, [onRename, scriptKey, displayName]);
    const cancelRename = React.useCallback(() => setRenaming(false), []);
    const transform = draggable.transform == null ? undefined : CSS.Translate.toString(draggable.transform);

    const { columnStep, rowStep, onResize, onResizeCancel } = props;
    const { width: placementWidth, height: placementHeight } = props.placement;
    const resizeFromPointer = React.useCallback((event: PointerEvent, commit: boolean) => {
        const start = resizeStart.current;
        if (start == null || event.pointerId !== start.pointerId) return;
        const width = start.width + Math.round((event.clientX - start.x) / Math.max(1, columnStep));
        // A collapsed card is one row high, it only changes its width
        const height = collapsed ? start.height : start.height + Math.round((event.clientY - start.y) / Math.max(1, rowStep));
        onResize(scriptKey, width, height, commit);
        if (commit) resizeStart.current = null;
    }, [columnStep, rowStep, onResize, scriptKey, collapsed]);

    const startResize = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        resizeStart.current = {
            x: event.clientX,
            y: event.clientY,
            width: placementWidth,
            height: placementHeight,
            pointerId: event.pointerId,
        };
        const move = (next: PointerEvent) => resizeFromPointer(next, false);
        const finish = (next: PointerEvent) => {
            resizeFromPointer(next, true);
            cleanup();
        };
        const cancel = () => {
            resizeStart.current = null;
            onResizeCancel();
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
    }, [placementWidth, placementHeight, onResizeCancel, resizeFromPointer]);

    const resizeWithKeyboard = React.useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
        let width = placementWidth;
        let height = placementHeight;
        if (event.key === 'ArrowLeft') width -= 1;
        else if (event.key === 'ArrowRight') width += 1;
        else if (event.key === 'ArrowUp' && !collapsed) height -= 1;
        else if (event.key === 'ArrowDown' && !collapsed) height += 1;
        else return;
        event.preventDefault();
        onResize(scriptKey, width, height, true);
    }, [placementWidth, placementHeight, onResize, scriptKey, collapsed]);

    // The Markdown template starts with the columns of the latest result
    const queryResult = model?.result ?? null;
    const resultColumns = query?.status === QueryExecutionStatus.SUCCEEDED
        ? queryResult?.schema.fields.map(field => field.name) ?? []
        : [];
    const template = markdownTemplate(resultColumns);
    // A visualized card shows a query, the tag can be on a statement before the last one
    const visualizable = visualizeQuery != null || script.annotations.lastStatementIsQuery === true;
    const notVisualizable = 'Only a query is visualized';
    // One button runs the card: a card without a result runs and may read cached results, a card with a result
    // refreshes without them, a running card stops
    const running = query != null && !queryIsDone(query.status);
    const hasResult = query?.status === QueryExecutionStatus.SUCCEEDED;
    const runnable = props.online && !props.model.runActive;
    const runAction = running
        ? { label: `Stop ${displayName}`, description: 'Stop the query', icon: <SquareFillIcon size={10} />, onClick: () => void props.model.cancel() }
        : hasResult
            ? { label: `Refresh ${displayName}`, description: 'Refresh, skips cached results', icon: <SyncIcon size={12} />, onClick: () => void props.model.run({ refresh: true }) }
            : { label: `Run ${displayName}`, description: 'Run, may use cached results', icon: <PaperAirplaneIcon size={12} />, onClick: () => void props.model.run({ refresh: false }) };
    const markdownDescription = template == null ? 'Run the script first' : 'Render every row as Markdown';
    // A table shows the header of the result over the rows that fit, a chart only the chart
    const body = collapsed ? null : visualizeQuery.renderer === 'table'
        ? <dependencies.QueryResultPanel model={model} onShowTable={() => props.onOpenTable(script.scriptKey)} />
        : <dependencies.VisualizationDispatch model={model} visualizeQuery={visualizeQuery} hideLegend={props.placement.width < 5} />;

    // The renderers of a card in the order of its segments, the last one collapses the card to its script. A chart
    // starts as a bar chart, the board opens its chart builder.
    const renderers: (DashboardRenderer | null)[] = ['table', 'vegalite', 'markdown', 'kpi', null];
    const currentRenderer = visualizeQuery?.renderer ?? null;
    // A KPI card fills the whole card, its header shows over it while the card is hovered or focused
    const kpi = !collapsed && currentRenderer === 'kpi';
    const switchRenderer = (index: number) => {
        const renderer = renderers[index];
        if (renderer === currentRenderer) return;
        if (renderer == null) props.onRemoveVisualization(script.scriptKey);
        else if (renderer === 'vegalite') props.onVisualize(script.scriptKey, 'vegalite', JSON.stringify(NEW_CHART_SPEC));
        else if (renderer === 'table') props.onVisualize(script.scriptKey, 'table', '');
        // A KPI card shows the last column of the result, the tag takes the columns once they are known
        else if (renderer === 'kpi') props.onVisualize(script.scriptKey, 'kpi', '');
        else if (template != null) props.onVisualize(script.scriptKey, 'markdown', template);
    };

    return (
        <article
            ref={draggable.setNodeRef}
            className={`${styles.card} ${collapsed ? styles.card_collapsed : ''} ${kpi ? styles.card_kpi : ''}`}
            data-dashboard-card={script.scriptKey}
            data-staged={staged || undefined}
            // The columns of the reflowed board of a compact window (dashboard.module.css): a KPI card takes one of two
            data-compact-span={props.placement.width <= 3 ? 1 : 2}
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
                        autoSelect
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
                                onClick={() => props.onOpenEditor(script.scriptKey)}
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
                                onClick={() => void props.model.acceptDiff()}
                            >
                                <CheckIcon size={12} />
                            </IconButton>
                            <IconButton
                                size={ButtonSize.Small}
                                variant={ButtonVariant.Default}
                                aria-label="Reject change"
                                description="Restore the script"
                                data-testid="dashboard-card-reject"
                                onClick={() => void props.model.rejectDiff()}
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
                                disabled={!running && !runnable}
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
                                    onClick={() => props.onOpenChart(script.scriptKey)}
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
                                onClick={() => props.onOpenEditor(script.scriptKey)}
                            >
                                <PencilIcon size={12} />
                            </IconButton>
                            <DashboardCardMenu
                                scriptName={displayName}
                                onRename={() => setRenaming(true)}
                                onDelete={() => props.onDelete(script.scriptKey)}
                                renderers={[
                                    { label: 'Table', icon: <TableIcon size={16} />, disabled: !visualizable && currentRenderer !== 'table' },
                                    { label: 'Chart', icon: <GraphIcon size={16} />, disabled: !visualizable && currentRenderer !== 'vegalite' },
                                    { label: 'Markdown', icon: <MarkdownIcon size={16} />, disabled: (!visualizable || template == null) && currentRenderer !== 'markdown' },
                                    { label: 'KPI', icon: <KpiIcon size={16} />, disabled: !visualizable && currentRenderer !== 'kpi' },
                                    { label: 'Collapsed', icon: <EyeClosedIcon size={16} />, disabled: false },
                                ]}
                                selectedRenderer={renderers.indexOf(currentRenderer)}
                                onRenderer={switchRenderer}
                            />
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
                                aria-label="KPI"
                                description={visualizable ? 'Show the value of the last row over a chart of the rows' : notVisualizable}
                                icon={<KpiIcon size={12} />}
                                data-testid="dashboard-card-renderer-kpi"
                                disabled={!visualizable && currentRenderer !== 'kpi'}
                                selected={currentRenderer === 'kpi'}
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
                {/* A result renders in a calm frame, the board appears with skeletons and stays smooth. Without a
                    result the card shows its cheap placeholder right away. */}
                {hasResult ? (
                    <Deferred fallback={<Skeleton />}>
                        {body}
                    </Deferred>
                ) : body}
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

/// A renderer of a card in its menu, in the order of the segments
interface DashboardCardMenuRenderer {
    label: string;
    icon: React.ReactElement;
    disabled: boolean;
}

interface DashboardCardMenuProps {
    scriptName: string;
    onRename: () => void;
    onDelete: () => void;
    /// The renderers like the segments of the header, which a narrow card hides (docs/design/narrow_layouts.md)
    renderers: DashboardCardMenuRenderer[];
    /// The index of the renderer that the card shows
    selectedRenderer: number;
    onRenderer: (index: number) => void;
}

/// The menu of a card with the renderers and the actions that change the script itself
function DashboardCardMenu(props: DashboardCardMenuProps): React.ReactElement {
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
                    <ActionList.GroupHeading>Show as</ActionList.GroupHeading>
                    {/* The list takes elements only, the fragment wraps the items of the renderers */}
                    <>{props.renderers.map((renderer, index) => (
                        <ActionList.ListItem key={renderer.label} data-testid="dashboard-card-menu-item" data-action={`renderer-${index}`}
                            selected={index === props.selectedRenderer} disabled={renderer.disabled}
                            onClick={() => run(() => props.onRenderer(index))}>
                            <ActionList.Leading>{renderer.icon}</ActionList.Leading>
                            <ActionList.ItemText>{renderer.label}</ActionList.ItemText>
                        </ActionList.ListItem>
                    ))}</>
                    <ActionList.GroupHeading>Script</ActionList.GroupHeading>
                    <ActionList.ListItem data-testid="dashboard-card-menu-item" data-action="rename" onClick={() => run(props.onRename)}>
                        <ActionList.Leading><RenameIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>Rename</ActionList.ItemText>
                    </ActionList.ListItem>
                    <ActionList.ListItem
                        data-testid="dashboard-card-menu-item"
                        data-action="delete"
                        className={menuStyles.delete_action}
                        onClick={() => run(props.onDelete)}
                    >
                        <ActionList.Leading><TrashIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>Delete</ActionList.ItemText>
                    </ActionList.ListItem>
                </ActionList.List>
            </div>
        </AnchoredOverlay>
    );
}
