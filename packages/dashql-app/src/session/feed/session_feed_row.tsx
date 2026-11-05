import * as React from 'react';
import * as styles from './session_feed.module.css';
import * as dashql from '@ankoh/dashql-core';
import { useSessionExecution } from '../scripts/session_execution_provider.js';

import type { EditorView } from '@codemirror/view';
import type { Icon } from '../../ui/foundations/symbol_icon.js';
import { PlusIcon } from '../../ui/foundations/symbol_icon.js';
import type { RowComponentProps } from 'react-window';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { ButtonGroup } from '../../ui/foundations/button_group.js';
import { IndicatorStatus } from '../../ui/foundations/status_indicator.js';
import { SymbolIcon } from '../../ui/foundations/symbol_icon.js';
import { ConnectionHealth, type ConnectionState } from '../../connections/connection_state.js';
import { ConnectorType } from '../../connections/connector_info.js';
import { QueryExecutionStatus } from '../../query/query_execution_state.js';
import { useCancelQuery, useQueryState } from '../../connections/query_executor.js';
import type { StorageReader } from '../../storage/storage_provider.js';
import { getScriptRefs, type SessionScripts, type ScriptData } from '../scripts/session_scripts.js';
import { scriptDisplayName } from '../scripts/script_types.js';
import { deriveEntryStatus, EntryStatusKind } from '../entry_status_model.js';
import { EntryStatusBar } from '../entry_status_bar.js';
import { CachedResultBean, QueryResultRerunButton } from '../persistence/query_result_cache_controls.js';
import { ScriptDiagnosticsButton } from '../scripts/script_diagnostics.js';
import { ScriptEditor } from '../scripts/script_editor.js';
import { ScriptStatisticsBar } from '../scripts/script_statistics_bar.js';
import { formatScriptEditor, formattingDialectForConnector, isScriptFormattable } from '../scripts/script_format.js';
import { FeedEntryFooter, FeedEntryTabStrip, useFeedEntryTabs } from './feed_entry_footer.js';
import type { ScriptStorage } from '../scripts/script_action_menu.js';
import { displayPath } from '../../storage/session_locator.js';
import { STORAGE_SCRIPTS_FOLDER } from '../../storage/storage_backend.js';
import type { ScriptConnectionView } from '../scripts/script_connection_picker.js';
import { ChartBuilderOverlay } from '../chart_builder/chart_builder_overlay.js';
import { ResultTableOverlay } from '../../views/query_result/result_table_overlay.js';
import { FeedEntryHeader } from './feed_entry_header.js';
import { FEED_TOP_PADDING } from './session_feed_layout.js';
import type { ScriptReferenceReport } from '../scripts/script_reference_check.js';

const DragHandleIcon: Icon = SymbolIcon('drag_handle_16');

