import * as React from 'react';
import * as styles from './notebook_feed.module.css';
import * as dashql from '../../../../core/index.js';

import type { EditorView } from '@codemirror/view';
import type { Icon } from '../../../../ui/foundations/symbol_icon.js';
import { PaperAirplaneIcon, PlusIcon, SquareFillIcon } from '../../../../ui/foundations/symbol_icon.js';
import type { RowComponentProps } from 'react-window';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { ButtonSize, ButtonVariant, IconButton } from '../../../../ui/foundations/button.js';
import { ButtonGroup } from '../../../../ui/foundations/button_group.js';
import { IndicatorStatus } from '../../../../ui/foundations/status_indicator.js';
import { SymbolIcon } from '../../../../ui/foundations/symbol_icon.js';
import { useAgentRunState, useCancelAgentRun } from '../../agent/agent_run_provider.js';
import type { AttachedDatabaseState } from '../../connections/attached_database_state.js';
import { QueryExecutionStatus, queryIsDone } from '../../connections/query_execution_state.js';
import { computeQueryCacheKeyForConnection, useCancelQuery, useQueryState } from '../../connections/query_executor.js';
import type { StorageReader } from '../../persistence/storage_provider.js';
import { compileNotebookQuery, getSelectedScriptRefs, type NotebookScripts, type ScriptData } from '../../scripts/notebook_scripts.js';
import { scriptDisplayName } from '../../scripts/script_types.js';
import { deriveEntryStatus, EntryStatusKind } from '../entry_status_model.js';
import { EntryStatusBar } from '../entry_status_bar.js';
import { CachedResultBean, QueryResultCacheLabel, QueryResultRerunButton } from '../query_result_cache_controls.js';
import { ScriptDiagnosticsButton } from '../script_diagnostics.js';
import { ScriptName } from '../script_name.js';
import { ScriptEditor } from '../script_editor.js';
import { ScriptStatisticsBar } from '../script_statistics_bar.js';
import { formatScriptEditor, isScriptFormattable } from '../script_format.js';
import { FeedEntryFooter } from './feed_entry_footer.js';
import { ScriptActionMenu } from '../script_action_menu.js';

const DragHandleIcon: Icon = SymbolIcon('drag_handle_16');

export interface ScriptCardProps {
    notebookId: string;
    connection: AttachedDatabaseState | null;
    storageReader: StorageReader;
    isFocused: boolean;
    scriptData: ScriptData | undefined;
    scriptFileName: string;
    scriptDebugMode: boolean;
    formattingDebugMode: boolean;
    canExecute: boolean;
    canDelete: boolean;
    active: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onFocus: (fileName: string) => void;
    onDelete: (fileName: string) => void;
    onRename: (oldFileName: string, newFileName: string) => void;
    onMoveUp: (fileName: string) => void;
    onMoveDown: (fileName: string) => void;
    onExecute: (fileName: string) => void;
    onShowStatus: (fileName: string) => void;
    onShowAgentStatus: (fileName: string) => void;
    onShowTable: (fileName: string) => void;
    onShowVisualization: (fileName: string) => void;
    onShowDetails: (fileName: string) => void;
    onRerun: (fileName: string, cacheKey: string | null) => void;
    onAcceptDiff: (scriptKey: number) => void;
    onRejectDiff: (scriptKey: number) => void;
    resultExpanded: boolean;
    onToggleResultExpanded: (scriptKey: number) => void;
    onAutoCollapseResult: (scriptKey: number, queryId: number) => void;
    onResetAutoCollapsedResult: (scriptKey: number, queryId: number | null) => void;
    onEditorView: (scriptKey: number, view: EditorView) => void;
}

