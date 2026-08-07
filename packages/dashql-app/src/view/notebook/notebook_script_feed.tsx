import * as React from 'react';
import * as styles from './notebook_script_feed.module.css';

import type { EditorView } from '@codemirror/view';
import type { Icon } from '@primer/octicons-react';
import { CodeIcon, ComposeIcon, PaperAirplaneIcon, SparklesFillIcon, SquareFillIcon, XIcon } from '@primer/octicons-react';
import symbols from '@ankoh/dashql-svg-symbols';

import { useAppConfig } from '../../app_config.js';
import { ScriptStatisticsBar } from './script_statistics_bar.js';

import { List, useListRef } from 'react-window';
import type { RowComponentProps } from 'react-window';

import { ButtonSize, ButtonVariant, IconButton } from '../foundations/button.js';
import { ButtonGroup } from '../foundations/button_group.js';
import { ConnectionHealth, ConnectionState } from '../../connection/connection_state.js';
import { getExecutableQueryText, getSelectedEntry, getSelectedPage, getSelectedPageEntries, getSortedFileNames, getUncommittedScriptData, tryGetExecutableQueryText, type ScriptData, NotebookState, SELECT_ENTRY, PROMOTE_UNCOMMITTED_SCRIPT, DELETE_NOTEBOOK_ENTRY, UPDATE_NOTEBOOK_ENTRY, REORDER_NOTEBOOK_SCRIPTS, ACCEPT_PENDING_DIFF, REJECT_PENDING_DIFF } from '../../notebook/notebook_state.js';
import { useAIClient } from '../../platform/ai_client_provider.js';
import { COMPOSE_INPUT_MODE_AI, useComposeInputMode } from '../../notebook/notebook_commands.js';
import { useLatestAgentRunState, useAgentRunState, useStartAgentRun, useCancelAgentRun } from '../../agent/agent_run_provider.js';
import { AgentRunPhase, agentRunIsActive } from '../../agent/agent_run_state.js';
import { OutputColumn } from '../../notebook/notebook_agent_context.js';
import { createNotebookAgentHost } from '../../notebook/notebook_agent_host.js';
import { QueryType, queryIsDone } from '../../connection/query_execution_state.js';
import { computeQueryCacheKeyForConnection, useCancelQuery, useQueryExecutor, useQueryState } from '../../connection/query_executor.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';
import { ScriptEditor } from './script_editor.js';
import { PromptEditor } from './prompt_editor.js';
import { ScriptPreview } from './notebook_script_preview.js';
import { observeSize } from '../foundations/size_observer.js';
import type { ModifyNotebook } from '../../notebook/notebook_state_registry.js';
import { normalizePageName, projectionForVisualizeQuery, scriptDisplayName } from '../../notebook/notebook_types.js';
import { type KeyEventHandler, useKeyEvents } from '../../utils/key_events.js';
import { useScrollbarWidth } from '../../utils/scrollbar.js';
import { SegmentedControl, SegmentedControlSize } from '../foundations/segmented_control.js';
import { NotebookScriptName } from './notebook_script_name.js';
import { IndicatorStatus, StatusIndicator } from '../foundations/status_indicator.js';
import { EntryStatusBar } from './entry_status_bar.js';
import { deriveEntryStatus, EntryStatusKind } from './entry_status_model.js';
import { FeedEntryFooter } from './feed_entry_footer.js';
import { TabKey as DetailsTabKey } from './notebook_script_details.js';
import { registerNotebookQuery, rerunEntry } from './rerun_query.js';
import { useStorageReader } from '../../platform/storage/storage_provider.js';
import { STORAGE_CACHE_EXTENSION } from '../../platform/storage/storage_backend.js';
import { CachedResultBean, QueryResultCacheLabel, QueryResultRerunButton } from './query_result_cache_controls.js';

interface FeedScrollTarget {
    fileName: string;
    version: number;
}

export interface NotebookScriptListProps {
    notebook: NotebookState;
    modifyNotebook: ModifyNotebook;
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
const OVERSCAN_ROW_COUNT = 12;
const FEED_EDGE_PADDING = 8;
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
    notebook: NotebookState,
    conn: ConnectionState | null,
    scriptKey: number,
): OutputColumn[] | null {
    const queryId = notebook.scripts[scriptKey]?.latestQueryId ?? null;
    if (conn == null || queryId == null) return null;
    const query = conn.queriesActive.get(queryId) ?? conn.queriesFinished.get(queryId) ?? null;
    const schema = query?.resultSchema ?? null;
    if (schema == null) return null;
    return schema.fields.map(f => ({ name: f.name, type: f.type?.toString() ?? null }));
}

interface CollapsedScriptCardProps {
    sessionId: string;
    connectorIcon: string;
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
    hasCachedResult: boolean;
    onPreviewReady: () => void;
    initialPreviewText: string;
    onFormattedText: (scriptText: string) => void;
}

