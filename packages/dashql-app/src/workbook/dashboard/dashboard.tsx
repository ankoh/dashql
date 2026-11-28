import * as React from 'react';
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, type KeyboardCoordinateGetter } from '@dnd-kit/core';

import { useLogger } from '../../host/logger_provider.js';
import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { useWorkbookScriptMap } from '@akohn/dashql-react/hooks';
import { useScriptModel } from '@akohn/dashql-react/models/script_model';
import type { ModifyWorkbookScripts, ScriptData, ScriptDataMap, WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { deleteScript, useScriptSelection } from '../scripts/script_selection.js';
import type { DashboardSpec } from '@akohn/dashql/platform/workbook/script_types';
import { DashboardCard, type DashboardCardDependencies, type DashboardCardProps } from './dashboard_card.js';
import { DashboardChartOverlay, DashboardEditorOverlay, DashboardTableOverlay, type DashboardOverlayState } from './dashboard_overlays.js';
import {
    DASHBOARD_COLLAPSED_WIDTH,
    DASHBOARD_COLUMN_COUNT,
    DASHBOARD_GRID_GAP,
    DASHBOARD_ROW_HEIGHT,
    dashboardCardHeight,
    dashboardSectionRows,
    moveDashboardItem,
    placeDashboardItems,
    resizeDashboardItem,
    type DashboardPlacement,
    type DashboardSection,
} from './dashboard_layout.js';
import { persistDashboardPlacement, setDashboardRenderer, type DashboardRenderer } from './dashboard_source.js';
import { WorkbookInputStrip } from '../inputs/workbook_input_strip.js';
import { StageSection } from '../stage_section.js';
import { VerticalScrollShadows } from '@akohn/dashql-react/components/vertical_scroll_shadows';
import { useObservedSize } from '@akohn/dashql-react/components/size_observer';
import * as styles from './dashboard.module.css';

const GRID_GAP = DASHBOARD_GRID_GAP;

function samePlacement(a: DashboardPlacement | undefined, b: DashboardPlacement): boolean {
    return a != null && a.id === b.id && a.row === b.row && a.column === b.column && a.width === b.width && a.height === b.height;
}

/// Keep the placements that did not change, the memoized cards only render again when their own placement changes.
/// Returns the previous layout if nothing changed.
function sharePlacements(next: DashboardPlacement[], previous: DashboardPlacement[]): DashboardPlacement[] {
    const previousById = new Map(previous.map(item => [item.id, item]));
    let changed = next.length !== previous.length;
    const shared = next.map((item, index) => {
        const before = previousById.get(item.id);
        if (!samePlacement(before, item)) {
            changed = true;
            return item;
        }
        if (previous[index] !== before) changed = true;
        return before!;
    });
    return changed ? shared : previous;
}

/// The functions and components that tests replace
export interface DashboardDependencies {
    /// The model of a script: a card runs, stops, accepts and rejects through it
    useScriptModel: typeof useScriptModel;
    DashboardEditorOverlay: typeof DashboardEditorOverlay;
    DashboardTableOverlay: typeof DashboardTableOverlay;
    DashboardChartOverlay: typeof DashboardChartOverlay;
    /// The dependencies of the cards, the defaults of the card if unset
    card?: DashboardCardDependencies;
}

const DEFAULT_DEPENDENCIES: DashboardDependencies = {
    useScriptModel,
    DashboardEditorOverlay,
    DashboardTableOverlay,
    DashboardChartOverlay,
};

interface Props {
    workbookScripts: WorkbookScripts;
    /// The scripts of the workbook by key, the ones of the runtime without
    scripts?: ScriptDataMap;
    modifyWorkbookScripts: ModifyWorkbookScripts;
    /// The connections that the scripts run on, a card refreshes while its connection is online
    scriptConnections?: ReadonlyMap<string, ConnectionState>;
    /// A script to show, e.g. one that the prompt created: the board scrolls its card into view, once
    revealRequest?: DashboardRevealRequest | null;
    dependencies?: DashboardDependencies;
}

/// A script that the board shows, a new request shows it again
export interface DashboardRevealRequest {
    scriptKey: number;
}

/// The space above the cards that a revealed card keeps
const REVEAL_TOP_INSET = 16;

/// The scroll position that shows an item of a scrolled list between the insets, moving as little as possible, or null
/// when the item shows already. An item higher than the space shows its top. `itemTop` counts from the top of the
/// scrolled content.
export function revealScrollTop(scrollTop: number, viewportHeight: number, itemTop: number, itemHeight: number, insetTop: number, insetBottom: number): number | null {
    const low = scrollTop + insetTop;
    const high = scrollTop + viewportHeight - insetBottom;
    if (itemTop >= low && itemTop + itemHeight <= high) return null;
    if (itemTop < low || itemHeight > high - low) return itemTop - insetTop;
    return itemTop + itemHeight - (viewportHeight - insetBottom);
}

/// Every script of the workbook is a card, in the order of the workbook
function readScripts(workbookScripts: WorkbookScripts, scripts: ScriptDataMap): ScriptData[] {
    return workbookScripts.scriptKeys
        .map(key => scripts[key])
        .filter(script => script != null);
}

/// The placement that a script asks for: its visualization's, or the `@board` tag of a script without one
function preferredPlacement(script: ScriptData): DashboardSpec | null {
    return script.annotations.visualizeQuery?.dashboardSpec ?? script.annotations.boardPosition ?? null;
}

function readLayout(workbookScripts: WorkbookScripts, scripts: ScriptDataMap): DashboardPlacement[] {
    return placeDashboardItems(readScripts(workbookScripts, scripts).map(script => {
        const spec = preferredPlacement(script);
        // A script without a visualization is a collapsed card of one row, in the section of the scripts on top
        const collapsed = script.annotations.visualizeQuery == null;
        return {
            id: script.scriptKey,
            section: collapsed ? 'scripts' : 'visualizations',
            row: spec?.row,
            column: spec?.column,
            width: spec?.width ?? (collapsed ? DASHBOARD_COLLAPSED_WIDTH : undefined),
            height: collapsed ? 1 : spec?.height,
        };
    }));
}

/// The card of a script with the model of the script, the cards of a section are a list
function DashboardScriptCard({ workbookId, scriptKey, useScriptModel, ...card }: Omit<DashboardCardProps, 'model'> & {
    workbookId: string;
    scriptKey: number;
    useScriptModel: DashboardDependencies['useScriptModel'];
}): React.ReactElement | null {
    const model = useScriptModel(workbookId, scriptKey);
    return model == null ? null : <DashboardCard model={model} {...card} />;
}

export function Dashboard(props: Props): React.ReactElement {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const { modifyWorkbookScripts } = props;
    const gridRef = React.useRef<HTMLDivElement | null>(null);
    const scrollRef = React.useRef<HTMLDivElement | null>(null);
    const getScrollElement = React.useCallback(() => scrollRef.current, []);
    const resizeBaselineRef = React.useRef<DashboardPlacement[] | null>(null);
    const liveScripts = useWorkbookScriptMap(props.workbookScripts.workbookId);
    const scriptMap = props.scripts ?? liveScripts;
    const [layout, setLayout] = React.useState(() => readLayout(props.workbookScripts, scriptMap));
    // The grid mounts with the first script, after the empty state
    const gridWidth = useObservedSize(gridRef)?.width ?? 0;
    const [announcement, setAnnouncement] = React.useState('');
    const [overlay, setOverlay] = React.useState<DashboardOverlayState>(null);
    const logger = useLogger();
    const scripts = readScripts(props.workbookScripts, scriptMap);
    const layoutSourceKey = scripts.map(script => {
        const spec = preferredPlacement(script);
        const collapsed = script.annotations.visualizeQuery == null ? 'c' : '';
        return `${script.scriptKey}${collapsed}:${spec?.row ?? ''}:${spec?.column ?? ''}:${spec?.width ?? ''}:${spec?.height ?? ''}`;
    }).join('|');

    // The layout is read again when a placement changes, an edit of the text of a script keeps it
    const readCurrentLayout = React.useEffectEvent(() => readLayout(props.workbookScripts, scriptMap));
    React.useEffect(() => setLayout(readCurrentLayout()), [layoutSourceKey]);

    const columnStep = gridWidth > 0 ? (gridWidth - GRID_GAP * (DASHBOARD_COLUMN_COUNT - 1)) / DASHBOARD_COLUMN_COUNT + GRID_GAP : 1;
    const rowStep = DASHBOARD_ROW_HEIGHT + GRID_GAP;
    const keyboardCoordinates = React.useCallback<KeyboardCoordinateGetter>((event, { currentCoordinates }) => {
        switch (event.code) {
            case 'ArrowLeft': return { ...currentCoordinates, x: currentCoordinates.x - columnStep };
            case 'ArrowRight': return { ...currentCoordinates, x: currentCoordinates.x + columnStep };
            case 'ArrowUp': return { ...currentCoordinates, y: currentCoordinates.y - rowStep };
            case 'ArrowDown': return { ...currentCoordinates, y: currentCoordinates.y + rowStep };
            default: return undefined;
        }
    }, [columnStep, rowStep]);
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
    );

    // The handlers read the scripts through a ref, so that the cards keep their callbacks while a script changes
    const scriptsRef = React.useRef(scriptMap);
    scriptsRef.current = scriptMap;
    const persistLayout = React.useCallback((next: DashboardPlacement[], previous: DashboardPlacement[]) => {
        const previousById = new Map(previous.map(item => [item.id, item]));
        for (const placement of next) {
            const before = previousById.get(placement.id);
            if (before?.row === placement.row && before.column === placement.column
                && before.width === placement.width && before.height === placement.height) continue;
            const script = scriptsRef.current[placement.id];
            if (script != null) persistDashboardPlacement(script, placement, modifyWorkbookScripts);
        }
    }, [modifyWorkbookScripts]);

    const handleDragEnd = React.useCallback((event: DragEndEvent) => {
        const ownerId = Number(event.active.id);
        const current = layout.find(item => item.id === ownerId);
        if (current == null) return;
        const next = moveDashboardItem(
            layout,
            ownerId,
            current.row + Math.round(event.delta.y / rowStep),
            current.column + Math.round(event.delta.x / columnStep),
        );
        setLayout(next);
        persistLayout(next, layout);
        const placed = next.find(item => item.id === ownerId);
        const script = scriptsRef.current[ownerId];
        if (placed && script) {
            setAnnouncement(`${script.fileName} moved to row ${placed.row + 1}, column ${placed.column + 1}`);
        }
    }, [layout, columnStep, rowStep, persistLayout]);

    // The resize handler reads the layout through a ref, so that the cards keep their callback while the layout changes
    const layoutRef = React.useRef(layout);
    layoutRef.current = layout;
    const handleResize = React.useCallback((ownerId: number, width: number, height: number, commit: boolean) => {
        const current = layoutRef.current;
        const baseline = resizeBaselineRef.current ?? current;
        if (!commit && resizeBaselineRef.current == null) resizeBaselineRef.current = current;
        const next = sharePlacements(resizeDashboardItem(current, ownerId, width, height), current);
        // Pointer moves within the snapped size do not change the layout
        if (!commit && next === current) return;
        setLayout(next);
        if (commit) {
            persistLayout(next, baseline);
            resizeBaselineRef.current = null;
        }
    }, [persistLayout]);

    const handleResizeCancel = React.useCallback(() => {
        if (resizeBaselineRef.current != null) setLayout(resizeBaselineRef.current);
        resizeBaselineRef.current = null;
    }, []);

    // The renderers of a card. A Markdown template and a bar chart are a start, the editor or the chart builder opens
    // to adjust them.
    const handleVisualize = React.useCallback((scriptKey: number, renderer: DashboardRenderer, body: string) => {
        const script = scriptsRef.current[scriptKey];
        if (script == null) return;
        if (!setDashboardRenderer(script, renderer, body, modifyWorkbookScripts, logger)) return;
        if (renderer === 'markdown') setOverlay({ scriptKey, kind: 'editor' });
        else if (renderer === 'vegalite') setOverlay({ scriptKey, kind: 'chart' });
    }, [modifyWorkbookScripts, logger]);
    const handleRemoveVisualization = React.useCallback((scriptKey: number) => {
        const script = scriptsRef.current[scriptKey];
        if (script != null) setDashboardRenderer(script, null, '', modifyWorkbookScripts, logger);
    }, [modifyWorkbookScripts, logger]);
    const handleOpenChart = React.useCallback((scriptKey: number) => setOverlay({ scriptKey, kind: 'chart' }), []);
    const handleOpenEditor = React.useCallback((scriptKey: number) => setOverlay({ scriptKey, kind: 'editor' }), []);
    const handleOpenTable = React.useCallback((scriptKey: number) => setOverlay({ scriptKey, kind: 'table' }), []);
    const closeOverlay = React.useCallback(() => setOverlay(null), []);
    const workbookId = props.workbookScripts.workbookId;
    const workbookScriptsRef = React.useRef(props.workbookScripts);
    workbookScriptsRef.current = props.workbookScripts;
    const isOnline = (script: ScriptData) =>
        props.scriptConnections?.get(script.connectionId)?.connectionHealth === ConnectionHealth.ONLINE;
    // Rename and delete a card from its menu, like a script in the feed
    const handleRename = React.useCallback((scriptKey: number, name: string) => {
        const script = scriptsRef.current[scriptKey];
        if (script == null) return;
        modifyWorkbookScripts({ kind: 'renameScript', value: { fileName: script.fileName, newName: name } });
    }, [modifyWorkbookScripts]);
    const selection = useScriptSelection();
    const handleDelete = React.useCallback((scriptKey: number) => {
        const workbookScripts = workbookScriptsRef.current;
        const script = scriptsRef.current[scriptKey];
        if (script != null) deleteScript(selection, workbookScripts, modifyWorkbookScripts, script.fileName);
    }, [modifyWorkbookScripts, selection]);
    // The overlay shows the script of a card, its editor accepts and rejects a staged rewrite and its chart builder
    // stages the edits of the spec, like in the feed
    const overlayModel = dependencies.useScriptModel(workbookId, overlay?.scriptKey ?? null);

    // A requested card shows once the layout placed it, clear of the prompt over the bottom of the board, which the
    // bottom padding of the scrolled cards keeps free
    const revealedRef = React.useRef<DashboardRevealRequest | null>(null);
    const revealRequest = props.revealRequest ?? null;
    React.useLayoutEffect(() => {
        const scroll = scrollRef.current;
        if (revealRequest == null || revealRequest === revealedRef.current || scroll == null) return;
        const card = scroll.querySelector<HTMLElement>(`[data-dashboard-card="${revealRequest.scriptKey}"]`);
        if (card == null) return;
        revealedRef.current = revealRequest;
        const scrollRect = scroll.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const insetBottom = Number.parseFloat(getComputedStyle(scroll).paddingBottom) || 0;
        const top = revealScrollTop(scroll.scrollTop, scroll.clientHeight, cardRect.top - scrollRect.top + scroll.scrollTop, cardRect.height, REVEAL_TOP_INSET, insetBottom);
        if (top == null) return;
        const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        scroll.scrollTo({ top, behavior: reducedMotion ? 'auto' : 'smooth' });
    }, [revealRequest, layout]);

    const placementById = new Map(layout.map(item => [item.id, item]));
    const scriptOrder = new Map(scripts.map((script, index) => [script.scriptKey, index]));
    const cardScripts = [...scripts].sort((left, right) => {
        const a = placementById.get(left.scriptKey);
        const b = placementById.get(right.scriptKey);
        if (a == null || b == null) return (scriptOrder.get(left.scriptKey) ?? 0) - (scriptOrder.get(right.scriptKey) ?? 0);
        return a.row - b.row || a.column - b.column
            || (scriptOrder.get(left.scriptKey) ?? 0) - (scriptOrder.get(right.scriptKey) ?? 0);
    });
    const renderSection = (section: DashboardSection, label: string, groupLabel: string) => {
        const sectionScripts = cardScripts.filter(script => placementById.get(script.scriptKey)?.section === section);
        if (sectionScripts.length === 0) return null;
        return (
            <StageSection label={label}>
                <div
                    className={styles.grid}
                    role="group"
                    aria-label={groupLabel}
                    style={{ minHeight: dashboardCardHeight(dashboardSectionRows(layout, section)) }}
                >
                    {sectionScripts.map(script => {
                        const placement = placementById.get(script.scriptKey)!;
                        const preferred = preferredPlacement(script);
                        const shifted = (preferred?.row != null && preferred.row !== placement.row)
                            || (preferred?.column != null && preferred.column !== placement.column);
                        return (
                            <DashboardScriptCard
                                key={script.scriptKey}
                                workbookId={workbookId}
                                scriptKey={script.scriptKey}
                                useScriptModel={dependencies.useScriptModel}
                                placement={placement}
                                columnStep={columnStep}
                                rowStep={rowStep}
                                onResize={handleResize}
                                onResizeCancel={handleResizeCancel}
                                shifted={shifted}
                                onVisualize={handleVisualize}
                                onOpenChart={handleOpenChart}
                                onRemoveVisualization={handleRemoveVisualization}
                                onOpenEditor={handleOpenEditor}
                                onOpenTable={handleOpenTable}
                                online={isOnline(script)}
                                onRename={handleRename}
                                onDelete={handleDelete}
                                dependencies={dependencies.card}
                            />
                        );
                    })}
                </div>
            </StageSection>
        );
    };
    return (
        <section className={styles.page} aria-label="Dashboard">
            <div className={styles.sr_only} role="status" aria-live="polite">{announcement}</div>
            {/* The shadows mark the edges of the scrolling cards like in the feed */}
            <div className={styles.scroll_container}>
                <div ref={scrollRef} className={styles.scroll} data-testid="dashboard-scroll">
                    {scripts.length === 0 ? (
                        <div className={styles.empty_state}>
                            <strong>No scripts yet</strong>
                            <span>Every script of the workbook appears here, queries with @vis comments as visualizations.</span>
                        </div>
                    ) : (
                        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                            {/* The inputs of the workbook head the page and scroll away with the cards, like in the feed. Then the
                                scripts without a renderer, the visualizations below. Both sections of cards share the columns. */}
                            <div ref={gridRef} className={styles.sections}>
                                <WorkbookInputStrip
                                    workbookId={props.workbookScripts.workbookId}
                                    modifyWorkbookScripts={modifyWorkbookScripts}
                                />
                                {renderSection('scripts', 'Scripts', 'Scripts without visualization')}
                                {renderSection('visualizations', 'Visualizations', 'Visualizations')}
                            </div>
                        </DndContext>
                    )}
                </div>
                <VerticalScrollShadows
                    getScrollElement={getScrollElement}
                    prominent
                    refreshKey={`${props.workbookScripts.workbookId}:${scripts.length}:${dashboardSectionRows(layout, 'scripts')}:${dashboardSectionRows(layout, 'visualizations')}`}
                />
            </div>
            {overlayModel != null && overlay?.kind === 'editor' && (
                <dependencies.DashboardEditorOverlay model={overlayModel} onClose={closeOverlay} />
            )}
            {overlayModel != null && overlay?.kind === 'table' && (
                <dependencies.DashboardTableOverlay model={overlayModel} onClose={closeOverlay} />
            )}
            {overlayModel != null && overlay?.kind === 'chart' && (
                <dependencies.DashboardChartOverlay model={overlayModel} onClose={closeOverlay} />
            )}
        </section>
    );
}
