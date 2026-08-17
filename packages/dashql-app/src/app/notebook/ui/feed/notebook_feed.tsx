import * as React from 'react';
import * as styles from './notebook_feed.module.css';

import type { EditorView } from '@codemirror/view';
import type { Icon } from '@primer/octicons-react';
import { CodeIcon, ComposeIcon, PaperAirplaneIcon, SparklesFillIcon, SquareFillIcon, XIcon } from '@primer/octicons-react';
import symbols from '@ankoh/dashql-svg-symbols';

import { useAppConfig } from '../../../config/app_config.js';
import { ScriptStatisticsBar } from '../script_statistics_bar.js';

import { List, useListRef } from 'react-window';
import type { RowComponentProps } from 'react-window';

import { ButtonSize, ButtonVariant, IconButton } from '../../../../shared/ui/foundations/button.js';
import { ButtonGroup } from '../../../../shared/ui/foundations/button_group.js';
import { ConnectionHealth, ConnectionState } from '../../connections/connection_state.js';
import { compileQuery, getSelectedScriptRef, getSelectedScriptFolder, getSelectedScriptRefs, getSortedScriptFileNames, getUncommittedScriptData, type ScriptData, NotebookScripts, SELECT_SCRIPT, PROMOTE_UNCOMMITTED_SCRIPT, DELETE_SCRIPT, RENAME_SCRIPT, REORDER_SCRIPTS, ACCEPT_PENDING_DIFF, REJECT_PENDING_DIFF } from '../../scripts/notebook_scripts.js';
import { useAIClient } from '../../agent/ai/ai_client_provider.js';
import { COMPOSE_INPUT_MODE_AI, useComposeInputMode } from '../../scripts/notebook_commands.js';
import { useLatestAgentRunState, useAgentRunState, useStartAgentRun, useCancelAgentRun } from '../../agent/agent_run_provider.js';
import { AgentRunPhase, agentRunIsActive } from '../../agent/agent_run_state.js';
import { OutputColumn } from '../../scripts/script_agent_context.js';
import { createNotebookScriptsAgentHost } from '../../scripts/script_agent_host.js';
import { QueryType, queryIsDone } from '../../connections/query_execution_state.js';
import { computeQueryCacheKeyForConnection, useCancelQuery, useQueryExecutor, useQueryState } from '../../connections/query_executor.js';
import { SymbolIcon } from '../../../../shared/ui/foundations/symbol_icon.js';
import { ScriptEditor } from '../script_editor.js';
import { PromptEditor } from '../prompt_editor.js';
import { ScriptPreview } from '../script_preview.js';
import { observeSize } from '../../../../shared/ui/foundations/size_observer.js';
import type { ModifyNotebookScripts } from '../../scripts/notebook_scripts_registry.js';
import { normalizeScriptFolderName, projectionForVisualizeQuery, scriptDisplayName } from '../../scripts/script_types.js';
import { type KeyEventHandler, useKeyEvents } from '../../../../shared/utils/key_events.js';
import { useScrollbarWidth } from '../../../../shared/utils/scrollbar.js';
import { SegmentedControl, SegmentedControlSize } from '../../../../shared/ui/foundations/segmented_control.js';
import { ScriptName } from '../script_name.js';
import { IndicatorStatus, StatusIndicator } from '../../../../shared/ui/foundations/status_indicator.js';
import { EntryStatusBar } from '../entry_status_bar.js';
import { deriveEntryStatus, EntryStatusKind } from '../entry_status_model.js';
import { FeedEntryFooter } from './feed_entry_footer.js';
import { TabKey as DetailsTabKey } from '../script_details.js';
import { registerNotebookScriptQuery, runNotebookScript } from '../rerun_query.js';
import { useStorageReader, StorageReader } from '../../persistence/storage_provider.js';
import { STORAGE_CACHE_EXTENSION } from '../../persistence/storage_backend.js';
import { CachedResultBean, QueryResultCacheLabel, QueryResultRerunButton } from '../query_result_cache_controls.js';
import { useLogger } from '../../../../shared/platform/logger/logger_provider.js';
import { ScriptDiagnosticsButton } from '../script_diagnostics.js';
import { ConnectionStateDetailsVariant } from '../../connections/connection_state_details';

interface FeedScrollTarget {
    fileName: string;
    version: number;
}

export interface NotebookFeedProps {
    notebookScripts: NotebookScripts;
    modifyNotebookScripts: ModifyNotebookScripts;
    showDetails: (fileName?: string, initialTab?: DetailsTabKey) => void;
    scrollTarget?: FeedScrollTarget | null;
    conn: ConnectionState | null;
    openConnectionOverlay: () => void;
    /// Whether the feed is the visible, interactive layer. The feed stays mounted (just hidden) while
    /// the catalog/details overlay is open so it keeps its scroll position and measured row heights;
    /// while inactive its global key handlers must stand down so Escape/Enter belong to the overlay.
    active: boolean;
}

const ESTIMATED_ROW_HEIGHT = 240;
const HEIGHT_CHANGE_EPSILON = 0.5;
const OVERSCAN_ROW_COUNT = 16;
const FEED_TOP_PADDING = 24;
const FEED_MOBILE_TOP_PADDING = 8;
const FEED_BOTTOM_PADDING = 8;
const FEED_BOTTOM_FADE_HEIGHT = 24;

interface ScriptPreviewHint {
    height?: number;
    formattedText?: string;
}

/// Resolve the output columns (result schema) a script produced on its most recent execution, for
/// the agent's visualize context. Output columns only exist after execution, so this reads the
/// script's latest query from the connection state; it returns null when the script has never run
/// or its result schema isn't available yet.
function outputColumnsForScript(
    notebookScripts: NotebookScripts,
    conn: ConnectionState | null,
    scriptKey: number,
): OutputColumn[] | null {
    const queryId = notebookScripts.scripts[scriptKey]?.latestQueryId ?? null;
    if (conn == null || queryId == null) return null;
    const query = conn.queriesActive.get(queryId) ?? conn.queriesFinished.get(queryId) ?? null;
    const schema = query?.resultSchema ?? null;
    if (schema == null) return null;
    return schema.fields.map(f => ({ name: f.name, type: f.type?.toString() ?? null }));
}