const ScriptCard: React.FC<CollapsedScriptCardProps> = ({ sessionId, connectorIcon, isFocused, scriptData, folderName, scriptFileName, scriptDebugMode, canExecute, canUseAI, canDelete, canMoveUp, canMoveDown, onFocus, onExpand, onDelete, onRename, onMoveUp, onMoveDown, onExecute, onUseAIContext, onShowStatus, onShowAgentStatus, onShowTable, onShowVisualization, onRerun, onAcceptDiff, onRejectDiff, hasCachedResult, onPreviewReady, initialPreviewText, onFormattedText }) => {
    const TrashIcon: Icon = SymbolIcon('trash_16');
    const MoveUpIcon: Icon = SymbolIcon('chevron_up_16');
    const MoveDownIcon: Icon = SymbolIcon('chevron_down_16');
    const PersonIcon: Icon = SymbolIcon('person_16');

    const PencilIcon: Icon = SymbolIcon('pencil_16');

    // Accept/Reject a staged rewrite — the same check/cross icon group as the Details editor.
    const CheckIcon: Icon = SymbolIcon('check_16');
    const CrossIcon: Icon = SymbolIcon('x_16');
    const queryState = useQueryState(sessionId, scriptData?.latestQueryId ?? null);
    const cancelQuery = useCancelQuery();
    const cancelAgentRun = useCancelAgentRun();
    const queryActive = queryState != null && !queryIsDone(queryState.status);

    // Resolve the agent run by its id (handle) just like the query above — the run carries its
    // own trace id, so the footer no longer needs a denormalized trace id on ScriptData.
    const agentRunState = useAgentRunState(scriptData?.latestAgentRunId ?? null);
    const agentTraceId = agentRunState?.traceId ?? null;

    // A staged agent rewrite waiting to be accepted/rejected. While set, the read-only preview
    // renders the rewrite as a compact in-place diff overlay and the body carries an Accept/Reject
    // overlay (which dispatch notebook actions — no editable editor is mounted).
    const hasPendingDiff = scriptData?.pendingDiff != null;

    // The status bar above the body generalizes the former "AI bar": while any work is in flight —
    // an agent run *or* a query execution — it's a compact strip (spinner + latest log line / query
    // status) instead of yanking the user to the raw trace. The body keeps rendering the current
    // output; the user opts into the full trace by clicking the bar. The bar persists across idle,
    // running, and terminal states. A staged rewrite doesn't feed it — Accept/Reject controls live on the
    // body overlay — so the bar stays free to show the rewritten statement's re-execution status.
    const entryStatus = deriveEntryStatus(agentRunState, queryState);
    const cancelEntryOperation = React.useCallback(() => {
        if (entryStatus?.kind === EntryStatusKind.Agent) {
            cancelAgentRun(sessionId);
        } else if (entryStatus?.kind === EntryStatusKind.Query && scriptData?.latestQueryId != null) {
            cancelQuery(sessionId, scriptData.latestQueryId);
        }
    }, [cancelAgentRun, cancelQuery, entryStatus?.kind, scriptData?.latestQueryId, sessionId]);

    // A monotonic nonce handed to the footer: bumped when the user clicks the status bar so the
    // footer reveals the matching trace's Log tab on demand (work no longer auto-switches it). The
    // clicked source (query vs agent) rides along so the footer reveals the right trace.
    const [logRequest, setLogRequest] = React.useState<{ nonce: number; traceId: number | null }>({ nonce: 0, traceId: null });
    const showLog = React.useCallback((traceId: number | null) => setLogRequest(prev => ({ nonce: prev.nonce + 1, traceId })), []);
    const scriptKey = scriptData?.scriptKey ?? null;
    const acceptDiff = React.useCallback(() => {
        if (scriptKey != null) onAcceptDiff(scriptKey);
    }, [scriptKey, onAcceptDiff]);
    const rejectDiff = React.useCallback(() => {
        if (scriptKey != null) onRejectDiff(scriptKey);
    }, [scriptKey, onRejectDiff]);

    const [isEditing, setIsEditing] = React.useState(false);

    // The label and the rename input show the clean display name (no ordering prefix, no ".sql");
    // the raw scriptFileName remains the identity passed to handlers and to UPDATE_NOTEBOOK_ENTRY.
    const displayName = scriptDisplayName(scriptFileName);
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
            onRename(scriptFileName, trimmed);
        }
        setIsEditing(false);
    }, [draftFileName, displayName, scriptFileName, onRename]);

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
        onExpand(scriptFileName);
    }, [scriptFileName, onExpand]);

    return (
        <div
            className={styles.feed_entry_pair}
            onPointerEnter={() => onFocus(scriptFileName)}
        >
            <div className={styles.feed_entry_message_script}>
                <div className={styles.feed_entry_card_script}>
                    <div className={styles.feed_entry_action_bar}>
                        <IconButton
                            className={isFocused ? undefined : styles.feed_entry_execute_unfocused}
                            variant={ButtonVariant.Invisible}
                            size={ButtonSize.Small}
                            aria-label={queryActive ? `Stop ${displayName} query` : `Execute ${displayName} query`}
                            aria-current={isFocused ? 'true' : undefined}
                            disabled={!queryActive && !canExecute}
                            onClick={() => {
                                if (queryActive && scriptData?.latestQueryId != null) {
                                    cancelQuery(sessionId, scriptData.latestQueryId);
                                } else {
                                    onExecute(scriptFileName);
                                }
                            }}
                        >
                            {queryActive ? <SquareFillIcon size={14} /> : <PaperAirplaneIcon size={16} />}
                        </IconButton>
                        <div className={styles.feed_entry_file_name}>
                            <NotebookScriptName
                                folder={folderName}
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
                        {scriptDebugMode && scriptData != null && (
                            <div className={styles.feed_entry_stats_bar}>
                                <ScriptStatisticsBar stats={scriptData.statistics} />
                            </div>
                        )}
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            size={ButtonSize.Small}
                            aria-label={`Use ${displayName} as AI context`}
                            disabled={!canUseAI || scriptData == null}
                            onClick={() => {
                                if (scriptData != null) onUseAIContext(scriptData.scriptKey);
                            }}
                        >
                            <SparklesFillIcon size={16} />
                        </IconButton>
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            onClick={(event) => { event.stopPropagation(); onMoveUp(scriptFileName); }}
                            aria-label="Move script up"
                            disabled={!canMoveUp}
                        >
                            <MoveUpIcon size={16} />
                        </IconButton>
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            onClick={(event) => { event.stopPropagation(); onMoveDown(scriptFileName); }}
                            aria-label="Move script down"
                            disabled={!canMoveDown}
                        >
                            <MoveDownIcon size={16} />
                        </IconButton>
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            onClick={() => onDelete(scriptFileName)}
                            aria-label="Delete script"
                            disabled={!canDelete}
                        >
                            <TrashIcon size={16} />
                        </IconButton>
                    </div>
                    <div className={styles.feed_body} onClick={handlePreviewClick}>
                        {scriptData == null ? null : (
                            <ScriptPreview
                                className={styles.script_preview_editor}
                                sessionId={sessionId}
                                scriptData={scriptData}
                                onReady={onPreviewReady}
                                initialTextHint={initialPreviewText}
                                onFormattedText={onFormattedText}
                            />
                        )}
                        {hasPendingDiff && (
                            <div className={styles.feed_body_diff_actions} data-diff-actions>
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
                                {hasCachedResult && <CachedResultBean />}
                                <QueryResultCacheLabel query={queryState} />
                                <QueryResultRerunButton
                                    query={queryState}
                                    onRerun={(cacheKey) => onRerun(scriptFileName, cacheKey)}
                                />
                            </>
                        }
                    />
                    {(queryState != null || agentTraceId != null) ? (
                        <FeedEntryFooter
                            sessionId={sessionId}
                            queryState={queryState}
                            agentTraceId={agentTraceId}
                            visualizeQuery={scriptData?.annotations.visualizeQuery ?? null}
                            logRequest={logRequest}
                            onShowStatus={() => onShowStatus(scriptFileName)}
                            onShowAgentStatus={() => onShowAgentStatus(scriptFileName)}
                            onShowTable={() => onShowTable(scriptFileName)}
                            onShowVisualization={() => onShowVisualization(scriptFileName)}
                        />
                    ) : null}
                </div>
            </div>
        </div>
    );
};

