import * as React from 'react';
import * as styles from './notebook_feed.module.css';

import type { Icon } from '@primer/octicons-react';
import { PaperAirplaneIcon, SparklesFillIcon, SquareFillIcon } from '@primer/octicons-react';
import symbols from '@ankoh/dashql-svg-symbols';
import type { RowComponentProps } from 'react-window';

import { ButtonSize, ButtonVariant, IconButton } from '../../../../ui/foundations/button.js';
import { ButtonGroup } from '../../../../ui/foundations/button_group.js';
import { IndicatorStatus } from '../../../../ui/foundations/status_indicator.js';
import { SymbolIcon } from '../../../../ui/foundations/symbol_icon.js';
import { useAgentRunState, useCancelAgentRun } from '../../agent/agent_run_provider.js';
import type { ConnectionState } from '../../connections/connection_state.js';
import { queryIsDone } from '../../connections/query_execution_state.js';
import { computeQueryCacheKeyForConnection, useCancelQuery, useQueryState } from '../../connections/query_executor.js';
import type { StorageReader } from '../../persistence/storage_provider.js';
import { compileNotebookQuery, getSelectedScriptRefs, type NotebookScripts, type ScriptData } from '../../scripts/notebook_scripts.js';
import { scriptDisplayName } from '../../scripts/script_types.js';
import { deriveEntryStatus, EntryStatusKind } from '../entry_status_model.js';
import { EntryStatusBar } from '../entry_status_bar.js';
import { CachedResultBean, QueryResultCacheLabel, QueryResultRerunButton } from '../query_result_cache_controls.js';
import { ScriptDiagnosticsButton } from '../script_diagnostics.js';
import { ScriptName } from '../script_name.js';
import { ScriptPreview } from '../script_preview.js';
import { ScriptStatisticsBar } from '../script_statistics_bar.js';
import { FeedEntryFooter } from './feed_entry_footer.js';
import type { ScriptPreviewHint } from './notebook_feed_layout.js';

const HEIGHT_CHANGE_EPSILON = 0.5;

export interface ScriptCardProps {
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

export const ScriptCard: React.FC<ScriptCardProps> = (props: ScriptCardProps) => {
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

    // The status bar above the body generalizes the former "AI bar": while any work is in flight —
    // an agent run *or* a query execution — it's a compact strip (spinner + latest log line / query
    // status) instead of yanking the user to the raw trace. The body keeps rendering the current
    // output; the user opts into the full trace by clicking the bar. The server message only appears
    // after execution starts and persists in terminal states. A staged rewrite doesn't feed it —
    // Accept/Reject controls live on the body overlay — so the bar stays free to show the rewritten
    // statement's re-execution status.
    const entryStatus = deriveEntryStatus(agentRunState, queryState);
    const cancelEntryOperation = React.useCallback(() => {
        if (entryStatus?.kind === EntryStatusKind.Agent) {
            cancelAgentRun(props.notebookId);
        } else if (entryStatus?.kind === EntryStatusKind.Query && props.scriptData?.latestQueryId != null) {
            if (props.connection != null) cancelQuery(props.connection.connectionId, props.scriptData.latestQueryId);
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
            data-electron-drag-region="false"
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
                                    if (props.connection != null) cancelQuery(props.connection.connectionId, props.scriptData.latestQueryId);
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
            {entryStatus.kind !== EntryStatusKind.Idle && (
                <div className={styles.feed_entry_message_server}>
                    <div className={styles.feed_entry_avatar_server} aria-hidden="true">
                        <svg width="16" height="16">
                            <use xlinkHref={`${symbols}#${connectorIcon}`} />
                        </svg>
                    </div>
                    <div
                        className={styles.feed_entry_card_server}
                        data-result-card
                        data-unfocused={props.isFocused ? undefined : 'true'}
                    >
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
            )}
        </div>
    );
};

export interface ScriptFeedRowProps {
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

export function ScriptFeedRow(props: RowComponentProps<ScriptFeedRowProps>) {
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
    }, [entry?.scriptId, scriptData?.editorUpdate?.stateRevision, scriptData?.pendingDiff]);
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
            <div className={styles.feed_list_item}>
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