export const ScriptCard: React.FC<ScriptCardProps> = (props: ScriptCardProps) => {
    const MoveUpIcon: Icon = SymbolIcon('chevron_up_16');
    const MoveDownIcon: Icon = SymbolIcon('chevron_down_16');
    const PencilIcon: Icon = SymbolIcon('pencil_16');
    const CheckIcon: Icon = SymbolIcon('check_16');
    const CrossIcon: Icon = SymbolIcon('x_16');
    const ExpandIcon: Icon = SymbolIcon('screen_full_16');

    const queryState = useQueryState(props.notebookId, props.scriptData?.latestQueryId ?? null);
    const cancelQuery = useCancelQuery();
    const cancelAgentRun = useCancelAgentRun();
    const queryActive = queryState != null && !queryIsDone(queryState.status);

    // Resolve the agent run by its id (handle) just like the query above — the run carries its
    // own trace id, so the footer no longer needs a denormalized trace id on ScriptData.
    const agentRunState = useAgentRunState(props.scriptData?.latestAgentRunId ?? null);
    const agentTraceId = agentRunState?.traceId ?? null;

    // A staged agent rewrite waiting to be accepted/rejected. The editable editor renders the
    // in-place diff and these actions provide the same explicit accept/reject alternatives.
    const hasPendingDiff = props.scriptData?.pendingDiff != null;

    // Is the script cached?
    const [isCached, setIsCached] = React.useState<boolean | null>(null);
    React.useEffect(() => {
        const cancel = new AbortController();
        const wasCached = isCached;
        const run = async () => {
            // Not script data? Clear cache indicator.
            if (props.scriptData == null || props.scriptData.analysisOutdated || !props.connection?.details) {
                if ((wasCached == null || wasCached) && !cancel.signal.aborted) {
                    setIsCached(null);
                }
                return;
            }
            try {
                // Compile the query
                const compiled = compileNotebookQuery(props.scriptData);
                if (!compiled.cacheable) {
                    setIsCached(false);
                    return;
                }
                // Compute the query cache key
                const cacheKey = await computeQueryCacheKeyForConnection(props.connection.details, compiled.cacheSignature);
                // Cache key is null, then clear the cache if required
                if (cacheKey == null) {
                    if ((wasCached == null || wasCached) && !cancel.signal.aborted) {
                        setIsCached(false);
                    }
                    return;
                }
                // Check with storage if the query is cached
                const isCached = await props.storageReader.backend.hasCachedQueryResult(props.notebookId, cacheKey);
                if (!cancel.signal.aborted) {
                    setIsCached(isCached);
                }
            } catch { }
        };
        run();
        return () => cancel.abort();
    }, [props.scriptData, props.connection?.details, props.notebookId]);

    // The result header persists for active and terminal execution states. It can collapse the
    // result body without affecting its cancel, cache, and rerun actions.
    const entryStatus = deriveEntryStatus(agentRunState, queryState);
    const scriptKey = props.scriptData?.scriptKey ?? null;
    React.useEffect(() => {
        if (scriptKey == null) return;
        if (queryState?.status !== QueryExecutionStatus.SUCCEEDED || queryState.resultTable !== null) {
            props.onResetAutoCollapsedResult(scriptKey, queryState?.queryId ?? props.scriptData?.latestQueryId ?? null);
            return;
        }
        props.onAutoCollapseResult(scriptKey, queryState.queryId);
    }, [props.onAutoCollapseResult, props.onResetAutoCollapsedResult, props.scriptData?.latestQueryId, queryState, scriptKey]);
    const cancelEntryOperation = React.useCallback(() => {
        if (entryStatus?.kind === EntryStatusKind.Agent) {
            cancelAgentRun(props.notebookId);
        } else if (entryStatus?.kind === EntryStatusKind.Query && props.scriptData?.latestQueryId != null) {
            if (props.connection != null) cancelQuery(props.connection.databaseId, props.scriptData.latestQueryId);
        }
    }, [cancelAgentRun, cancelQuery, entryStatus?.kind, props.scriptData?.latestQueryId, props.notebookId]);

    const acceptDiff = React.useCallback(() => {
        if (scriptKey != null) props.onAcceptDiff(scriptKey);
    }, [scriptKey, props.onAcceptDiff]);
    const rejectDiff = React.useCallback(() => {
        if (scriptKey != null) props.onRejectDiff(scriptKey);
    }, [scriptKey, props.onRejectDiff]);

    const [isEditing, setIsEditing] = React.useState(false);
    const [editorView, setEditorView] = React.useState<EditorView | null>(null);
    const isFormattable = React.useMemo(
        () => isScriptFormattable(props.scriptData ?? null),
        [props.scriptData?.scriptSession, props.scriptData?.editorUpdate?.stateRevision],
    );
    const handleEditorView = React.useCallback((view: EditorView) => {
        setEditorView(view);
        if (props.scriptData != null) props.onEditorView(props.scriptData.scriptKey, view);
    }, [props.onEditorView, props.scriptData?.scriptKey]);
    const handleFormat = React.useCallback((mode: dashql.buffers.formatting.FormattingMode) => {
        formatScriptEditor(
            editorView,
            props.scriptData ?? null,
            mode,
            props.formattingDebugMode,
        );
    }, [editorView, props.formattingDebugMode, props.scriptData]);

    // The label and the rename input show the clean display name (no ordering prefix, no ".sql");
    // the raw scriptFileName remains the identity passed to handlers and to RENAME_SCRIPT.
    const displayName = scriptDisplayName(props.scriptFileName);
    const [draftFileName, setDraftFileName] = React.useState(displayName);
    const editInputRef = React.useRef<HTMLInputElement>(null);

    const startEditing = React.useCallback((event: React.MouseEvent) => {
        event.stopPropagation();
        setDraftFileName(displayName);
        setIsEditing(true);
    }, [displayName]);

    const saveEdit = React.useCallback(() => {
        const trimmed = draftFileName.trim();
        if (trimmed && trimmed !== displayName) {
            props.onRename(props.scriptFileName, trimmed);
        }
        setIsEditing(false);
    }, [draftFileName, displayName, props.scriptFileName, props.onRename]);

    const cancelEdit = React.useCallback(() => {
        setIsEditing(false);
    }, []);

    React.useEffect(() => {
        if (isEditing && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [isEditing]);

    const resultContentId = props.scriptData != null ? `feed-result-${props.scriptData.scriptKey}` : undefined;
    const hasFooterContent = entryStatus.kind !== EntryStatusKind.Idle;
    return (
        <article
            className={styles.feed_entry_pair}
            data-electron-drag-region="false"
            onPointerEnter={() => props.onFocus(props.scriptFileName)}
            aria-label={`${displayName} script cell`}
        >
            <div className={styles.feed_entry_cell} data-result-card={hasFooterContent ? '' : undefined}>
                <div className={styles.feed_entry_action_bar}>
                    <IconButton
                        className={props.isFocused ? undefined : styles.feed_entry_execute_unfocused}
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label={queryActive ? `Stop ${displayName} query` : `Execute ${displayName} query`}
                        aria-current={props.isFocused ? 'true' : undefined}
                        disabled={!queryActive && !props.canExecute}
                        onClick={() => {
                            if (queryActive && props.scriptData?.latestQueryId != null) {
                                if (props.connection != null) cancelQuery(props.connection.databaseId, props.scriptData.latestQueryId);
                            } else {
                                props.onExecute(props.scriptFileName);
                            }
                        }}
                    >
                        {queryActive ? <SquareFillIcon size={14} /> : <PaperAirplaneIcon size={16} />}
                    </IconButton>
                    <div className={styles.feed_entry_file_name}>
                        <ScriptName
                            file={displayName}
                            onFileClick={startEditing}
                            editing={isEditing ? {
                                value: draftFileName,
                                onChange: setDraftFileName,
                                onCommit: saveEdit,
                                onCancel: cancelEdit,
                                inputRef: editInputRef,
                            } : undefined}
                            fileNameTrailing={
                                <span className={styles.feed_entry_actions}>
                                    <PencilIcon size={12} />
                                </span>
                            }
                        />
                    </div>
                    {props.scriptDebugMode && props.scriptData != null && (
                        <div className={styles.feed_entry_stats_bar}>
                            <ScriptStatisticsBar stats={props.scriptData.statistics} />
                        </div>
                    )}
                    {props.scriptData != null && (
                        <ScriptDiagnosticsButton
                            scriptData={props.scriptData}
                            isFormattable={isFormattable}
                        />
                    )}
                    <ScriptActionMenu
                        scriptName={displayName}
                        formatDisabled={!isFormattable || hasPendingDiff || editorView == null}
                        deleteDisabled={!props.canDelete}
                        onFormat={handleFormat}
                        onDelete={() => props.onDelete(props.scriptFileName)}
                    />
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        onClick={(event) => { event.stopPropagation(); props.onMoveUp(props.scriptFileName); }}
                        aria-label="Move script up"
                        disabled={!props.canMoveUp}
                    >
                        <MoveUpIcon size={16} />
                    </IconButton>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        onClick={(event) => { event.stopPropagation(); props.onMoveDown(props.scriptFileName); }}
                        aria-label="Move script down"
                        disabled={!props.canMoveDown}
                    >
                        <MoveDownIcon size={16} />
                    </IconButton>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        onClick={() => props.onShowDetails(props.scriptFileName)}
                        aria-label={`Expand ${displayName} script details`}
                    >
                        <ExpandIcon size={16} />
                    </IconButton>
                </div>
                <div className={styles.feed_body}>
                    <div className={styles.feed_editor_container}>
                        {props.scriptData == null || !props.active ? null : (
                            <ScriptEditor
                                notebookId={props.notebookId}
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
                                        >
                                            <CheckIcon size={14} />
                                        </IconButton>
                                        <IconButton
                                            variant={ButtonVariant.Default}
                                            size={ButtonSize.Small}
                                            onClick={rejectDiff}
                                            aria-label="Reject rewrite"
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
                    <div className={styles.feed_entry_footer}>
                        <EntryStatusBar
                            status={entryStatus}
                            onToggleExpanded={() => {
                                if (scriptKey != null) props.onToggleResultExpanded(scriptKey);
                            }}
                            expanded={props.resultExpanded}
                            controls={resultContentId}
                            onCancel={entryStatus.indicator === IndicatorStatus.Running ? cancelEntryOperation : undefined}
                            cancelLabel={entryStatus.kind === EntryStatusKind.Agent ? 'Cancel agent run' : 'Cancel query'}
                            compact
                            actions={
                                <>
                                    {isCached && <CachedResultBean />}
                                    <QueryResultCacheLabel query={queryState} />
                                    <QueryResultRerunButton
                                        query={queryState}
                                        onRerun={(cacheKey) => props.onRerun(props.scriptFileName, cacheKey)}
                                    />
                                </>
                            }
                        />
                        {(queryState != null || agentTraceId != null) ? (
                            <div id={resultContentId} hidden={!props.resultExpanded}>
                                <FeedEntryFooter
                                    notebookId={props.notebookId}
                                    queryState={queryState}
                                    agentTraceId={agentTraceId}
                                    visualizeQuery={props.scriptData?.annotations.visualizeQuery ?? null}
                                    onShowStatus={() => props.onShowStatus(props.scriptFileName)}
                                    onShowAgentStatus={() => props.onShowAgentStatus(props.scriptFileName)}
                                    onShowTable={() => props.onShowTable(props.scriptFileName)}
                                    onShowVisualization={() => props.onShowVisualization(props.scriptFileName)}
                                />
                            </div>
                        ) : null}
                    </div>
                )}
            </div>
        </article>
    );
};

export interface ScriptFeedRowProps {
    notebookId: string;
    connection: AttachedDatabaseState | null;
    storageReader: StorageReader;
    entries: ReturnType<typeof getSelectedScriptRefs>;
    scripts: NotebookScripts['scripts'];
    scriptDebugMode: boolean;
    formattingDebugMode: boolean;
    focusedFileName: string;
    canDelete: boolean;
    active: boolean;
    onFocus: (fileName: string) => void;
    onDelete: (fileName: string) => void;
    onRename: (oldFileName: string, newFileName: string) => void;
    onMoveUp: (fileName: string) => void;
    onMoveDown: (fileName: string) => void;
    onExecute: (fileName: string) => void;
    onShowStatus: (fileName: string) => void;
    onShowAgentStatus: (fileName: string) => void;
    onShowTable: (fileName: string) => void;
    onShowVisualization: (fileName: string) => void;
    onShowDetails: (fileName: string) => void;
    onRerun: (fileName: string, cacheKey: string | null) => void;
    onAcceptDiff: (scriptKey: number) => void;
    onRejectDiff: (scriptKey: number) => void;
    collapsedResults: ReadonlyMap<number, number | null>;
    onToggleResultExpanded: (scriptKey: number) => void;
    onAutoCollapseResult: (scriptKey: number, queryId: number) => void;
    onResetAutoCollapsedResult: (scriptKey: number, queryId: number | null) => void;
    topPadding: number;
    onCreate: (index: number) => void;
    onEditorView: (scriptKey: number, view: EditorView) => void;
    onRowHeightChange: (index: number, height: number) => void;
}

export function ScriptFeedRow(props: RowComponentProps<ScriptFeedRowProps>) {
    const isSeparator = props.index % 2 === 0;
    const entryIndex = Math.floor(props.index / 2);
    const entry = !isSeparator ? props.entries[entryIndex] : undefined;
    const scriptData = entry != null ? props.scripts[entry.scriptId] : undefined;
    const scriptFileName = entry?.fileName ?? '01-script.sql';

    // Entries are in feed order, so the index drives the movement buttons
    const canMoveUp = !isSeparator && entryIndex > 0;
    const canMoveDown = !isSeparator && entryIndex < props.entries.length - 1;
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: entry?.scriptId ?? `separator-${entryIndex}`,
        disabled: { draggable: isSeparator, droppable: isSeparator },
        // The optimistic order is already the final dropped layout. Suppress dnd-kit's derived
        // post-drop FLIP transform, which otherwise briefly animates the card back toward its old row.
        animateLayoutChanges: () => false,
    });
    const rowRef = React.useRef<HTMLDivElement | null>(null);
    const setRowRef = React.useCallback((node: HTMLDivElement | null) => {
        rowRef.current = node;
        setNodeRef(node);
    }, [setNodeRef]);
    React.useLayoutEffect(() => {
        if (isSeparator) return;
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
    }, [isSeparator, props.index, props.onRowHeightChange]);

    if (isSeparator) {
        return (
            <div
                className={styles.feed_cell_separator}
                style={{
                    ...props.style,
                    paddingTop: props.index === 0 ? props.topPadding : undefined,
                }}
            >
                <span className={styles.feed_cell_separator_line} aria-hidden="true" />
                <button
                    type="button"
                    className={styles.feed_cell_add}
                    aria-label={`Add script at position ${entryIndex + 1}`}
                    onClick={() => props.onCreate(entryIndex)}
                >
                    <PlusIcon size={16} />
                </button>
            </div>
        );
    }

    return (
        <div
            style={props.style}
        >
            <div
                ref={setRowRef}
                className={styles.feed_list_item}
                style={{
                    // dnd-kit may scale the active item toward a differently sized target row.
                    // Feed cards have variable heights, so scaling visibly squashes or stretches them.
                    transform: CSS.Translate.toString(transform),
                    transition,
                    zIndex: isDragging ? 1 : undefined,
                }}
            >
                <button
                    type="button"
                    className={styles.feed_entry_drag_handle}
                    aria-label={`Drag ${scriptDisplayName(scriptFileName)} script to reorder`}
                    {...attributes}
                    {...listeners}
                >
                    <DragHandleIcon size={16} />
                </button>
                <ScriptCard
                    key={entry?.scriptId}
                    notebookId={props.notebookId}
                    connection={props.connection}
                    storageReader={props.storageReader}
                    isFocused={scriptFileName === props.focusedFileName}
                    scriptData={scriptData}
                    scriptFileName={scriptFileName}
                    scriptDebugMode={props.scriptDebugMode}
                    formattingDebugMode={props.formattingDebugMode}
                    canExecute={scriptData != null && props.connection != null}
                    canDelete={props.canDelete}
                    active={props.active}
                    canMoveUp={canMoveUp}
                    canMoveDown={canMoveDown}
                    onFocus={props.onFocus}
                    onDelete={props.onDelete}
                    onRename={props.onRename}
                    onMoveUp={props.onMoveUp}
                    onMoveDown={props.onMoveDown}
                    onExecute={props.onExecute}
                    onShowStatus={props.onShowStatus}
                    onShowAgentStatus={props.onShowAgentStatus}
                    onShowTable={props.onShowTable}
                    onShowVisualization={props.onShowVisualization}
                    onShowDetails={props.onShowDetails}
                    onRerun={props.onRerun}
                    onAcceptDiff={props.onAcceptDiff}
                    onRejectDiff={props.onRejectDiff}
                    resultExpanded={scriptData == null || !props.collapsedResults.has(scriptData.scriptKey)}
                    onToggleResultExpanded={props.onToggleResultExpanded}
                    onAutoCollapseResult={props.onAutoCollapseResult}
                    onResetAutoCollapsedResult={props.onResetAutoCollapsedResult}
                    onEditorView={props.onEditorView}
                />
            </div>
        </div>
    );
}