export interface ScriptCardProps {
    sessionId: string;
    /// The connection fields of the card, the connection the script runs on.
    /// The connection state itself changes with every query event of the session.
    connectionId: string | null;
    connectionHealth: ConnectionHealth | null;
    connectionDetails: ConnectionState['details'] | null;
    connectorType: ConnectorType;
    /// The connection the script runs on, null while it is not registered
    connection: ScriptConnectionView | null;
    /// The cache key of the result of a script, the key that a run of the script reads and writes
    computeCacheKey: (scriptKey: number) => Promise<string | null>;
    /// Is a cache key cached in the query result cache of the app?
    /// The time the result of a cache key was written, null if the key is not cached
    lookupCachedResult: (cacheKey: string) => Promise<number | null>;
    storageReader: StorageReader;
    isFocused: boolean;
    scriptData: ScriptData | undefined;
    scriptFileName: string;
    scriptDebugMode: boolean;
    formattingDebugMode: boolean;
    keywordCase: dashql.buffers.formatting.KeywordCase;
    canExecute: boolean;
    active: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    /// The position of the script in the feed
    index: number;
    /// Add a script at a position of the feed
    onCreate: (index: number) => void;
    onFocus: (fileName: string) => void;
    onDelete: (fileName: string) => void;
    onRename: (oldFileName: string, newFileName: string) => void;
    /// Run the script on another connection
    onPickConnection: (fileName: string, connectionId: string) => void;
    onMoveUp: (fileName: string) => void;
    onMoveDown: (fileName: string) => void;
    onExecute: (fileName: string) => void;
    onRerun: (fileName: string) => void;
    onFormat: (scriptKey: number, text: string) => void;
    /// Replace the text of the script with the text of a snippet
    onApplySnippet: (scriptKey: number, text: string) => void;
    /// Write a Vega-Lite spec of the chart builder into the `@vis vegalite` tag of the script
    onSetVisSpec: (scriptKey: number, spec: string) => void;
    /// Can a question of the composer target the script?
    canTarget: boolean;
    /// The checked script references of the script
    scriptReferences?: ScriptReferenceReport | null;
    /// Reference the script in the question of the composer
    onTarget: (fileName: string) => void;
    onAcceptDiff: (scriptKey: number) => void;
    onRejectDiff: (scriptKey: number) => void;
    resultExpanded: boolean;
    onToggleResultExpanded: (scriptKey: number) => void;
    onAutoCollapseResult: (scriptKey: number, queryId: number) => void;
    onResetAutoCollapsedResult: (scriptKey: number, queryId: number | null) => void;
    onEditorView: (scriptKey: number, view: EditorView) => void;
    dependencies?: ScriptCardDependencies;
}

export interface ScriptCardDependencies {
    useQueryState: typeof useQueryState;
    useCancelQuery: typeof useCancelQuery;
    ScriptEditor: typeof ScriptEditor;
    ScriptDiagnosticsButton: typeof ScriptDiagnosticsButton;
    ScriptStatisticsBar: typeof ScriptStatisticsBar;
    formatScriptEditor: typeof formatScriptEditor;
    isScriptFormattable: typeof isScriptFormattable;
    CachedResultBean: typeof CachedResultBean;
    QueryResultRerunButton: typeof QueryResultRerunButton;
    EntryStatusBar: typeof EntryStatusBar;
    FeedEntryFooter: typeof FeedEntryFooter;
    FeedEntryTabStrip: typeof FeedEntryTabStrip;
    ChartBuilderOverlay: typeof ChartBuilderOverlay;
    ResultTableOverlay: typeof ResultTableOverlay;
}

const DEFAULT_SCRIPT_CARD_DEPENDENCIES: ScriptCardDependencies = {
    useQueryState,
    useCancelQuery,
    ScriptEditor,
    ScriptDiagnosticsButton,
    ScriptStatisticsBar,
    formatScriptEditor,
    isScriptFormattable,
    CachedResultBean,
    QueryResultRerunButton,
    EntryStatusBar,
    FeedEntryFooter,
    FeedEntryTabStrip,
    ChartBuilderOverlay,
    ResultTableOverlay,
};