interface ScriptFeedRowProps {
    sessionId: string;
    connectorIcon: string;
    entries: ReturnType<typeof getSelectedPageEntries>;
    scripts: NotebookState['scripts'];
    folderName: string;
    scriptDebugMode: boolean;
    focusedFileName: string;
    executableScriptKeys: ReadonlySet<number>;
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
    cachedScriptKeys: ReadonlySet<number>;
    previewHints: ReadonlyMap<number, ScriptPreviewHint>;
    onHeightMeasured: (scriptId: number, height: number) => void;
    onFormattedText: (scriptId: number, scriptText: string) => void;
    heightsVersion: number;
}

function ScriptFeedRow(props: RowComponentProps<ScriptFeedRowProps>) {
    const { sessionId, connectorIcon, entries, scripts, folderName, scriptDebugMode, focusedFileName, executableScriptKeys, canUseAI, canDelete, onFocus, onExpand, onDelete, onRename, onMoveUp, onMoveDown, onExecute, onUseAIContext, onShowStatus, onShowAgentStatus, onShowTable, onShowVisualization, onRerun, onAcceptDiff, onRejectDiff, cachedScriptKeys, previewHints, onHeightMeasured, onFormattedText } = props;
    const isFillerRow = props.index === 0 || props.index > entries.length;
    const entryIndex = props.index - 1;
    const entry = !isFillerRow ? entries[entryIndex] : undefined;
    const scriptData = entry != null ? scripts[entry.scriptId] : undefined;
    const scriptFileName = entry?.fileName ?? '01-script.sql';
    const previewHint = entry != null ? previewHints.get(entry.scriptId) : undefined;
    const cachedHeight = previewHint?.height;
    // entries are in feed order, so position bounds drive the move-button enablement.
    const canMoveUp = !isFillerRow && entryIndex > 0;
    const canMoveDown = !isFillerRow && entryIndex < entries.length - 1;
    const outerRef = React.useRef<HTMLDivElement>(null);
    const [previewReady, setPreviewReady] = React.useState(false);

    React.useLayoutEffect(() => {
        setPreviewReady(false);
    }, [entry?.scriptId, scriptData?.scriptAnalysis.buffers, scriptData?.latestQueryId, scriptData?.latestAgentRunId, scriptData?.pendingDiff]);
    const handlePreviewReady = React.useCallback(() => setPreviewReady(true), []);
    const handleFormattedText = React.useCallback((scriptText: string) => {
        if (entry != null) onFormattedText(entry.scriptId, scriptText);
    }, [entry, onFormattedText]);

    React.useLayoutEffect(() => {
        if (entry == null) return;
        const element = outerRef.current;
        if (element == null) return;

        const measure = () => {
            const height = element.getBoundingClientRect().height;
            if (!(height > 0)) return;
            if (!previewReady) {
                // While a remounted preview is still empty, retain the cached height instead of
                // recording a transient shrink. Result content may grow independently of the SQL
                // preview, though, so immediately accept measurements above the cached hint.
                if (cachedHeight == null || height <= cachedHeight + HEIGHT_CHANGE_EPSILON) return;
            }
            onHeightMeasured(entry.scriptId, height);
        };

        // Observe immediately so result cards can grow even while SQL is being reformatted. The
        // measure guard above is what prevents a remount's empty editor from shrinking the row.
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [cachedHeight, entry, onHeightMeasured, previewReady]);

    if (isFillerRow) {
        return <div className={styles.feed_list_filler} style={props.style} />;
    }

    return (
        <div
            ref={outerRef}
            style={{
                ...props.style,
                height: 'auto',
                minHeight: !previewReady ? cachedHeight : undefined,
            }}
        >
            <div
                className={styles.feed_list_item}
            >
                <ScriptCard
                    key={entry?.scriptId}
                    sessionId={sessionId}
                    connectorIcon={connectorIcon}
                    isFocused={scriptFileName === focusedFileName}
                    scriptData={scriptData}
                    folderName={folderName}
                    scriptFileName={scriptFileName}
                    scriptDebugMode={scriptDebugMode}
                    canExecute={scriptData != null && executableScriptKeys.has(scriptData.scriptKey)}
                    canUseAI={canUseAI}
                    canDelete={canDelete}
                    canMoveUp={canMoveUp}
                    canMoveDown={canMoveDown}
                    onFocus={onFocus}
                    onExpand={onExpand}
                    onDelete={onDelete}
                    onRename={onRename}
                    onMoveUp={onMoveUp}
                    onMoveDown={onMoveDown}
                    onExecute={onExecute}
                    onUseAIContext={onUseAIContext}
                    onShowStatus={onShowStatus}
                    onShowAgentStatus={onShowAgentStatus}
                    onShowTable={onShowTable}
                    onShowVisualization={onShowVisualization}
                    onRerun={onRerun}
                    onAcceptDiff={onAcceptDiff}
                    onRejectDiff={onRejectDiff}
                    hasCachedResult={scriptData != null && cachedScriptKeys.has(scriptData.scriptKey)}
                    onPreviewReady={handlePreviewReady}
                    initialPreviewText={previewHint?.formattedText ?? ''}
                    onFormattedText={handleFormattedText}
                />
            </div>
        </div>
    );
}

export const NotebookScriptFeed: React.FC<NotebookScriptListProps> = (props) => {
    const config = useAppConfig();
    const scriptDebugMode = config?.settings?.scriptDebugMode ?? false;
    const entries = getSelectedPageEntries(props.notebook);
    const storageReader = useStorageReader();
    const [cachedScriptKeys, setCachedScriptKeys] = React.useState<ReadonlySet<number>>(() => new Set());
    const cacheCandidates = entries.flatMap(entry => {
        const scriptData = props.notebook.scripts[entry.scriptId];
        if (scriptData == null || scriptData.latestQueryId != null) return [];
        const queryText = tryGetExecutableQueryText(props.notebook, scriptData);
        return queryText != null && queryText.trim().length > 0
            ? [{ scriptKey: scriptData.scriptKey, queryText }]
            : [];
    });
    const cacheCandidateSignature = cacheCandidates
        .map(candidate => `${candidate.scriptKey}:${candidate.queryText}`)
        .join('\n');

    // Inspect cache metadata only. This identifies cached cards without loading Arrow payloads or
    // creating query executions during notebook navigation.
    React.useEffect(() => {
        let cancelled = false;
        const findCachedScripts = async () => {
            if (props.conn == null) {
                setCachedScriptKeys(new Set());
                return;
            }
            const files = await storageReader.backend.listQueryResultCache(props.notebook.sessionId).catch(() => []);
            if (cancelled) return;
            const cacheKeys = new Set(files.map(file => file.name.endsWith(STORAGE_CACHE_EXTENSION)
                ? file.name.slice(0, -STORAGE_CACHE_EXTENSION.length)
                : file.name));
            if (cacheKeys.size === 0) {
                setCachedScriptKeys(new Set());
                return;
            }
            const matches = await Promise.all(cacheCandidates.map(async candidate => {
                const key = await computeQueryCacheKeyForConnection(props.conn!.details, candidate.queryText);
                return key != null && cacheKeys.has(key) ? candidate.scriptKey : null;
            }));
            if (!cancelled) {
                setCachedScriptKeys(new Set(matches.filter((key): key is number => key != null)));
            }
        };
        void findCachedScripts();
        return () => { cancelled = true; };
    }, [props.conn?.details, props.notebook.sessionId, cacheCandidateSignature, storageReader.backend]);

    const pendingScrollToBottomRef = React.useRef(false);
    const [composeEditorView, setComposeEditorView] = React.useState<EditorView | null>(null);
    const [aiContextScriptKey, setAIContextScriptKey] = React.useState<number | null>(null);

    // The SQL/AI input mode is hoisted into the command context so the "Switch Mode" command
    // and the Ctrl+M shortcut can drive it from outside the feed.
    const { mode: inputMode, setMode: setInputMode } = useComposeInputMode();

    const aiContextScript = aiContextScriptKey != null
        ? props.notebook.scripts[aiContextScriptKey] ?? null
        : null;
    const aiContextName = aiContextScript != null ? scriptDisplayName(aiContextScript.fileName) : null;

    // Context is scoped to the current page/session. Within that scope it is stable by script key,
    // so hover selection and renames cannot silently retarget a prompt.
    const contextScopeRef = React.useRef({
        sessionId: props.notebook.sessionId,
        folderName: props.notebook.notebookUserFocus.folderName,
    });
    React.useEffect(() => {
        const nextScope = {
            sessionId: props.notebook.sessionId,
            folderName: props.notebook.notebookUserFocus.folderName,
        };
        if (contextScopeRef.current.sessionId !== nextScope.sessionId
            || contextScopeRef.current.folderName !== nextScope.folderName) {
            contextScopeRef.current = nextScope;
            setAIContextScriptKey(null);
        }
    }, [props.notebook.sessionId, props.notebook.notebookUserFocus.folderName]);
    React.useEffect(() => {
        if (aiContextScriptKey != null && aiContextScript == null) {
            setAIContextScriptKey(null);
        }
    }, [aiContextScript, aiContextScriptKey]);

    // SQL and AI use two distinct editor instances. When a toggle swaps them, the freshly
    // mounted editor should inherit focus so the keyboard flow continues uninterrupted.
    const refocusComposeRef = React.useRef(false);

    // The AI prompt editor is unmounted whenever we toggle back to SQL, so its draft text lives
    // here (the SQL draft already persists via the notebook's uncommitted script). This seeds the
    // editor on remount and is kept current via PromptEditor's onChange.
    const aiPromptTextRef = React.useRef('');

    // The AI compose mode is only available when an AI provider is configured.
    const aiClient = useAIClient();
    const aiAvailable = aiClient != null;
    const sessionId = props.notebook.sessionId;
    const startAgentRun = useStartAgentRun();
    const cancelAgentRun = useCancelAgentRun();
    const agentState = useLatestAgentRunState(sessionId);
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
        props.modifyNotebook({ type: SELECT_ENTRY, value: fileName });
    }, [props.modifyNotebook]);

    const handleExpand = React.useCallback((fileName: string) => {
        props.modifyNotebook({ type: SELECT_ENTRY, value: fileName });
        props.showDetails(fileName);
    }, [props.modifyNotebook, props.showDetails]);

    const handleShowStatus = React.useCallback((fileName: string) => {
        props.modifyNotebook({ type: SELECT_ENTRY, value: fileName });
        props.showDetails(fileName, DetailsTabKey.QueryStatusPanel);
    }, [props.modifyNotebook, props.showDetails]);

    const handleShowAgentStatus = React.useCallback((fileName: string) => {
        props.modifyNotebook({ type: SELECT_ENTRY, value: fileName });
        props.showDetails(fileName, DetailsTabKey.AgentStatusPanel);
    }, [props.modifyNotebook, props.showDetails]);

    const handleShowTable = React.useCallback((fileName: string) => {
        props.modifyNotebook({ type: SELECT_ENTRY, value: fileName });
        props.showDetails(fileName, DetailsTabKey.QueryResultView);
    }, [props.modifyNotebook, props.showDetails]);

    const handleShowVisualization = React.useCallback((fileName: string) => {
        props.modifyNotebook({ type: SELECT_ENTRY, value: fileName });
        props.showDetails(fileName, DetailsTabKey.Visualization);
    }, [props.modifyNotebook, props.showDetails]);

    const isDisconnected = props.conn?.connectionHealth !== ConnectionHealth.ONLINE;
    const openConnectionOverlay = props.openConnectionOverlay;
    const executeQuery = useQueryExecutor();

    // Re-execute the visualization after the agent finishes editing it.
    //
    // The reducer that applies the agent's result (SET_SCRIPT_TEXT) already *reevaluates* the
    // script: it re-analyzes and refreshes annotations.visualizeQuery, and the editor/preview
    // re-sync from the new scriptData. What it can't do is re-run the resolved query — so a
    // VISUALIZE the agent just rewrote would still render its stale result. We kick that
    // re-execution here, where the live notebook, executor and connection state are available.
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
        // Handle each successful run exactly once (the effect re-runs as notebook state settles).
        if (executedAgentRunRef.current === agentState.runId) {
            return;
        }
        const scriptKey = agentState.contextScriptKey;
        if (scriptKey == null || isDisconnected) {
            return;
        }
        const scriptData = props.notebook.scripts[scriptKey];
        if (scriptData == null || scriptData.annotations.visualizeQuery == null) {
            return;
        }
        executedAgentRunRef.current = agentState.runId;
        // Resolve against the current notebook so a freshly rewritten VISUALIZE source is reflected.
        const queryText = getExecutableQueryText(props.notebook, scriptData);
        if (queryText.trim().length === 0) {
            return;
        }
        const [queryId, execution] = executeQuery(props.notebook.sessionId, {
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
        registerNotebookQuery(scriptData, queryId, queryText, execution, props.modifyNotebook);
    }, [agentState, props.notebook, props.modifyNotebook, isDisconnected, executeQuery]);

    const handleSend = React.useCallback((execute: boolean) => {
        pendingScrollToBottomRef.current = true;
        const notebook = props.notebook;
        const scriptKey = notebook.uncommittedScriptId;
        const scriptData = notebook.scripts[scriptKey];

        // The compose editor keeps the draft analyzed as it is typed, so the
        // resolved VISUALIZE query / derived annotations are already present (and
        // carried across promotion, which preserves the script key).
        const queryText = scriptData ? getExecutableQueryText(notebook, scriptData) : '';
        props.modifyNotebook({ type: PROMOTE_UNCOMMITTED_SCRIPT, value: null });
        if (execute && !isDisconnected && queryText.trim().length > 0) {
            const [queryId, execution] = executeQuery(notebook.sessionId, {
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
            registerNotebookQuery(scriptData, queryId, queryText, execution, props.modifyNotebook);
        }
    }, [props.notebook, props.modifyNotebook, isDisconnected, executeQuery]);

    // Refresh: drop the stale cache entry for a script's result, then re-execute — a plain cacheable
    // run then misses the cache and re-populates it. Resolves the script by feed file name.
    const handleRerunEntry = React.useCallback(async (fileName: string, cacheKey: string | null) => {
        if (isDisconnected) {
            return;
        }
        const notebook = props.notebook;
        const entry = notebook.notebookPages[notebook.notebookUserFocus.folderName]?.scripts[fileName];
        const scriptData = entry != null ? notebook.scripts[entry.scriptId] : undefined;
        if (scriptData == null) {
            return;
        }
        // Best-effort delete of the stale cache entry: a failed delete just means the run may hit the
        // old entry, which is harmless (the executor's write path overwrites it either way).
        if (cacheKey != null) {
            await storageReader.backend.deleteQueryResultCache(notebook.sessionId, cacheKey).catch(() => { });
        }
        rerunEntry(notebook, scriptData, executeQuery, props.modifyNotebook);
    }, [props.notebook, props.modifyNotebook, isDisconnected, executeQuery, storageReader]);

    const handleExecuteEntry = React.useCallback((fileName: string) => {
        if (isDisconnected) return;
        const notebook = props.notebook;
        const entry = notebook.notebookPages[notebook.notebookUserFocus.folderName]?.scripts[fileName];
        const scriptData = entry != null ? notebook.scripts[entry.scriptId] : undefined;
        if (scriptData == null) return;
        rerunEntry(notebook, scriptData, executeQuery, props.modifyNotebook);
    }, [executeQuery, isDisconnected, props.modifyNotebook, props.notebook]);

    // Send the compose editor's text to the agent run as a natural-language prompt. Context is
    // explicit: no bean means a blank-draft run rather than an implicit hover-selected target.
    const handleSendAI = React.useCallback(() => {
        if (!aiAvailable) return;
        const prompt = composeEditorView?.state.doc.toString().trim() ?? '';
        if (prompt.length === 0) return;
        const contextScriptKey = aiContextScript?.scriptKey ?? null;

        // Build the notebook adapter the run acts on. It closes over the focused script + the
        // notebook dispatch; for visualize runs it also exposes each script's last-execution output
        // schema (from the connection state) so the agent context can describe the chart's columns.
        const host = createNotebookAgentHost({
            notebook: props.notebook,
            contextScriptKey,
            modifyNotebook: props.modifyNotebook,
            resolveOutputColumns: (scriptKey) => outputColumnsForScript(props.notebook, props.conn, scriptKey),
        });
        startAgentRun({
            sessionId: props.notebook.sessionId,
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
    }, [aiAvailable, aiContextScript, composeEditorView, props.notebook, props.conn, props.modifyNotebook, startAgentRun]);

    const handleComposeSend = React.useCallback(() => {
        if (inputMode === 1) {
            handleSendAI();
        } else {
            handleSend(true);
        }
    }, [inputMode, handleSendAI, handleSend]);

    const handleDelete = React.useCallback((fileName: string) => {
        props.modifyNotebook({ type: DELETE_NOTEBOOK_ENTRY, value: fileName });
    }, [props.modifyNotebook]);

    const handleRename = React.useCallback((oldFileName: string, newFileName: string) => {
        props.modifyNotebook({ type: UPDATE_NOTEBOOK_ENTRY, value: { fileName: oldFileName, newFileName } });
    }, [props.modifyNotebook]);

    // Move a script one position up/down within its page by swapping it with its neighbour in the
    // feed order and dispatching the new full order to REORDER_NOTEBOOK_SCRIPTS.
    const moveScript = React.useCallback((fileName: string, delta: number) => {
        const page = getSelectedPage(props.notebook);
        if (page == null) return;
        const order = getSortedFileNames(page);
        const from = order.indexOf(fileName);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= order.length) return;
        [order[from], order[to]] = [order[to], order[from]];
        props.modifyNotebook({ type: REORDER_NOTEBOOK_SCRIPTS, value: order });
    }, [props.notebook, props.modifyNotebook]);
    const handleMoveUp = React.useCallback((fileName: string) => moveScript(fileName, -1), [moveScript]);
    const handleMoveDown = React.useCallback((fileName: string) => moveScript(fileName, 1), [moveScript]);

    // Accept / reject a staged agent rewrite from the feed. These dispatch notebook actions (the
    // feed shows the diff on the read-only preview, so there's no editor to drive the editor-effect
    // path). Accept keeps the new text; reject restores the prior text and re-analyzes.
    const handleAcceptDiff = React.useCallback((scriptKey: number) => {
        props.modifyNotebook({ type: ACCEPT_PENDING_DIFF, value: scriptKey });
    }, [props.modifyNotebook]);
    const handleRejectDiff = React.useCallback((scriptKey: number) => {
        props.modifyNotebook({ type: REJECT_PENDING_DIFF, value: scriptKey });
    }, [props.modifyNotebook]);

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
            // Plain Enter, while browsing the feed with nothing focused. If the focused entry has a
            // staged agent rewrite, Enter accepts it (matching the status bar's "Accept ⏎" hint);
            // otherwise it opens the details of the focused entry. If the compose editor (SQL/AI), a
            // rename input, or any other element holds focus, Enter belongs to it — bail out.
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
                const focused = getSelectedEntry(props.notebook);
                const focusedScript = focused != null ? props.notebook.scripts[focused.scriptId] : null;
                if (focusedScript?.pendingDiff != null) {
                    event.preventDefault();
                    handleAcceptDiff(focusedScript.scriptKey);
                    return;
                }
                if (entries.length === 0) {
                    return;
                }
                event.preventDefault();
                props.showDetails(focused?.fileName);
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
                const focused = getSelectedEntry(props.notebook);
                const focusedScript = focused != null ? props.notebook.scripts[focused.scriptId] : null;
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
    ], [feedActive, composeEditorView, handleComposeSend, entries.length, props.showDetails, props.notebook, handleAcceptDiff, handleRejectDiff]);
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
            index: entries.length + 1,
            align: 'end',
        });
    }, [entries.length, listRef]);

    // Read entries via ref so this effect runs only when scrollTarget changes,
    // not on every re-render (e.g. hover-driven SELECT_ENTRY) which would yank
    // the feed back to the last keyboard-set target while the user mouse-scrolls.
    const entriesRef = React.useRef(entries);
    entriesRef.current = entries;

    // Scroll a requested entry to the top of the feed. This fires for the keyboard step commands
    // (Ctrl+J/K bump the target) and when the notebook focus is re-asserted on return from Details.
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
        const targetIdx = currentEntries.findIndex(e => e.fileName === props.scrollTarget!.fileName);
        if (targetIdx === -1) {
            return;
        }
        listRef.current.scrollToRow({
            index: targetIdx + 1,
            align: 'start',
        });
    }, [listRef, props.scrollTarget]);

    // Get folder name from current page (display-only: strip the on-disk ordering prefix)
    const selectedPage = getSelectedPage(props.notebook);
    const folderName = normalizePageName(selectedPage?.folderName ?? '') || 'Untitled';
    const executableScriptKeys = React.useMemo(() => {
        if (isDisconnected) return new Set<number>();
        return new Set(entries.flatMap(entry => {
            const scriptData = props.notebook.scripts[entry.scriptId];
            return scriptData != null && (tryGetExecutableQueryText(props.notebook, scriptData)?.trim().length ?? 0) > 0
                ? [scriptData.scriptKey]
                : [];
        }));
    }, [entries, isDisconnected, props.notebook]);

    const pageCount = Object.keys(props.notebook.notebookPages).length;
    const canDelete = pageCount > 1 || entries.length > 1;
    const rowProps = React.useMemo<ScriptFeedRowProps>(() => ({
        sessionId: props.notebook.sessionId,
        connectorIcon: props.notebook.connectorInfo.icons?.outlines ?? 'database_16',
        entries,
        scripts: props.notebook.scripts,
        folderName,
        scriptDebugMode,
        focusedFileName: props.notebook.notebookUserFocus.fileName,
        executableScriptKeys,
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
        cachedScriptKeys,
        previewHints: previewHintsRef.current,
        onHeightMeasured: handleHeightMeasured,
        onFormattedText: handleFormattedText,
        heightsVersion,
    }), [entries, props.notebook.scripts, props.notebook.connectorInfo.icons?.outlines, props.notebook.notebookUserFocus.fileName, folderName, scriptDebugMode, executableScriptKeys, aiAvailable, canDelete, handleFocus, handleExpand, handleDelete, handleRename, handleMoveUp, handleMoveDown, handleExecuteEntry, handleUseAIContext, handleShowStatus, handleShowAgentStatus, handleShowTable, handleShowVisualization, handleRerunEntry, handleAcceptDiff, handleRejectDiff, cachedScriptKeys, handleHeightMeasured, handleFormattedText, heightsVersion]);

    return (
        <div className={styles.feed_body_container} data-tauri-drag-region="deep">
            <div className={styles.feed_list_container} ref={listContainerRef}>
                <List
                    key={props.notebook.notebookUserFocus.folderName}
                    listRef={listRef}
                    style={{
                        width: listWidth,
                        height: listHeight,
                        overflowX: 'hidden',
                        scrollbarGutter: 'stable',
                        '--feed-scrollbar-inset': `${listScrollbarInset}px`,
                    } as React.CSSProperties}
                    rowCount={entries.length + 2}
                    overscanCount={OVERSCAN_ROW_COUNT}
                    rowHeight={(rowIndex) => {
                        if (rowIndex === 0) {
                            return FEED_EDGE_PADDING;
                        }
                        if (rowIndex <= entries.length) {
                            const scriptId = entries[rowIndex - 1].scriptId;
                            return previewHintsRef.current.get(scriptId)?.height ?? ESTIMATED_ROW_HEIGHT;
                        }
                        return fillerRowHeight + FEED_EDGE_PADDING;
                    }}
                    rowComponent={ScriptFeedRow}
                    rowProps={rowProps}
                />
            </div>
            <div className={styles.compose_section} ref={composeSectionRef}>
                <div className={styles.compose_card}>
                    {inputMode === 1 ? (
                        // AI mode: an isolated, plugin-free prompt editor (no SQL parsing,
                        // autocompletion or notebook-state wiring — the text is just a prompt).
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
                            sessionId={props.notebook.sessionId}
                            scriptKey={getUncommittedScriptData(props.notebook)?.scriptKey ?? 0}
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
                                        onClick={() => cancelAgentRun(sessionId)}
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
