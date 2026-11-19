import * as React from 'react';
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, type KeyboardCoordinateGetter } from '@dnd-kit/core';

import { useLogger } from '../../host/logger_provider.js';
import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { useOptionalRuntime, useScriptRun, useWorkbookExecution, useWorkbookScriptMap } from '@akohn/dashql-react/hooks';
import type { ModifyWorkbookScripts, ScriptData, ScriptDataMap, WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { deleteScript, useScriptSelection } from '../scripts/script_selection.js';
import { useLiveScriptReader } from '../scripts/script_creation.js';
import { renameScript, type RenameDraftReferences } from '../scripts/script_rename.js';
import type { DashboardSpec } from '@akohn/dashql/platform/workbook/script_types';
import { DashboardCard, type DashboardCardDependencies } from './dashboard_card.js';
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
import { VerticalScrollShadows } from '@akohn/dashql-react/components/vertical_scroll_shadows';
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
    /// Runs a script of the workbook with the scripts it references
    useScriptRun: typeof useScriptRun;
    DashboardEditorOverlay: typeof DashboardEditorOverlay;
    DashboardTableOverlay: typeof DashboardTableOverlay;
    DashboardChartOverlay: typeof DashboardChartOverlay;
    /// Reads a script as the runtime holds it now, e.g. the name of a renamed script
    useLiveScriptReader: typeof useLiveScriptReader;
    /// The dependencies of the cards, the defaults of the card if unset
    card?: DashboardCardDependencies;
}

const DEFAULT_DEPENDENCIES: DashboardDependencies = {
    useScriptRun,
    DashboardEditorOverlay,
    DashboardTableOverlay,
    DashboardChartOverlay,
    useLiveScriptReader,
};