interface CollapsedScriptCardProps {
    notebookId: string;
    connection: ConnectionState | null;
    storageReader: StorageReader;
    isFocused: boolean;
    scriptData: ScriptData | undefined;
    folderName: string;
    scriptFileName: string;
    scriptDebugMode: boolean;
    canExecute: boolean;
    canUseAI: boolean;
    canDelete: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onFocus: (fileName: string) => void;
    onExpand: (fileName: string) => void;
    onDelete: (fileName: string) => void;
    onRename: (oldFileName: string, newFileName: string) => void;
    onMoveUp: (fileName: string) => void;
    onMoveDown: (fileName: string) => void;
    onExecute: (fileName: string) => void;
    onUseAIContext: (scriptKey: number) => void;
    onShowStatus: (fileName: string) => void;
    onShowAgentStatus: (fileName: string) => void;
    onShowTable: (fileName: string) => void;
    onShowVisualization: (fileName: string) => void;
    onRerun: (fileName: string, cacheKey: string | null) => void;
    onAcceptDiff: (scriptKey: number) => void;
    onRejectDiff: (scriptKey: number) => void;
    onPreviewReady: () => void;
    initialPreviewText: string;
    onFormattedText: (scriptText: string) => void;
}

const ScriptCard: React.FC<CollapsedScriptCardProps> = (props: CollapsedScriptCardProps) => {
    const TrashIcon: Icon = SymbolIcon('trash_16');
    const MoveUpIcon: Icon = SymbolIcon('chevron_up_16');
    const MoveDownIcon: Icon = SymbolIcon('chevron_down_16');
    const PersonIcon: Icon = SymbolIcon('person_16');
    const PencilIcon: Icon = SymbolIcon('pencil_16');
    const CheckIcon: Icon = SymbolIcon('check_16');
    const CrossIcon: Icon = SymbolIcon('x_16');

    const queryState = useQueryState(props.notebookId, props.scriptData?.latestQueryId ?? null);
    const cancelQuery = useCancelQuery();
    const cancelAgentRun = useCancelAgentRun();
    const queryActive = queryState != null && !queryIsDone(queryState.status);

    // Resolve the agent run by its id (handle) just like the query above — the run carries its
    // own trace id, so the footer no longer needs a denormalized trace id on ScriptData.
    const agentRunState = useAgentRunState(props.scriptData?.latestAgentRunId ?? null);
    const agentTraceId = agentRunState?.traceId ?? null;

    // A staged agent rewrite waiting to be accepted/rejected. While set, the read-only preview
    // renders the rewrite as a compact in-place diff overlay and the body carries an Accept/Reject
    // overlay (which dispatch notebookScripts actions — no editable editor is mounted).
    const hasPendingDiff = props.scriptData?.pendingDiff != null;

    // Is the script cached?
    const [isCached, setIsCached] = React.useState<boolean | null>(null);
    React.useEffect(() => {
        const cancel = new AbortController();
        const wasCached = isCached;
        const run = async () => {
            // Not script data? Clear cache indicator.
            if (props.scriptData == null || !props.connection?.details) {
                if ((wasCached == null || wasCached) && !cancel.signal.aborted) {
                    setIsCached(null);
                }
                return;
            }
            try {
                // Compile the query
                const compiled = compileQuery(props.scriptData);
                // Compute the query cache key
                const cacheKey = await computeQueryCacheKeyForConnection(props.connection.details, compiled);
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

    // The status bar above the body generalizes the former "AI bar": while any work is in flight —
    // an agent run *or* a query execution — it's a compact strip (spinner + latest log line / query
    // status) instead of yanking the user to the raw trace. The body keeps rendering the current
    // output; the user opts into the full trace by clicking the bar. The bar persists across idle,
    // running, and terminal states. A staged rewrite doesn't feed it — Accept/Reject controls live on the
    // body overlay — so the bar stays free to show the rewritten statement's re-execution status.
    const entryStatus = deriveEntryStatus(agentRunState, queryState);
    const cancelEntryOperation = React.useCallback(() => {
        if (entryStatus?.kind === EntryStatusKind.Agent) {
            cancelAgentRun(props.notebookId);
        } else if (entryStatus?.kind === EntryStatusKind.Query && props.scriptData?.latestQueryId != null) {
            cancelQuery(props.notebookId, props.scriptData.latestQueryId);
        }
    }, [cancelAgentRun, cancelQuery, entryStatus?.kind, props.scriptData?.latestQueryId, props.notebookId]);

    // A monotonic nonce handed to the footer: bumped when the user clicks the status bar so the
    // footer reveals the matching trace's Log tab on demand (work no longer auto-switches it). The
    // clicked source (query vs agent) rides along so the footer reveals the right trace.
    const [logRequest, setLogRequest] = React.useState<{ nonce: number; traceId: number | null }>({ nonce: 0, traceId: null });
    const showLog = React.useCallback((traceId: number | null) => setLogRequest(prev => ({ nonce: prev.nonce + 1, traceId })), []);
    const scriptKey = props.scriptData?.scriptKey ?? null;
    const acceptDiff = React.useCallback(() => {
        if (scriptKey != null) props.onAcceptDiff(scriptKey);
    }, [scriptKey, props.onAcceptDiff]);
    const rejectDiff = React.useCallback(() => {
        if (scriptKey != null) props.onRejectDiff(scriptKey);
    }, [scriptKey, props.onRejectDiff]);

    const [isEditing, setIsEditing] = React.useState(false);
    const [isCompactFormattable, setIsCompactFormattable] = React.useState(true);

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

    const handlePreviewClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if ((event.target as HTMLElement).closest('[data-diff-actions], [data-dashql-story-control]') != null) return;
        if (!window.getSelection()?.isCollapsed) return;
        props.onExpand(props.scriptFileName);
    }, [props.scriptFileName, props.onExpand]);


    const connectorIcon = props.connection?.connectorInfo?.icons?.outlines ?? 'database_16';
    return (
        <div
            className={styles.feed_entry_pair}
            onPointerEnter={() => props.onFocus(props.scriptFileName)}
        >
            <div className={styles.feed_entry_message_script}>
                <div className={styles.feed_entry_card_script}>
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
                                    cancelQuery(props.notebookId, props.scriptData.latestQueryId);
                                } else {
                                    props.onExecute(props.scriptFileName);
                                }
                            }}
                        >
                            {queryActive ? <SquareFillIcon size={14} /> : <PaperAirplaneIcon size={16} />}
                        </IconButton>
                        <div className={styles.feed_entry_file_name}>
                            <ScriptName
                                folder={props.folderName}
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
                                isFormattable={isCompactFormattable}
                            />
                        )}
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            size={ButtonSize.Small}
                            aria-label={`Use ${displayName} as AI context`}
                            disabled={!props.canUseAI || props.scriptData == null}
                            onClick={() => {
                                if (props.scriptData != null) props.onUseAIContext(props.scriptData.scriptKey);
                            }}
                        >
                            <SparklesFillIcon size={16} />
                        </IconButton>
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
                            onClick={() => props.onDelete(props.scriptFileName)}
                            aria-label="Delete script"
                            disabled={!props.canDelete}
                        >
                            <TrashIcon size={16} />
                        </IconButton>
                    </div>
                    <div className={styles.feed_body} onClick={handlePreviewClick}>
                        {props.scriptData == null ? null : (
                            <ScriptPreview
                                className={styles.script_preview_editor}
                                notebookId={props.notebookId}
                                scriptData={props.scriptData}
                                onReady={props.onPreviewReady}
                                initialTextHint={props.initialPreviewText}
                                onFormattedText={props.onFormattedText}
                                onFormattingStatus={setIsCompactFormattable}
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
                <div className={styles.feed_entry_avatar_script} aria-hidden="true">
                    <PersonIcon size={16} />
                </div>
            </div>
            <div className={styles.feed_entry_message_server}>
                <div className={styles.feed_entry_avatar_server} aria-hidden="true">
                    <svg width="16" height="16">
                        <use xlinkHref={`${symbols}#${connectorIcon}`} />
                    </svg>
                </div>
                <div className={styles.feed_entry_card_server}>
                    <EntryStatusBar
                        status={entryStatus}
                        onClick={entryStatus.traceId != null ? () => showLog(entryStatus.traceId) : undefined}
                        onCancel={entryStatus.indicator === IndicatorStatus.Running ? cancelEntryOperation : undefined}
                        cancelLabel={entryStatus.kind === EntryStatusKind.Agent ? 'Cancel agent run' : 'Cancel query'}
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
                        <FeedEntryFooter
                            notebookId={props.notebookId}
                            queryState={queryState}
                            agentTraceId={agentTraceId}
                            visualizeQuery={props.scriptData?.annotations.visualizeQuery ?? null}
                            logRequest={logRequest}
                            onShowStatus={() => props.onShowStatus(props.scriptFileName)}
                            onShowAgentStatus={() => props.onShowAgentStatus(props.scriptFileName)}
                            onShowTable={() => props.onShowTable(props.scriptFileName)}
                            onShowVisualization={() => props.onShowVisualization(props.scriptFileName)}
                        />
                    ) : null}
                </div>
            </div>
        </div>
    );
};