// Memoized since every row of the feed re-renders whenever any script changes
export const ScriptCard: React.FC<ScriptCardProps> = React.memo((props: ScriptCardProps) => {
    const sessionExecution = useSessionExecution(props.sessionId);
    const dependencies = props.dependencies ?? DEFAULT_SCRIPT_CARD_DEPENDENCIES;
    const CheckIcon: Icon = SymbolIcon('check_16');
    const CrossIcon: Icon = SymbolIcon('x_16');

    const queryState = dependencies.useQueryState(props.sessionId, props.scriptData?.latestQueryId ?? null);
    const cancelQuery = dependencies.useCancelQuery();

    // A staged rewrite waiting to be accepted/rejected. The editable editor renders the
    // in-place diff and these actions provide the same explicit accept/reject alternatives.
    const hasPendingDiff = props.scriptData?.pendingDiff != null;

    // Is the script cached?
    // Planning the script is a full pass over the scripts it needs, only re-check when the text, the catalog,
    // the queries or their cache entries changed (and not on every cursor move).
    // The time the cached result of a run of the script was written, null if it is not cached
    const [cachedAtMs, setCachedAtMs] = React.useState<number | null>(null);
    React.useEffect(() => {
        const cancel = new AbortController();
        const connectionDetails = props.connectionDetails;
        const run = async () => {
            // Not script data? Clear cache indicator.
            if (props.scriptData == null || !connectionDetails) {
                setCachedAtMs(null);
                return;
            }
            // Outdated analysis? Keep the last known indicator until the script is re-analyzed.
            // Every keystroke outdates all scripts of the session, clearing it would make it flicker.
            if (props.scriptData.analysisOutdated) {
                return;
            }
            try {
                // The key of a run of the script, null if its result is not cacheable
                const cacheKey = await props.computeCacheKey(props.scriptData.scriptKey);
                // Look up the key in the cache of the app
                const cachedAt = cacheKey != null ? await props.lookupCachedResult(cacheKey) : null;
                if (!cancel.signal.aborted) {
                    setCachedAtMs(cachedAt);
                }
            } catch { }
        };
        run();
        return () => cancel.abort();
    }, [
        props.scriptData?.scriptSession,
        props.scriptData?.analysisOutdated,
        props.scriptData?.editorUpdate?.textVersion,
        props.scriptData?.editorUpdate?.catalogRevision,
        props.scriptData?.latestQueryId,
        props.scriptData?.latestResultQueryId,
        queryState?.cacheKey,
        queryState?.cacheDeleted,
        props.connectionDetails,
        props.computeCacheKey,
        props.lookupCachedResult,
        props.sessionId,
    ]);

    // The result header persists for active and terminal execution states. It can collapse the
    // result body without affecting its cancel, cache, and rerun actions.
    const entryStatus = deriveEntryStatus(queryState);
    const scriptKey = props.scriptData?.scriptKey ?? null;
    // The result tabs live in the status bar, their panel below it
    const resultTabs = useFeedEntryTabs(queryState, props.scriptData?.annotations.visualizeQuery ?? null);
    // Picking a tab of a collapsed result shows it
    const expandResult = React.useCallback(() => {
        if (scriptKey != null && !props.resultExpanded) props.onToggleResultExpanded(scriptKey);
    }, [scriptKey, props.resultExpanded, props.onToggleResultExpanded]);
    React.useEffect(() => {
        if (scriptKey == null) return;
        if (queryState?.status !== QueryExecutionStatus.SUCCEEDED || queryState.resultTable !== null) {
            props.onResetAutoCollapsedResult(scriptKey, queryState?.queryId ?? props.scriptData?.latestQueryId ?? null);
            return;
        }
        props.onAutoCollapseResult(scriptKey, queryState.queryId);
    }, [props.onAutoCollapseResult, props.onResetAutoCollapsedResult, props.scriptData?.latestQueryId, queryState, scriptKey]);
    const cancelEntryOperation = React.useCallback(() => {
        if (entryStatus?.kind === EntryStatusKind.Query && props.scriptData?.latestQueryId != null) {
            if (sessionExecution.busy) sessionExecution.stop();
            else if (props.connectionId != null) cancelQuery(props.connectionId, props.scriptData.latestQueryId);
        }
    }, [cancelQuery, entryStatus?.kind, props.connectionId, props.scriptData?.latestQueryId, sessionExecution.busy, sessionExecution.stop]);

    const acceptDiff = React.useCallback(() => {
        if (scriptKey != null) props.onAcceptDiff(scriptKey);
    }, [scriptKey, props.onAcceptDiff]);
    const rejectDiff = React.useCallback(() => {
        if (scriptKey != null) props.onRejectDiff(scriptKey);
    }, [scriptKey, props.onRejectDiff]);

    const [editorView, setEditorView] = React.useState<EditorView | null>(null);
    const formattingDialect = formattingDialectForConnector(props.connectorType);
    // Formattability only depends on the text, cursor moves bump the state revision but not the text version
    const isFormattable = React.useMemo(
        () => dependencies.isScriptFormattable(props.scriptData ?? null, formattingDialect),
        [props.scriptData?.scriptSession, props.scriptData?.editorUpdate?.textVersion, formattingDialect],
    );
    const handleEditorView = React.useCallback((view: EditorView) => {
        setEditorView(view);
        if (props.scriptData != null) props.onEditorView(props.scriptData.scriptKey, view);
    }, [props.onEditorView, props.scriptData?.scriptKey]);
    const handleFormat = React.useCallback((mode: dashql.buffers.formatting.FormattingMode) => {
        dependencies.formatScriptEditor(
            editorView,
            props.scriptData ?? null,
            mode,
            (text) => {
                if (props.scriptData != null) props.onFormat(props.scriptData.scriptKey, text);
            },
            props.formattingDebugMode,
            props.keywordCase,
            formattingDialect,
        );
    }, [editorView, props.formattingDebugMode, props.keywordCase, formattingDialect, props.onFormat, props.scriptData]);

    // Labels use the display name (the file name without ".sql"); the raw scriptFileName remains the
    // identity passed to handlers and to RENAME_SCRIPT.
    const applySnippet = React.useCallback((text: string) => {
        if (scriptKey != null) props.onApplySnippet(scriptKey, text);
    }, [scriptKey, props.onApplySnippet]);
    const setVisSpec = React.useCallback((spec: string) => {
        if (scriptKey != null) props.onSetVisSpec(scriptKey, spec);
    }, [scriptKey, props.onSetVisSpec]);

    const displayName = scriptDisplayName(props.scriptFileName);
    const storage = React.useMemo<ScriptStorage>(() => ({
        fileName: props.scriptFileName,
        resolvePath: () => `${displayPath(props.sessionId, props.storageReader.getSessionLocation(props.sessionId))}/${STORAGE_SCRIPTS_FOLDER}/${props.scriptFileName}`,
        onRename: name => props.onRename(props.scriptFileName, name),
    }), [props.scriptFileName, props.sessionId, props.storageReader, props.onRename]);

    // The full result table opens in a card over the feed
    const [tableOverlayOpen, setTableOverlayOpen] = React.useState(false);
    const showTable = React.useCallback(() => setTableOverlayOpen(true), []);
    const closeTableOverlay = React.useCallback(() => setTableOverlayOpen(false), []);

    const resultContentId = props.scriptData != null ? `feed-result-${props.scriptData.scriptKey}` : undefined;
    const hasFooterContent = entryStatus.kind !== EntryStatusKind.Idle;
    return (
        <article
            className={styles.feed_entry_pair}
            data-electron-drag-region="false"
            onPointerEnter={() => props.onFocus(props.scriptFileName)}
            aria-label={`${displayName} script cell`}
            data-testid="script-cell"
        >
            <div className={styles.feed_entry_cell} data-result-card={hasFooterContent ? '' : undefined}>
                <FeedEntryHeader
                    sessionId={props.sessionId}
                    scriptData={props.scriptData}
                    scriptFileName={props.scriptFileName}
                    connection={props.connection}
                    connectorType={props.connectorType}
                    queryState={queryState}
                    focused={props.isFocused}
                    canExecute={props.canExecute}
                    scriptDebugMode={props.scriptDebugMode}
                    isFormattable={isFormattable}
                    canFormat={editorView != null}
                    scriptReferences={props.scriptReferences ?? null}
                    canTarget={props.canTarget}
                    onTarget={() => props.onTarget(props.scriptFileName)}
                    onExecute={() => props.onExecute(props.scriptFileName)}
                    onPickConnection={connectionId => props.onPickConnection(props.scriptFileName, connectionId)}
                    onRename={name => props.onRename(props.scriptFileName, name)}
                    onDelete={() => props.onDelete(props.scriptFileName)}
                    onFormat={handleFormat}
                    onApplySnippet={applySnippet}
                    onSetVisSpec={setVisSpec}
                    storage={storage}
                    onAddAbove={() => props.onCreate(props.index)}
                    onAddBelow={() => props.onCreate(props.index + 1)}
                    onMoveUp={() => props.onMoveUp(props.scriptFileName)}
                    onMoveDown={() => props.onMoveDown(props.scriptFileName)}
                    canMoveUp={props.canMoveUp}
                    canMoveDown={props.canMoveDown}
                    dependencies={dependencies}
                />
                <div className={styles.feed_body}>
                    <div className={styles.feed_editor_container}>
                        {props.scriptData == null || !props.active ? null : (
                            <dependencies.ScriptEditor
                                sessionId={props.sessionId}
                                scriptKey={props.scriptData.scriptKey}
                                className={styles.feed_script_editor}
                                autoHeight
                                onFocus={() => props.onFocus(props.scriptFileName)}
                                setView={handleEditorView}
                            />
                        )}
                        {hasPendingDiff && (
                            <div className={styles.feed_body_overlays}>
                                <div data-diff-actions>
                                    <ButtonGroup>
                                        <IconButton
                                            variant={ButtonVariant.Default}
                                            size={ButtonSize.Small}
                                            onClick={acceptDiff}
                                            aria-label="Accept rewrite"
                                            data-testid="diff-accept"
                                        >
                                            <CheckIcon size={14} />
                                        </IconButton>
                                        <IconButton
                                            variant={ButtonVariant.Default}
                                            size={ButtonSize.Small}
                                            onClick={rejectDiff}
                                            aria-label="Reject rewrite"
                                            data-testid="diff-reject"
                                        >
                                            <CrossIcon size={14} />
                                        </IconButton>
                                    </ButtonGroup>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                {hasFooterContent && (
                    <div className={styles.feed_entry_footer} data-feed-result="">
                        <dependencies.EntryStatusBar
                            status={entryStatus}
                            onToggleExpanded={() => {
                                if (scriptKey != null) props.onToggleResultExpanded(scriptKey);
                            }}
                            expanded={props.resultExpanded}
                            controls={resultContentId}
                            onCancel={entryStatus.indicator === IndicatorStatus.Running ? cancelEntryOperation : undefined}
                            cancelLabel="Cancel query"
                            compact
                            tabs={
                                <dependencies.FeedEntryTabStrip
                                    tabs={resultTabs}
                                    expanded={props.resultExpanded}
                                    onSelect={expandResult}
                                />
                            }
                            actions={
                                <>
                                    {cachedAtMs != null && <dependencies.CachedResultBean cachedAtMs={cachedAtMs} />}
                                    <dependencies.QueryResultRerunButton
                                        query={queryState}
                                        onRerun={props.connectionHealth === ConnectionHealth.ONLINE && !sessionExecution.runActive
                                            ? () => props.onRerun(props.scriptFileName) : undefined}
                                    />
                                </>
                            }
                        />
                        {queryState != null ? (
                            <div id={resultContentId} hidden={!props.resultExpanded}>
                                <dependencies.FeedEntryFooter
                                    sessionId={props.sessionId}
                                    queryState={queryState}
                                    visualizeQuery={props.scriptData?.annotations.visualizeQuery ?? null}
                                    selectedTab={resultTabs.selectedTab}
                                    onShowTable={showTable}
                                />
                            </div>
                        ) : null}
                        {tableOverlayOpen && queryState != null && (
                            <dependencies.ResultTableOverlay
                                scriptName={displayName}
                                query={queryState}
                                onClose={closeTableOverlay}
                            />
                        )}
                    </div>
                )}
            </div>
        </article>
    );
});

export interface ScriptFeedRowProps {
    sessionId: string;
    /// The connections that the scripts run on
    connections: ReadonlyMap<string, ScriptConnectionView>;
    /// The cache key of the result of a script, the key that a run of the script reads and writes
    computeCacheKey: (scriptKey: number) => Promise<string | null>;
    /// Is a cache key cached in the query result cache of the app?
    /// The time the result of a cache key was written, null if the key is not cached
    lookupCachedResult: (cacheKey: string) => Promise<number | null>;
    storageReader: StorageReader;
    entries: ReturnType<typeof getScriptRefs>;
    scripts: SessionScripts['scripts'];
    scriptDebugMode: boolean;
    formattingDebugMode: boolean;
    keywordCase: dashql.buffers.formatting.KeywordCase;
    focusedFileName: string;
    active: boolean;
    onFocus: (fileName: string) => void;
    onDelete: (fileName: string) => void;
    onRename: (oldFileName: string, newFileName: string) => void;
    onPickConnection: (fileName: string, connectionId: string) => void;
    onMoveUp: (fileName: string) => void;
    onMoveDown: (fileName: string) => void;
    onExecute: (fileName: string) => void;
    onRerun: (fileName: string) => void;
    onFormat: (scriptKey: number, text: string) => void;
    /// Replace the text of a script with the text of a snippet
    onApplySnippet: (scriptKey: number, text: string) => void;
    /// Write a Vega-Lite spec of the chart builder into the `@vis vegalite` tag of a script
    onSetVisSpec: (scriptKey: number, spec: string) => void;
    /// Can a question of the composer target the scripts?
    /// The checked script references of the scripts, by script key
    scriptReferences?: ReadonlyMap<number, ScriptReferenceReport>;
    canTarget: boolean;
    /// Reference a script in the question of the composer
    onTarget: (fileName: string) => void;
    onAcceptDiff: (scriptKey: number) => void;
    onRejectDiff: (scriptKey: number) => void;
    collapsedResults: ReadonlyMap<number, number | null>;
    onToggleResultExpanded: (scriptKey: number) => void;
    onAutoCollapseResult: (scriptKey: number, queryId: number) => void;
    onResetAutoCollapsedResult: (scriptKey: number, queryId: number | null) => void;
    onCreate: (index: number) => void;
    onEditorView: (scriptKey: number, view: EditorView) => void;
    onRowHeightChange: (index: number, height: number) => void;
    dependencies?: ScriptFeedRowDependencies;
}

export interface ScriptFeedRowDependencies {
    useSortable: typeof useSortable;
    translateTransform: typeof CSS.Translate.toString;
    scriptCard: ScriptCardDependencies;
}

const DEFAULT_SCRIPT_FEED_ROW_DEPENDENCIES: ScriptFeedRowDependencies = {
    useSortable,
    translateTransform: CSS.Translate.toString,
    scriptCard: DEFAULT_SCRIPT_CARD_DEPENDENCIES,
};

export function ScriptFeedRow(props: RowComponentProps<ScriptFeedRowProps>) {
    const dependencies = props.dependencies ?? DEFAULT_SCRIPT_FEED_ROW_DEPENDENCIES;
    const entryIndex = props.index;
    const entry = props.entries[entryIndex];
    const scriptData = entry != null ? props.scripts[entry.scriptId] : undefined;
    const scriptFileName = entry?.fileName ?? 'script.sql';
    const displayName = scriptDisplayName(scriptFileName);
    // Every script runs on its own connection
    const connection = scriptData != null ? props.connections.get(scriptData.connection.connectionId) ?? null : null;

    // Entries are in feed order, so the index drives the movement buttons
    const canMoveUp = entryIndex > 0;
    const canMoveDown = entryIndex < props.entries.length - 1;
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = dependencies.useSortable({
        id: entry?.scriptId ?? `missing-${entryIndex}`,
        // The optimistic order is already the final dropped layout. Suppress dnd-kit's derived
        // post-drop FLIP transform, which otherwise briefly animates the card back toward its old row.
        animateLayoutChanges: () => false,
    });
    const rowRef = React.useRef<HTMLDivElement | null>(null);
    const setRowRef = React.useCallback((node: HTMLDivElement | null) => {
        rowRef.current = node;
        setNodeRef(node);
    }, [setNodeRef]);
    // The height cache stores the height of the script at the index of a row.
    // A row measures again when its index or its script changes, its size may not change and the size observer stays silent.
    const rowScriptId = entry?.scriptId;
    React.useLayoutEffect(() => {
        const row = rowRef.current;
        if (row == null) return;
        const syncHeight = () => {
            const height = Math.ceil(row.getBoundingClientRect().height);
            if (height > 0) props.onRowHeightChange(props.index, height);
        };
        syncHeight();
        const observer = new ResizeObserver(syncHeight);
        observer.observe(row);
        return () => observer.disconnect();
    }, [props.index, rowScriptId, props.onRowHeightChange]);

    // The row holds the card and the space below it, the first row also the space above the feed.
    // The add buttons sit in these spaces, a button between two scripts shows while either one is hovered.
    return (
        <div
            className={styles.feed_row}
            style={{ ...props.style, paddingTop: props.index === 0 ? FEED_TOP_PADDING : undefined }}
            data-testid="script-feed-row"
        >
            <div
                ref={setRowRef}
                className={styles.feed_list_item}
                data-testid="script-feed-item"
                data-script-key={entry?.scriptId}
                style={{
                    // dnd-kit may scale the active item toward a differently sized target row.
                    // Feed cards have variable heights, so scaling visibly squashes or stretches them.
                    transform: dependencies.translateTransform(transform),
                    transition,
                    zIndex: isDragging ? 1 : undefined,
                }}
            >
                <button
                    type="button"
                    className={styles.feed_entry_insert}
                    data-edge="above"
                    aria-label={`Add script above ${displayName}`}
                    data-testid="script-insert-above"
                    onClick={() => props.onCreate(entryIndex)}
                >
                    <PlusIcon size={14} />
                </button>
                <button
                    type="button"
                    className={styles.feed_entry_drag_handle}
                    aria-label={`Drag ${displayName} script to reorder`}
                    data-testid="script-drag-handle"
                    {...attributes}
                    {...listeners}
                >
                    <DragHandleIcon size={16} />
                </button>
                <ScriptCard
                    key={entry?.scriptId}
                    sessionId={props.sessionId}
                    connectionId={scriptData?.connection.connectionId ?? null}
                    connectionHealth={connection?.connectionHealth ?? null}
                    connectionDetails={connection?.details ?? null}
                    connectorType={scriptData?.connection.connectorInfo.connectorType ?? ConnectorType.HYPER}
                    connection={connection}
                    computeCacheKey={props.computeCacheKey}
                    lookupCachedResult={props.lookupCachedResult}
                    storageReader={props.storageReader}
                    isFocused={scriptFileName === props.focusedFileName}
                    scriptData={scriptData}
                    scriptFileName={scriptFileName}
                    scriptDebugMode={props.scriptDebugMode}
                    formattingDebugMode={props.formattingDebugMode}
                    keywordCase={props.keywordCase}
                    canExecute={scriptData != null && connection?.connectionHealth === ConnectionHealth.ONLINE}
                    active={props.active}
                    canMoveUp={canMoveUp}
                    canMoveDown={canMoveDown}
                    index={entryIndex}
                    onCreate={props.onCreate}
                    onFocus={props.onFocus}
                    onDelete={props.onDelete}
                    onRename={props.onRename}
                    onPickConnection={props.onPickConnection}
                    onMoveUp={props.onMoveUp}
                    onMoveDown={props.onMoveDown}
                    onExecute={props.onExecute}
                    onRerun={props.onRerun}
                    onFormat={props.onFormat}
                    onApplySnippet={props.onApplySnippet}
                    onSetVisSpec={props.onSetVisSpec}
                    canTarget={props.canTarget}
                    scriptReferences={scriptData != null ? props.scriptReferences?.get(scriptData.scriptKey) ?? null : null}
                    onTarget={props.onTarget}
                    onAcceptDiff={props.onAcceptDiff}
                    onRejectDiff={props.onRejectDiff}
                    resultExpanded={scriptData == null || !props.collapsedResults.has(scriptData.scriptKey)}
                    onToggleResultExpanded={props.onToggleResultExpanded}
                    onAutoCollapseResult={props.onAutoCollapseResult}
                    onResetAutoCollapsedResult={props.onResetAutoCollapsedResult}
                    onEditorView={props.onEditorView}
                    dependencies={dependencies.scriptCard}
                />
                <button
                    type="button"
                    className={styles.feed_entry_insert}
                    data-edge="below"
                    aria-label={`Add script below ${displayName}`}
                    data-testid="script-insert-below"
                    onClick={() => props.onCreate(entryIndex + 1)}
                >
                    <PlusIcon size={14} />
                </button>
            </div>
        </div>
    );
}