interface Props {
    workbookScripts: WorkbookScripts;
    /// The scripts of the workbook by key, the ones of the runtime without
    scripts?: ScriptDataMap;
    modifyWorkbookScripts: ModifyWorkbookScripts;
    /// The connections that the scripts run on, a card refreshes while its connection is online
    scriptConnections?: ReadonlyMap<string, ConnectionState>;
    /// The function that renames the references in the draft of the composer
    draftRenameRef?: React.RefObject<RenameDraftReferences | null>;
    dependencies?: DashboardDependencies;
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

export function Dashboard(props: Props): React.ReactElement {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const gridRef = React.useRef<HTMLDivElement | null>(null);
    const scrollRef = React.useRef<HTMLDivElement | null>(null);
    const getScrollElement = React.useCallback(() => scrollRef.current, []);
    const resizeBaselineRef = React.useRef<DashboardPlacement[] | null>(null);
    const liveScripts = useWorkbookScriptMap(props.workbookScripts.workbookId);
    const scriptMap = props.scripts ?? liveScripts;
    const [layout, setLayout] = React.useState(() => readLayout(props.workbookScripts, scriptMap));
    const [gridWidth, setGridWidth] = React.useState(0);
    const [announcement, setAnnouncement] = React.useState('');
    const [overlay, setOverlay] = React.useState<DashboardOverlayState>(null);
    const logger = useLogger();
    const scripts = readScripts(props.workbookScripts, scriptMap);
    const layoutSourceKey = scripts.map(script => {
        const spec = preferredPlacement(script);
        const collapsed = script.annotations.visualizeQuery == null ? 'c' : '';
        return `${script.scriptKey}${collapsed}:${spec?.row ?? ''}:${spec?.column ?? ''}:${spec?.width ?? ''}:${spec?.height ?? ''}`;
    }).join('|');

    React.useEffect(() => setLayout(readLayout(props.workbookScripts, scriptMap)), [layoutSourceKey]);
    React.useEffect(() => {
        const grid = gridRef.current;
        if (grid == null) return;
        const observer = new ResizeObserver(entries => setGridWidth(entries[0]?.contentRect.width ?? grid.clientWidth));
        observer.observe(grid);
        setGridWidth(grid.clientWidth);
        return () => observer.disconnect();
    }, []);

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

    const persistLayout = React.useCallback((next: DashboardPlacement[], previous: DashboardPlacement[]) => {
        const previousById = new Map(previous.map(item => [item.id, item]));
        for (const placement of next) {
            const before = previousById.get(placement.id);
            if (before?.row === placement.row && before.column === placement.column
                && before.width === placement.width && before.height === placement.height) continue;
            const script = scriptMap[placement.id];
            if (script != null) persistDashboardPlacement(script, placement, props.modifyWorkbookScripts);
        }
    }, [scriptMap, props.modifyWorkbookScripts]);

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
        const script = scriptMap[ownerId];
        if (placed && script) {
            setAnnouncement(`${script.fileName} moved to row ${placed.row + 1}, column ${placed.column + 1}`);
        }
    }, [layout, columnStep, rowStep, persistLayout, scriptMap]);

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
    const scriptsRef = React.useRef(scriptMap);
    scriptsRef.current = scriptMap;
    const handleVisualize = React.useCallback((scriptKey: number, renderer: DashboardRenderer, body: string) => {
        const script = scriptsRef.current[scriptKey];
        if (script == null) return;
        if (!setDashboardRenderer(script, renderer, body, props.modifyWorkbookScripts, logger)) return;
        if (renderer === 'markdown') setOverlay({ scriptKey, kind: 'editor' });
        else if (renderer === 'vegalite') setOverlay({ scriptKey, kind: 'chart' });
    }, [props.modifyWorkbookScripts, logger]);
    const handleRemoveVisualization = React.useCallback((scriptKey: number) => {
        const script = scriptsRef.current[scriptKey];
        if (script != null) setDashboardRenderer(script, null, '', props.modifyWorkbookScripts, logger);
    }, [props.modifyWorkbookScripts, logger]);
    const handleOpenChart = React.useCallback((scriptKey: number) => setOverlay({ scriptKey, kind: 'chart' }), []);
    const handleOpenEditor = React.useCallback((scriptKey: number) => setOverlay({ scriptKey, kind: 'editor' }), []);
    const handleOpenTable = React.useCallback((scriptKey: number) => setOverlay({ scriptKey, kind: 'table' }), []);
    const closeOverlay = React.useCallback(() => setOverlay(null), []);
    // Run a card like a script in the feed. A run may read cached results, a refresh runs the script and the scripts it
    // references without them.
    const runtime = useOptionalRuntime();
    const workbookExecution = useWorkbookExecution(props.workbookScripts.workbookId);
    const workbookId = props.workbookScripts.workbookId;
    const workbookScriptsRef = React.useRef(props.workbookScripts);
    workbookScriptsRef.current = props.workbookScripts;
    const isOnline = (script: ScriptData) =>
        props.scriptConnections?.get(script.connectionId)?.connectionHealth === ConnectionHealth.ONLINE;
    const runScript = dependencies.useScriptRun();
    const handleRun = React.useCallback((scriptKey: number, refresh: boolean) => {
        const script = scriptsRef.current[scriptKey];
        if (script == null || runScript == null) return;
        void runScript(workbookId, scriptKey, { refresh });
    }, [runScript, workbookId]);
    // Stop the run of the workbook, or the query of the card
    const workbookBusy = workbookExecution.busy;
    const stopWorkbook = workbookExecution.stop;
    const handleStop = React.useCallback((scriptKey: number) => {
        const script = scriptsRef.current[scriptKey];
        if (workbookBusy) stopWorkbook();
        else if (script?.latestQueryId != null) void runtime?.cancel(script.latestQueryId);
    }, [workbookBusy, stopWorkbook, runtime]);
    // Accept or reject a staged rewrite of a card, like in the feed
    const handleAcceptDiff = React.useCallback((scriptKey: number) => {
        props.modifyWorkbookScripts({ kind: 'acceptPendingDiff', value: { scriptKey } });
    }, [props.modifyWorkbookScripts]);
    const handleRejectDiff = React.useCallback((scriptKey: number) => {
        props.modifyWorkbookScripts({ kind: 'rejectPendingDiff', value: { scriptKey } });
    }, [props.modifyWorkbookScripts]);
    // Rename and delete a card from its menu, like a script in the feed
    const draftRenameRef = props.draftRenameRef;
    const readScript = dependencies.useLiveScriptReader();
    const handleRename = React.useCallback((scriptKey: number, name: string) => {
        const workbookScripts = workbookScriptsRef.current;
        const script = scriptsRef.current[scriptKey];
        if (script == null) return;
        renameScript(workbookScripts, props.modifyWorkbookScripts, script.fileName, name, draftRenameRef?.current, key => readScript(key)?.fileName ?? null);
    }, [props.modifyWorkbookScripts, draftRenameRef, readScript]);
    const selection = useScriptSelection();
    const handleDelete = React.useCallback((scriptKey: number) => {
        const workbookScripts = workbookScriptsRef.current;
        const script = scriptsRef.current[scriptKey];
        if (script != null) deleteScript(selection, workbookScripts, props.modifyWorkbookScripts, script.fileName);
    }, [props.modifyWorkbookScripts, selection]);
    // The chart builder stages every edit of its spec as a diff of the script, like in the feed
    const handleSetVisSpec = React.useCallback((spec: string) => {
        if (overlay == null) return;
        props.modifyWorkbookScripts({ kind: 'setScriptVisSpec', value: { scriptKey: overlay.scriptKey, spec } });
    }, [overlay, props.modifyWorkbookScripts]);
    const overlayScript = overlay == null ? null : scriptMap[overlay.scriptKey] ?? null;

    const placementById = new Map(layout.map(item => [item.id, item]));
    const scriptOrder = new Map(scripts.map((script, index) => [script.scriptKey, index]));
    const cardScripts = [...scripts].sort((left, right) => {
        const a = placementById.get(left.scriptKey);
        const b = placementById.get(right.scriptKey);
        if (a == null || b == null) return (scriptOrder.get(left.scriptKey) ?? 0) - (scriptOrder.get(right.scriptKey) ?? 0);
        return a.row - b.row || a.column - b.column
            || (scriptOrder.get(left.scriptKey) ?? 0) - (scriptOrder.get(right.scriptKey) ?? 0);
    });
    const renderSection = (section: DashboardSection, label: string) => {
        const sectionScripts = cardScripts.filter(script => placementById.get(script.scriptKey)?.section === section);
        if (sectionScripts.length === 0) return null;
        return (
            <div
                className={section === 'scripts' ? styles.grid_scripts : styles.grid}
                role="group"
                aria-label={label}
                style={{ minHeight: dashboardCardHeight(dashboardSectionRows(layout, section)) }}
            >
                {sectionScripts.map(script => {
                    const placement = placementById.get(script.scriptKey)!;
                    const preferred = preferredPlacement(script);
                    const shifted = (preferred?.row != null && preferred.row !== placement.row)
                        || (preferred?.column != null && preferred.column !== placement.column);
                    return (
                        <DashboardCard
                            key={script.scriptKey}
                            workbookId={props.workbookScripts.workbookId}
                            script={script}
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
                            onAcceptDiff={handleAcceptDiff}
                            onRejectDiff={handleRejectDiff}
                            runnable={!workbookExecution.runActive && isOnline(script)}
                            onRun={handleRun}
                            onStop={handleStop}
                            onRename={handleRename}
                            onDelete={handleDelete}
                            dependencies={dependencies.card}
                        />
                    );
                })}
            </div>
        );
    };
    return (
        <section className={styles.page} aria-label="Dashboard">
            <div className={styles.sr_only} role="status" aria-live="polite">{announcement}</div>
            {/* The inputs of the workbook sit on a bar above the scrolling cards */}
            <WorkbookInputStrip
                className={styles.inputs}
                workbookId={props.workbookScripts.workbookId}
                modifyWorkbookScripts={props.modifyWorkbookScripts}
            />
            {/* The cards scroll under the bar of the inputs, the shadows mark the edges like in the feed */}
            <div className={styles.scroll_container}>
                <div ref={scrollRef} className={styles.scroll}>
                    {scripts.length === 0 ? (
                        <div className={styles.empty_state}>
                            <strong>No scripts yet</strong>
                            <span>Every script of the workbook appears here, queries with @vis comments as visualizations.</span>
                        </div>
                    ) : (
                        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                            {/* The scripts without a renderer on top, the visualizations below. Both sections share the columns. */}
                            <div ref={gridRef} className={styles.sections}>
                                {renderSection('scripts', 'Scripts without visualization')}
                                {renderSection('visualizations', 'Visualizations')}
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
            {overlayScript != null && overlay?.kind === 'editor' && (
                <dependencies.DashboardEditorOverlay
                    workbookId={props.workbookScripts.workbookId}
                    script={overlayScript}
                    onAcceptDiff={handleAcceptDiff}
                    onRejectDiff={handleRejectDiff}
                    onClose={closeOverlay}
                />
            )}
            {overlayScript != null && overlay?.kind === 'table' && (
                <dependencies.DashboardTableOverlay workbookId={props.workbookScripts.workbookId} script={overlayScript} onClose={closeOverlay} />
            )}
            {overlayScript != null && overlay?.kind === 'chart' && (
                <dependencies.DashboardChartOverlay
                    workbookId={props.workbookScripts.workbookId}
                    script={overlayScript}
                    onChange={handleSetVisSpec}
                    onClose={closeOverlay}
                />
            )}
        </section>
    );
}