interface ScriptFeedRowProps {
    notebookId: string;
    connection: ConnectionState | null;
    storageReader: StorageReader;
    entries: ReturnType<typeof getSelectedScriptRefs>;
    scripts: NotebookScripts['scripts'];
    folderName: string;
    scriptDebugMode: boolean;
    focusedFileName: string;
    canUseAI: boolean;
    canDelete: boolean;
    onFocus: (fileName: string) => void;
    onExpand: (fileName: string) => void;
    onDelete: (fileName: string) => void;
    onRename: (oldFileName: string, newFileName: string) => void;
    onMoveUp: (fileName: string) => void;
    onMoveDown: (fileName: string) => void;
    onExecute: (fileName: string) => void;
    onUseAIContext: (scriptKey: number) => void;
    onShowStatus: (fileName: string) => void;
    onShowAgentStatus: (fileName: string) => void;
    onShowTable: (fileName: string) => void;
    onShowVisualization: (fileName: string) => void;
    onRerun: (fileName: string, cacheKey: string | null) => void;
    onAcceptDiff: (scriptKey: number) => void;
    onRejectDiff: (scriptKey: number) => void;
    previewHints: ReadonlyMap<number, ScriptPreviewHint>;
    onHeightMeasured: (scriptId: number, height: number) => void;
    onFormattedText: (scriptId: number, scriptText: string) => void;
    topPadding: number;
    heightsVersion: number;
}

function ScriptFeedRow(props: RowComponentProps<ScriptFeedRowProps>) {
    const isFillerRow = props.index >= props.entries.length;
    const entryIndex = props.index;
    const entry = !isFillerRow ? props.entries[entryIndex] : undefined;
    const scriptData = entry != null ? props.scripts[entry.scriptId] : undefined;
    const scriptFileName = entry?.fileName ?? '01-script.sql';
    const previewHint = entry != null ? props.previewHints.get(entry.scriptId) : undefined;
    const cachedHeight = previewHint?.height;

    // Entries are in feed order, so the index drives the movement buttons
    const canMoveUp = !isFillerRow && entryIndex > 0;
    const canMoveDown = !isFillerRow && entryIndex < props.entries.length - 1;
    const outerRef = React.useRef<HTMLDivElement>(null);
    const [previewReady, setPreviewReady] = React.useState(false);

    React.useLayoutEffect(() => {
        setPreviewReady(false);
    }, [entry?.scriptId, scriptData?.scriptAnalysis.buffers, scriptData?.pendingDiff]);
    const handlePreviewReady = React.useCallback(() => setPreviewReady(true), []);
    const handleFormattedText = React.useCallback((scriptText: string) => {
        if (entry != null) props.onFormattedText(entry.scriptId, scriptText);
    }, [entry, props.onFormattedText]);

    React.useLayoutEffect(() => {
        if (entry == null) return;
        const element = outerRef.current;
        if (element == null) return;
        const rowPadding = entryIndex === 0 ? props.topPadding : 0;

        const measure = () => {
            const height = element.getBoundingClientRect().height - rowPadding;
            if (!(height > 0)) return;
            if (!previewReady) {
                // While a remounted preview is still empty, retain the cached height instead of
                // recording a transient shrink. Result content may grow independently of the SQL
                // preview, though, so immediately accept measurements above the cached hint.
                if (cachedHeight == null || height <= cachedHeight + HEIGHT_CHANGE_EPSILON) return;
            }
            props.onHeightMeasured(entry.scriptId, height);
        };

        // Observe immediately so result cards can grow even while SQL is being reformatted. The
        // measure guard above is what prevents a remount's empty editor from shrinking the row.
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [cachedHeight, entry, entryIndex, props.onHeightMeasured, previewReady, props.topPadding]);

    if (isFillerRow) {
        return <div className={styles.feed_list_filler} style={props.style} />;
    }

    return (
        <div
            ref={outerRef}
            style={{
                ...props.style,
                height: 'auto',
                minHeight: !previewReady && cachedHeight != null
                    ? cachedHeight + (entryIndex === 0 ? props.topPadding : 0)
                    : undefined,
                paddingTop: entryIndex === 0 ? props.topPadding : undefined,
            }}
        >
            <div
                className={styles.feed_list_item}
            >
                <ScriptCard
                    key={entry?.scriptId}
                    notebookId={props.notebookId}
                    connection={props.connection}
                    storageReader={props.storageReader}
                    isFocused={scriptFileName === props.focusedFileName}
                    folderName={props.folderName}
                    scriptData={scriptData}
                    scriptFileName={scriptFileName}
                    scriptDebugMode={props.scriptDebugMode}
                    canExecute={scriptData != null && props.connection != null}
                    canUseAI={props.canUseAI}
                    canDelete={props.canDelete}
                    canMoveUp={canMoveUp}
                    canMoveDown={canMoveDown}
                    onFocus={props.onFocus}
                    onExpand={props.onExpand}
                    onDelete={props.onDelete}
                    onRename={props.onRename}
                    onMoveUp={props.onMoveUp}
                    onMoveDown={props.onMoveDown}
                    onExecute={props.onExecute}
                    onUseAIContext={props.onUseAIContext}
                    onShowStatus={props.onShowStatus}
                    onShowAgentStatus={props.onShowAgentStatus}
                    onShowTable={props.onShowTable}
                    onShowVisualization={props.onShowVisualization}
                    onRerun={props.onRerun}
                    onAcceptDiff={props.onAcceptDiff}
                    onRejectDiff={props.onRejectDiff}
                    onPreviewReady={handlePreviewReady}
                    initialPreviewText={previewHint?.formattedText ?? ''}
                    onFormattedText={handleFormattedText}
                />
            </div>
        </div>
    );
}

export const NotebookFeed: React.FC<NotebookFeedProps> = (props) => {
    const config = useAppConfig();
    const logger = useLogger();
    const scriptDebugMode = config?.settings?.scriptDebugMode ?? false;
    const entries = getSelectedScriptRefs(props.notebookScripts);
    const storageReader = useStorageReader();

    const pendingScrollToBottomRef = React.useRef(false);
    const [composeEditorView, setComposeEditorView] = React.useState<EditorView | null>(null);
    const [aiContextScriptKey, setAIContextScriptKey] = React.useState<number | null>(null);

    // The SQL/AI input mode is hoisted into the command context so the "Switch Mode" command
    // and the Ctrl+M shortcut can drive it from outside the feed.
    const { mode: inputMode, setMode: setInputMode } = useComposeInputMode();

    const aiContextScript = aiContextScriptKey != null
        ? props.notebookScripts.scripts[aiContextScriptKey] ?? null
        : null;
    const aiContextName = aiContextScript != null ? scriptDisplayName(aiContextScript.fileName) : null;

    // Context is scoped to the current folder/notebook. Within that scope it is stable by script key,
    // so hover selection and renames cannot silently retarget a prompt.
    const contextScopeRef = React.useRef({
        notebookId: props.notebookScripts.notebookId,
        folderName: props.notebookScripts.scriptFocus.folderName,
    });
    React.useEffect(() => {
        const nextScope = {
            notebookId: props.notebookScripts.notebookId,
            folderName: props.notebookScripts.scriptFocus.folderName,
        };
        if (contextScopeRef.current.notebookId !== nextScope.notebookId
            || contextScopeRef.current.folderName !== nextScope.folderName) {
            contextScopeRef.current = nextScope;
            setAIContextScriptKey(null);
        }
    }, [props.notebookScripts.notebookId, props.notebookScripts.scriptFocus.folderName]);
    React.useEffect(() => {
        if (aiContextScriptKey != null && aiContextScript == null) {
            setAIContextScriptKey(null);
        }
    }, [aiContextScript, aiContextScriptKey]);

    // SQL and AI use two distinct editor instances. When a toggle swaps them, the freshly
    // mounted editor should inherit focus so the keyboard flow continues uninterrupted.
    const refocusComposeRef = React.useRef(false);

    // The AI prompt editor is unmounted whenever we toggle back to SQL, so its draft text lives
    // here (the SQL draft already persists via NotebookScripts' uncommitted script). This seeds the
    // editor on remount and is kept current via PromptEditor's onChange.
    const aiPromptTextRef = React.useRef('');

    // The AI compose mode is only available when an AI provider is configured.
    const aiClient = useAIClient();
    const aiAvailable = aiClient != null;
    const notebookId = props.notebookScripts.notebookId;
    const startAgentRun = useStartAgentRun();
    const cancelAgentRun = useCancelAgentRun();
    const agentState = useLatestAgentRunState(notebookId);
    const agentActive = agentState != null && agentRunIsActive(agentState.phase);

    // When the input mode changes (via Ctrl+M, the "Switch Mode" command, or the toggle in the
    // action bar) the editor instance swaps. Request that the freshly mounted editor take focus.
    // Derived during render so the ref is set before the new editor reports its view below.
    const prevInputModeRef = React.useRef(inputMode);
    if (prevInputModeRef.current !== inputMode) {
        prevInputModeRef.current = inputMode;
        refocusComposeRef.current = true;
    }

    // Receive the active compose editor view; carry focus across a mode-swap.
    const handleComposeView = React.useCallback((view: EditorView) => {
        setComposeEditorView(view);
        if (refocusComposeRef.current) {
            refocusComposeRef.current = false;
            view.focus();
        }
    }, []);

    const handleUseAIContext = React.useCallback((scriptKey: number) => {
        setAIContextScriptKey(scriptKey);
        if (inputMode === COMPOSE_INPUT_MODE_AI) {
            composeEditorView?.focus();
        } else {
            setInputMode(COMPOSE_INPUT_MODE_AI);
        }
    }, [composeEditorView, inputMode, setInputMode]);

    const handleFocus = React.useCallback((fileName: string) => {
        props.modifyNotebookScripts({ type: SELECT_SCRIPT, value: fileName });
    }, [props.modifyNotebookScripts]);

    const handleExpand = React.useCallback((fileName: string) => {
        props.modifyNotebookScripts({ type: SELECT_SCRIPT, value: fileName });
        props.showDetails(fileName);
    }, [props.modifyNotebookScripts, props.showDetails]);

    const handleShowStatus = React.useCallback((fileName: string) => {
        props.modifyNotebookScripts({ type: SELECT_SCRIPT, value: fileName });
        props.showDetails(fileName, DetailsTabKey.QueryStatusPanel);
    }, [props.modifyNotebookScripts, props.showDetails]);

    const handleShowAgentStatus = React.useCallback((fileName: string) => {
        props.modifyNotebookScripts({ type: SELECT_SCRIPT, value: fileName });
        props.showDetails(fileName, DetailsTabKey.AgentStatusPanel);
    }, [props.modifyNotebookScripts, props.showDetails]);

    const handleShowTable = React.useCallback((fileName: string) => {
        props.modifyNotebookScripts({ type: SELECT_SCRIPT, value: fileName });
        props.showDetails(fileName, DetailsTabKey.QueryResultView);
    }, [props.modifyNotebookScripts, props.showDetails]);

    const handleShowVisualization = React.useCallback((fileName: string) => {
        props.modifyNotebookScripts({ type: SELECT_SCRIPT, value: fileName });
        props.showDetails(fileName, DetailsTabKey.Visualization);
    }, [props.modifyNotebookScripts, props.showDetails]);

    const isDisconnected = props.conn?.connectionHealth !== ConnectionHealth.ONLINE;
    const executeQuery = useQueryExecutor();

    // Re-execute the visualization after the agent finishes editing it.
    //
    // The reducer that applies the agent's result (SET_SCRIPT_TEXT) already *reevaluates* the
    // script: it re-analyzes and refreshes annotations.visualizeQuery, and the editor/preview
    // re-sync from the new scriptData. What it can't do is re-run the resolved query — so a
    // VISUALIZE the agent just rewrote would still render its stale result. We kick that
    // re-execution here, where the live notebookScripts, executor and connection state are available.
    //
    // Scope: only in-place edits of a VISUALIZE script (the run's context script now resolves a
    // visualizeQuery). SQL scripts are intentionally left alone for now — re-running them will be
    // covered by query-result caching later. A visualize run that *creates* a new entry over a SQL
    // script isn't covered either: its context script is the SQL source, not the new chart entry.
    const executedAgentRunRef = React.useRef<number | null>(null);
    React.useEffect(() => {
        if (agentState == null || agentState.phase !== AgentRunPhase.SUCCEEDED) {
            return;
        }
        // Handle each successful run exactly once (the effect re-runs as NotebookScripts settles).
        if (executedAgentRunRef.current === agentState.runId) {
            return;
        }
        const scriptKey = agentState.contextScriptKey;
        if (scriptKey == null || isDisconnected) {
            return;
        }
        const scriptData = props.notebookScripts.scripts[scriptKey];
        if (scriptData == null || scriptData.annotations.visualizeQuery == null) {
            return;
        }
        executedAgentRunRef.current = agentState.runId;
        // Resolve against the current notebookScripts so a freshly rewritten VISUALIZE source is reflected.
        const queryText = compileQuery(scriptData, logger);
        if (queryText.trim().length === 0) {
            return;
        }
        const [queryId, execution] = executeQuery(props.notebookScripts.notebookId, {
            query: queryText,
            analyzeResults: true,
            replaceComputationId: scriptData.latestQueryId,
            cacheable: true,
            projection: projectionForVisualizeQuery(scriptData.annotations.visualizeQuery),
            metadata: {
                queryType: QueryType.USER_PROVIDED,
                title: 'Notebook Query',
                description: null,
                issuer: 'Agent Visualization Re-execution',
                userProvided: true,
            },
        });
        registerNotebookScriptQuery(scriptData, queryId, queryText, execution, props.modifyNotebookScripts);
    }, [agentState, props.notebookScripts, props.modifyNotebookScripts, isDisconnected, executeQuery, logger]);

    const handleSend = React.useCallback((execute: boolean) => {
        pendingScrollToBottomRef.current = true;
        const notebookScripts = props.notebookScripts;
        const scriptKey = notebookScripts.uncommittedScriptId;
        const scriptData = notebookScripts.scripts[scriptKey];

        // The compose editor keeps the draft analyzed as it is typed, so the
        // resolved VISUALIZE query / derived annotations are already present (and
        // carried across promotion, which preserves the script key).
        const queryText = scriptData && execute ? compileQuery(scriptData, logger) : '';
        props.modifyNotebookScripts({ type: PROMOTE_UNCOMMITTED_SCRIPT, value: null });
        if (execute && !isDisconnected && queryText.trim().length > 0) {
            const [queryId, execution] = executeQuery(notebookScripts.notebookId, {
                query: queryText,
                analyzeResults: true,
                replaceComputationId: scriptData?.latestQueryId,
                cacheable: true,
                projection: projectionForVisualizeQuery(scriptData?.annotations.visualizeQuery),
                metadata: {
                    queryType: QueryType.USER_PROVIDED,
                    title: "Notebook Query",
                    description: null,
                    issuer: "Query Execution Command",
                    userProvided: true
                }
            });
            registerNotebookScriptQuery(scriptData, queryId, queryText, execution, props.modifyNotebookScripts);
        }
    }, [props.notebookScripts, props.modifyNotebookScripts, isDisconnected, executeQuery]);

    // Refresh: drop the stale cache entry for a script's result, then re-execute — a plain cacheable
    // run then misses the cache and re-populates it. Resolves the script by feed file name.
    const handleRerunEntry = React.useCallback(async (fileName: string, cacheKey: string | null) => {
        if (isDisconnected) {
            return;
        }
        const notebookScripts = props.notebookScripts;
        const entry = notebookScripts.scriptFolders[notebookScripts.scriptFocus.folderName]?.scripts[fileName];
        const scriptData = entry != null ? notebookScripts.scripts[entry.scriptId] : undefined;
        if (scriptData == null) {
            return;
        }
        // Best-effort delete of the stale cache entry: a failed delete just means the run may hit the
        // old entry, which is harmless (the executor's write path overwrites it either way).
        if (cacheKey != null) {
            await storageReader.backend.deleteQueryResultCache(notebookScripts.notebookId, cacheKey).catch(() => { });
        }
        runNotebookScript(notebookScripts, scriptData, executeQuery, props.modifyNotebookScripts, logger);
    }, [props.notebookScripts, props.modifyNotebookScripts, isDisconnected, executeQuery, storageReader, logger]);

    const handleExecuteEntry = React.useCallback((fileName: string) => {
        if (isDisconnected) return;
        const notebookScripts = props.notebookScripts;
        const entry = notebookScripts.scriptFolders[notebookScripts.scriptFocus.folderName]?.scripts[fileName];
        const scriptData = entry != null ? notebookScripts.scripts[entry.scriptId] : undefined;
        if (scriptData == null) return;
        runNotebookScript(notebookScripts, scriptData, executeQuery, props.modifyNotebookScripts, logger);
    }, [executeQuery, isDisconnected, props.modifyNotebookScripts, props.notebookScripts, logger]);

    // Send the compose editor's text to the agent run as a natural-language prompt. Context is
    // explicit: no bean means a blank-draft run rather than an implicit hover-selected target.
    const handleSendAI = React.useCallback(() => {
        if (!aiAvailable) return;
        const prompt = composeEditorView?.state.doc.toString().trim() ?? '';
        if (prompt.length === 0) return;
        const contextScriptKey = aiContextScript?.scriptKey ?? null;

        // Build the notebook adapter the run acts on. It closes over the focused script and the
        // NotebookScripts dispatch; for visualize runs it also exposes each script's last-execution output
        // schema (from the connection state) so the agent context can describe the chart's columns.
        const host = createNotebookScriptsAgentHost({
            notebookScripts: props.notebookScripts,
            contextScriptKey,
            modifyNotebookScripts: props.modifyNotebookScripts,
            resolveOutputColumns: (scriptKey) => outputColumnsForScript(props.notebookScripts, props.conn, scriptKey),
            logger,
        });
        startAgentRun({
            notebookId: props.notebookScripts.notebookId,
            prompt,
            contextScriptKey,
            // Intent is always classified by the model (no manual Query/Chart override).
            intentOverride: null,
            host,
        });

        // Clear the prompt so the next instruction starts fresh (the editor's docChanged also
        // resets the persisted draft via onChange, but clear the ref explicitly to be safe).
        aiPromptTextRef.current = '';
        if (composeEditorView) {
            composeEditorView.dispatch({
                changes: { from: 0, to: composeEditorView.state.doc.length, insert: '' },
            });
        }
    }, [aiAvailable, aiContextScript, composeEditorView, props.notebookScripts, props.conn, props.modifyNotebookScripts, startAgentRun]);

    const handleComposeSend = React.useCallback(() => {
        if (inputMode === 1) {
            handleSendAI();
        } else {
            handleSend(true);
        }
    }, [inputMode, handleSendAI, handleSend]);

    const handleDelete = React.useCallback((fileName: string) => {
        props.modifyNotebookScripts({ type: DELETE_SCRIPT, value: fileName });
    }, [props.modifyNotebookScripts]);

    const handleRename = React.useCallback((oldFileName: string, newFileName: string) => {
        props.modifyNotebookScripts({ type: RENAME_SCRIPT, value: { fileName: oldFileName, newFileName } });
    }, [props.modifyNotebookScripts]);

    // Move a script one position up/down within its page by swapping it with its neighbour in the
    // feed order and dispatching the new full order to REORDER_SCRIPTS.
    const moveScript = React.useCallback((fileName: string, delta: number) => {
        const page = getSelectedScriptFolder(props.notebookScripts);
        if (page == null) return;
        const order = getSortedScriptFileNames(page);
        const from = order.indexOf(fileName);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= order.length) return;
        [order[from], order[to]] = [order[to], order[from]];
        props.modifyNotebookScripts({
            type: REORDER_SCRIPTS,
            value: { folderName: page.folderName, fileNames: order },
        });
    }, [props.notebookScripts, props.modifyNotebookScripts]);
    const handleMoveUp = React.useCallback((fileName: string) => moveScript(fileName, -1), [moveScript]);
    const handleMoveDown = React.useCallback((fileName: string) => moveScript(fileName, 1), [moveScript]);

    // Accept / reject a staged agent rewrite from the feed. These dispatch notebookScripts actions (the
    // feed shows the diff on the read-only preview, so there's no editor to drive the editor-effect
    // path). Accept keeps the new text; reject restores the prior text and re-analyzes.
    const handleAcceptDiff = React.useCallback((scriptKey: number) => {
        props.modifyNotebookScripts({ type: ACCEPT_PENDING_DIFF, value: scriptKey });
    }, [props.modifyNotebookScripts]);
    const handleRejectDiff = React.useCallback((scriptKey: number) => {
        props.modifyNotebookScripts({ type: REJECT_PENDING_DIFF, value: scriptKey });
    }, [props.modifyNotebookScripts]);

    // The feed stays mounted (just hidden) while the catalog/details overlay is open, so its global
    // key handlers would otherwise keep firing behind the overlay. Gate them all on the active flag.
    const feedActive = props.active;
    const keyHandlers = React.useMemo<KeyEventHandler[]>(() => [
        {
            key: 'Enter',
            ctrlKey: true,
            capture: true,
            callback: (event: KeyboardEvent) => {
                if (!feedActive || !composeEditorView?.hasFocus) {
                    return;
                }
                event.preventDefault();
                handleComposeSend();
            },
        },
        {
            // Plain Enter, while browsing the feed with nothing focused, accepts a staged agent
            // rewrite (matching the status bar's "Accept ⏎" hint). It intentionally does nothing for
            // ordinary scripts; Details is opened only through an explicit pointer action.
            key: 'Enter',
            ctrlKey: false,
            capture: true,
            callback: (event: KeyboardEvent) => {
                if (!feedActive) {
                    return;
                }
                const active = document.activeElement as HTMLElement | null;
                if (active && active !== document.body && active !== document.documentElement) {
                    return;
                }
                const focused = getSelectedScriptRef(props.notebookScripts);
                const focusedScript = focused != null ? props.notebookScripts.scripts[focused.scriptId] : null;
                if (focusedScript?.pendingDiff != null) {
                    event.preventDefault();
                    handleAcceptDiff(focusedScript.scriptKey);
                    return;
                }
            },
        },
        {
            // Escape, while browsing the feed with nothing focused, rejects a staged rewrite on the
            // focused entry (matching the status bar's "Reject ⎋" hint). Same focus guard as Enter so the
            // compose editor, rename input, or an open completion dropdown keeps Escape when focused.
            key: 'Escape',
            ctrlKey: false,
            capture: true,
            callback: (event: KeyboardEvent) => {
                if (!feedActive) {
                    return;
                }
                const active = document.activeElement as HTMLElement | null;
                if (active && active !== document.body && active !== document.documentElement) {
                    return;
                }
                const focused = getSelectedScriptRef(props.notebookScripts);
                const focusedScript = focused != null ? props.notebookScripts.scripts[focused.scriptId] : null;
                if (focusedScript?.pendingDiff != null) {
                    event.preventDefault();
                    handleRejectDiff(focusedScript.scriptKey);
                }
            },
        },
        {
            // Ctrl+E executes the selected feed entry globally. Suppress it
            // while the compose editor is focused so it doesn't run a
            // background entry the user isn't looking at — Ctrl+Enter is
            // the dedicated shortcut for sending the draft.
            key: 'e',
            ctrlKey: true,
            capture: true,
            callback: (event: KeyboardEvent) => {
                if (!feedActive || !composeEditorView?.hasFocus) {
                    return;
                }
                event.stopPropagation();
            },
        },
    ], [feedActive, composeEditorView, handleComposeSend, props.notebookScripts, handleAcceptDiff, handleRejectDiff]);
    useKeyEvents(keyHandlers);

    const listContainerRef = React.useRef<HTMLDivElement>(null);
    const listRef = useListRef(null);

    // A cached height is a layout hint, not a validity claim. Reuse it immediately whenever a row
    // remounts, then replace it with the mounted row's current height once its preview is ready.
    const previewHintsRef = React.useRef<Map<number, ScriptPreviewHint>>(new Map());
    const [heightsVersion, setHeightsVersion] = React.useState(0);
    const handleHeightMeasured = React.useCallback((scriptId: number, height: number) => {
        const previous = previewHintsRef.current.get(scriptId);
        if (previous?.height != null && Math.abs(previous.height - height) < HEIGHT_CHANGE_EPSILON) return;
        previewHintsRef.current.set(scriptId, { ...previous, height });
        setHeightsVersion(version => version + 1);
    }, []);
    const handleFormattedText = React.useCallback((scriptId: number, scriptText: string) => {
        const previous = previewHintsRef.current.get(scriptId);
        previewHintsRef.current.set(scriptId, { ...previous, formattedText: scriptText });
    }, []);

    // Measure list container dimensions for react-window
    const listContainerSize = observeSize(listContainerRef);
    const listWidth = listContainerSize?.width ?? 0;
    const listHeight = listContainerSize?.height ?? 0;
    const listScrollbarInset = useScrollbarWidth();
    const feedTopPadding = listWidth > 0 && listWidth <= 700
        ? FEED_MOBILE_TOP_PADDING
        : FEED_TOP_PADDING;

    // Track the height of the composer for the filler row
    const composeSectionRef = React.useRef<HTMLDivElement>(null);
    const composeSectionSize = observeSize(composeSectionRef);
    const composePadding = 24;
    const composeSectionHeight = (composeSectionSize?.height ?? 0) + composePadding;
    const fillerRowHeight = composeSectionHeight + FEED_BOTTOM_FADE_HEIGHT;

    React.useEffect(() => {
        if (!pendingScrollToBottomRef.current || !listRef.current) {
            return;
        }
        pendingScrollToBottomRef.current = false;
        listRef.current.scrollToRow({
            index: entries.length,
            align: 'end',
        });
    }, [entries.length, listRef]);

    // Read entries via ref so this effect runs only when scrollTarget changes,
    // not on every re-render (e.g. hover-driven SELECT_SCRIPT) which would yank
    // the feed back to the last keyboard-set target while the user mouse-scrolls.
    const entriesRef = React.useRef(entries);
    entriesRef.current = entries;

    // Scroll a requested entry to the top of the feed. This fires for the keyboard step commands
    // (Ctrl+J/K bump the target) and when the notebookScripts focus is re-asserted on return from Details.
    // The feed stays mounted (just hidden) across a Details visit, so the list is always warm here —
    // its rows are already measured and its container already sized — and scrollToRow lands exactly
    // on the target with no remount cold-start to work around.
    React.useEffect(() => {
        if (props.scrollTarget == null || !listRef.current) {
            return;
        }
        const currentEntries = entriesRef.current;
        if (currentEntries.length === 0) {
            return;
        }
        if (props.scrollTarget.fileName === '') {
            listRef.current.scrollToRow({ index: 0, align: 'start' });
            return;
        }
        const targetIdx = currentEntries.findIndex(e => e.fileName === props.scrollTarget!.fileName);
        if (targetIdx === -1) {
            return;
        }
        listRef.current.scrollToRow({
            index: targetIdx,
            align: 'start',
        });
    }, [listRef, props.scrollTarget]);

    // Get folder name from current page (display-only: strip the on-disk ordering prefix)
    const selectedPage = getSelectedScriptFolder(props.notebookScripts);
    const folderName = normalizeScriptFolderName(selectedPage?.folderName ?? '') || 'Untitled';

    const pageCount = Object.keys(props.notebookScripts.scriptFolders).length;
    const canDelete = pageCount > 1 || entries.length > 1;
    const rowProps = React.useMemo<ScriptFeedRowProps>(() => ({
        notebookId: props.notebookScripts.notebookId,
        connection: props.conn,
        entries,
        storageReader: storageReader,
        scripts: props.notebookScripts.scripts,
        folderName,
        scriptDebugMode,
        focusedFileName: props.notebookScripts.scriptFocus.fileName,
        canUseAI: aiAvailable,
        canDelete,
        onFocus: handleFocus,
        onExpand: handleExpand,
        onDelete: handleDelete,
        onRename: handleRename,
        onMoveUp: handleMoveUp,
        onMoveDown: handleMoveDown,
        onExecute: handleExecuteEntry,
        onUseAIContext: handleUseAIContext,
        onShowStatus: handleShowStatus,
        onShowAgentStatus: handleShowAgentStatus,
        onShowTable: handleShowTable,
        onShowVisualization: handleShowVisualization,
        onRerun: handleRerunEntry,
        onAcceptDiff: handleAcceptDiff,
        onRejectDiff: handleRejectDiff,
        previewHints: previewHintsRef.current,
        onHeightMeasured: handleHeightMeasured,
        onFormattedText: handleFormattedText,
        topPadding: feedTopPadding,
        heightsVersion,
    }), [entries, props.notebookScripts.scripts, props.notebookScripts.connectorInfo.icons?.outlines, props.notebookScripts.scriptFocus.fileName, folderName, scriptDebugMode, aiAvailable, canDelete, handleFocus, handleExpand, handleDelete, handleRename, handleMoveUp, handleMoveDown, handleExecuteEntry, handleUseAIContext, handleShowStatus, handleShowAgentStatus, handleShowTable, handleShowVisualization, handleRerunEntry, handleAcceptDiff, handleRejectDiff, handleHeightMeasured, handleFormattedText, feedTopPadding, heightsVersion]);

    return (
        <div
            className={styles.feed_body_container}
            data-tauri-drag-region="deep"
            style={{ '--feed-scrollbar-inset': `${listScrollbarInset}px` } as React.CSSProperties}
        >
            <div className={styles.feed_list_container} ref={listContainerRef}>
                <List
                    key={props.notebookScripts.scriptFocus.folderName}
                    listRef={listRef}
                    style={{
                        width: listWidth,
                        height: listHeight,
                        overflowX: 'hidden',
                        scrollbarGutter: 'stable',
                        '--feed-scrollbar-inset': `${listScrollbarInset}px`,
                    } as React.CSSProperties}
                    rowCount={entries.length + 1}
                    overscanCount={OVERSCAN_ROW_COUNT}
                    rowHeight={(rowIndex) => {
                        if (rowIndex < entries.length) {
                            const scriptId = entries[rowIndex].scriptId;
                            const contentHeight = previewHintsRef.current.get(scriptId)?.height ?? ESTIMATED_ROW_HEIGHT;
                            return contentHeight + (rowIndex === 0 ? feedTopPadding : 0);
                        }
                        return fillerRowHeight + FEED_BOTTOM_PADDING;
                    }}
                    rowComponent={ScriptFeedRow}
                    rowProps={rowProps}
                />
            </div>
            <div className={styles.compose_section} ref={composeSectionRef}>
                <div className={styles.compose_card}>
                    {inputMode === 1 ? (
                        // AI mode: an isolated, plugin-free prompt editor (no SQL parsing,
                        // autocompletion or notebookScripts-state wiring — the text is just a prompt).
                        <PromptEditor
                            className={styles.compose_card_body}
                            autoHeight
                            placeholder="Show account balance over time as line chart"
                            initialText={aiPromptTextRef.current}
                            onChange={(text) => { aiPromptTextRef.current = text; }}
                            setView={handleComposeView}
                        />
                    ) : (
                        <ScriptEditor
                            notebookId={props.notebookScripts.notebookId}
                            scriptKey={getUncommittedScriptData(props.notebookScripts)?.scriptKey ?? 0}
                            className={styles.compose_card_body}
                            autoHeight
                            setView={handleComposeView}
                        />
                    )}
                    <div className={styles.compose_action_bar}>
                        <div className={styles.compose_mode_group}>
                            <SegmentedControl
                                aria-label="Input mode"
                                size={SegmentedControlSize.Small}
                                onChange={setInputMode}
                            >
                                <SegmentedControl.Button
                                    leadingVisual={CodeIcon}
                                    selected={inputMode === 0}
                                >
                                    SQL
                                </SegmentedControl.Button>
                                <SegmentedControl.Button
                                    leadingVisual={SparklesFillIcon}
                                    selected={inputMode === 1}
                                    disabled={!aiAvailable}
                                    title={aiAvailable ? 'Ctrl + M to toggle' : 'Configure an AI provider in settings'}
                                >
                                    AI
                                </SegmentedControl.Button>
                            </SegmentedControl>
                            {inputMode === COMPOSE_INPUT_MODE_AI && aiContextName != null && (
                                <button
                                    type="button"
                                    className={styles.compose_context_bean}
                                    title={aiContextName}
                                    aria-label={`Remove ${aiContextName} AI context`}
                                    onClick={() => setAIContextScriptKey(null)}
                                >
                                    <span className={styles.compose_context_name}>
                                        <span className={styles.compose_context_name_text}>{aiContextName}</span>
                                    </span>
                                    <span className={styles.compose_context_remove} aria-hidden="true">
                                        <XIcon size={12} />
                                    </span>
                                </button>
                            )}
                        </div>
                        <div className={styles.compose_send_group}>
                            {inputMode === 1 && agentActive ? (
                                <>
                                    <StatusIndicator
                                        className={styles.compose_progress_spinner}
                                        status={IndicatorStatus.Running}
                                        width="16px"
                                        height="16px"
                                        fill="currentColor"
                                    />
                                    <IconButton
                                        variant={ButtonVariant.Default}
                                        size={ButtonSize.Small}
                                        className={styles.compose_send_button}
                                        aria-label="Stop agent run"
                                        onClick={() => cancelAgentRun(notebookId)}
                                    >
                                        <SquareFillIcon />
                                    </IconButton>
                                </>
                            ) : inputMode === 0 ? (
                                <ButtonGroup aria-label="Draft actions">
                                    <IconButton
                                        variant={ButtonVariant.Default}
                                        size={ButtonSize.Small}
                                        aria-label="Save"
                                        onClick={() => handleSend(false)}
                                    >
                                        <ComposeIcon />
                                    </IconButton>
                                    <IconButton
                                        variant={ButtonVariant.Default}
                                        size={ButtonSize.Small}
                                        aria-label="Execute"
                                        disabled={isDisconnected}
                                        onClick={handleComposeSend}
                                    >
                                        <PaperAirplaneIcon />
                                    </IconButton>
                                </ButtonGroup>
                            ) : (
                                <IconButton
                                    variant={ButtonVariant.Default}
                                    size={ButtonSize.Small}
                                    className={styles.compose_send_button}
                                    aria-label="Send to AI"
                                    onClick={handleComposeSend}
                                >
                                    <PaperAirplaneIcon />
                                </IconButton>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
