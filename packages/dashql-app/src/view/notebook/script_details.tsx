import * as React from 'react';
import * as styles from './script_details.module.css';
import * as dashql from '../../core/index.js';
import { EditorView } from '@codemirror/view';
import { EditorState, EditorSelection } from '@codemirror/state';
import { DashQLCompletionAbortEffect, DashQLCompletionStatus, DashQLProcessorPlugin } from '../editor/dashql_processor.js';

import icons from '@ankoh/dashql-svg-symbols';

import type { Icon } from '@primer/octicons-react';

import { ButtonSize, ButtonVariant, IconButton } from '../foundations/button.js';
import { ButtonGroup } from '../foundations/button_group.js';
import { KeyEventHandler, useKeyEvents } from '../../utils/key_events.js';
import { QueryExecutionStatus } from '../../connection/query_execution_state.js';
import { QueryResultView } from '../query_result/query_result_view.js';
import { ConnectionState } from '../../connection/connection_state.js';
import { useCancelQuery, useQueryState, useQueryExecutor } from '../../connection/query_executor.js';
import { useAgentRunState, useCancelAgentRun } from '../../agent/agent_run_provider.js';
import { EntryStatusBar } from './entry_status_bar.js';
import { deriveEntryStatus, EntryStatusKind } from './entry_status_model.js';
import { TraceLogPanel } from './trace_log_panel.js';
import { TabHeader, useResultRowCount, formatRowCountDetail } from './tab_header.js';
import { QueryResultCacheLabel, QueryResultRerunButton } from './query_result_cache_controls.js';
import { ACCEPT_PENDING_DIFF, getSelectedScriptRef, getSelectedScriptFolder, NotebookScripts, REJECT_PENDING_DIFF, RENAME_SCRIPT } from '../../scripts/notebook_scripts.js';
import { rerunEntry } from './rerun_query.js';
import { useStorageReader } from '../../platform/storage/storage_provider.js';
import { normalizeScriptFolderName, scriptDisplayName } from '../../scripts/script_types.js';
import type { ModifyNotebookScripts } from '../../scripts/notebook_scripts_registry.js';
import { useAppConfig } from '../../app_config.js';
import { ScriptEditor } from './script_editor.js';
import { acceptPendingDiff, rejectPendingDiff } from '../editor/dashql_diff_hint.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';
import { VerticalTabs, VerticalTabVariant } from '../foundations/vertical_tabs.js';
import { ScriptName } from './script_name.js';
import { ScriptStatisticsBar } from './script_statistics_bar.js';
import { VisualizationDispatch } from '../visualization/visualization_dispatch.js';
import { IndicatorStatus } from '../foundations/status_indicator.js';
import { ColumnAggregationBar } from '../visualization/column_aggregation_bar.js';
import { createReadonlyCodeMirrorExtensions } from '../editor/codemirror.js';
import { DashQLUpdateEffect, DashQLScriptBuffers, analyzeScript } from '../editor/dashql_processor.js';

export enum TabKey {
    Editor = 0,
    QueryStatusPanel = 1,
    QueryResultView = 2,
    Visualization = 3,
    AgentStatusPanel = 4,
}

export interface ScriptDetailsProps {
    notebookScripts: NotebookScripts;
    modifyNotebookScripts: ModifyNotebookScripts;
    connection: ConnectionState | null;
    hideDetails: () => void;
    scriptId?: number;
    initialTab?: TabKey;
}

export const ScriptDetails: React.FC<ScriptDetailsProps> = (props) => {
    const config = useAppConfig();
    const showServerDetails = props.initialTab != null && props.initialTab !== TabKey.Editor;
    const [selectedTab, selectTab] = React.useState<TabKey>(() => {
        if (props.initialTab != null && props.initialTab !== TabKey.Editor) return props.initialTab;
        const initialPage = getSelectedScriptFolder(props.notebookScripts);
        const initialEntry = props.scriptId != null
            ? Object.values(initialPage?.scripts ?? {}).find(entry => entry.scriptId === props.scriptId)
            : getSelectedScriptRef(props.notebookScripts);
        const initialScript = initialEntry != null ? props.notebookScripts.scripts[initialEntry.scriptId] : null;
        const initialQuery = initialScript?.latestQueryId != null
            ? props.connection?.queriesActive.get(initialScript.latestQueryId)
                ?? props.connection?.queriesFinished.get(initialScript.latestQueryId)
                ?? null
            : null;
        if (initialQuery?.status === QueryExecutionStatus.SUCCEEDED) {
            return initialScript?.annotations.visualizeQuery != null
                ? TabKey.Visualization
                : TabKey.QueryResultView;
        }
        return initialScript?.latestAgentRunId != null ? TabKey.AgentStatusPanel : TabKey.QueryStatusPanel;
    });
    const [editorView, setEditorView] = React.useState<EditorView | null>(null);
    const [formatPending, setFormatPending] = React.useState(false);
    const savedEditorStateRef = React.useRef<EditorState | null>(null);
    const formattedTextRef = React.useRef<string | null>(null);
    const formatPreviewBuffersRef = React.useRef<DashQLScriptBuffers | null>(null);
    const formatPreviewScriptRef = React.useRef<dashql.DashQLScript | null>(null);

    const selectedPage = getSelectedScriptFolder(props.notebookScripts);
    const notebookEntry = props.scriptId != null
        ? Object.values(selectedPage?.scripts ?? {}).find(entry => entry.scriptId === props.scriptId)
        : getSelectedScriptRef(props.notebookScripts);
    const scriptData = notebookEntry != null ? props.notebookScripts.scripts[notebookEntry.scriptId] : null;

    // Get folder name and script file name (display-only: strip the on-disk ordering prefix). The
    // raw scriptFileName stays the rename identity; the label and draft use the clean display name
    // (no prefix, no ".sql").
    const folderName = normalizeScriptFolderName(selectedPage?.folderName ?? '') || 'Untitled';
    const scriptFileName = notebookEntry?.fileName ?? '01-script.sql';
    const scriptDisplay = scriptDisplayName(scriptFileName);

    const PencilIcon: Icon = SymbolIcon('pencil_16');
    const PencilAIIcon: Icon = SymbolIcon('pencil_ai_16');
    const CheckIcon: Icon = SymbolIcon('check_16');
    const FormatXIcon: Icon = SymbolIcon('x_16');
    const [isEditingName, setIsEditingName] = React.useState(false);
    const [draftFileName, setDraftFileName] = React.useState(scriptDisplay);
    const editInputRef = React.useRef<HTMLInputElement>(null);

    const startEditingName = React.useCallback((event?: React.MouseEvent) => {
        event?.stopPropagation();
        setDraftFileName(scriptDisplay);
        setIsEditingName(true);
    }, [scriptDisplay]);

    const saveNameEdit = React.useCallback(() => {
        const trimmed = draftFileName.trim();
        if (trimmed && trimmed !== scriptDisplay) {
            props.modifyNotebookScripts({ type: RENAME_SCRIPT, value: { fileName: scriptFileName, newFileName: trimmed } });
        }
        setIsEditingName(false);
    }, [draftFileName, scriptDisplay, scriptFileName, props.modifyNotebookScripts]);

    const cancelNameEdit = React.useCallback(() => {
        setIsEditingName(false);
    }, []);

    React.useEffect(() => {
        if (isEditingName && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [isEditingName]);

    React.useEffect(() => {
        setIsEditingName(false);
        if (formatPending) {
            formatPreviewBuffersRef.current?.destroy(formatPreviewBuffersRef.current);
            formatPreviewBuffersRef.current = null;
            formatPreviewScriptRef.current?.ptr.destroy();
            formatPreviewScriptRef.current = null;
            savedEditorStateRef.current = null;
            formattedTextRef.current = null;
            setFormatPending(false);
        }
    }, [notebookEntry?.scriptId]);

    const handleFormat = React.useCallback(() => {
        if (editorView == null || scriptData == null) return;
        try {
            const config = new dashql.buffers.formatting.FormattingConfigT(
                dashql.buffers.formatting.FormattingDialect.DUCKDB,
                dashql.buffers.formatting.FormattingMode.PRETTY,
                80,
                4,
            );
            const formattedScript = scriptData.script.format(config, null);
            const formattedText = formattedScript.toString();

            const currentText = editorView.state.doc.toString();
            if (formattedText === currentText) {
                formattedScript.ptr.destroy();
                return;
            }

            formattedScript.parse();
            const previewBuffers = analyzeScript(formattedScript);

            savedEditorStateRef.current = editorView.state;
            formattedTextRef.current = formattedText;
            formatPreviewBuffersRef.current?.destroy(formatPreviewBuffersRef.current);
            formatPreviewBuffersRef.current = previewBuffers;
            formatPreviewScriptRef.current?.ptr.destroy();
            formatPreviewScriptRef.current = formattedScript;

            const readonlyExtensions = createReadonlyCodeMirrorExtensions();
            const previewState = EditorState.create({
                doc: formattedText,
                extensions: readonlyExtensions,
            });
            editorView.setState(previewState);
            editorView.contentDOM.blur();

            editorView.dispatch({
                effects: [
                    DashQLUpdateEffect.of({
                        config: {},
                        scriptRegistry: null,
                        scriptKey: formattedScript.getCatalogEntryId(),
                        script: formattedScript,
                        scriptBuffers: previewBuffers,
                        scriptCursor: null,
                        scriptCompletion: null,
                        scriptPendingDiff: null,
                        derivedFocus: null,
                        onUpdate: () => { },
                    }),
                ],
            });

            setFormatPending(true);
        } catch {
            // Format failed
        }
    }, [editorView, scriptData]);

    const handleFormatAccept = React.useCallback(() => {
        if (editorView == null || savedEditorStateRef.current == null || formattedTextRef.current == null) return;

        document.getSelection()?.removeAllRanges();
        editorView.setState(savedEditorStateRef.current);
        editorView.dispatch({
            changes: { from: 0, to: editorView.state.doc.length, insert: formattedTextRef.current },
            selection: EditorSelection.cursor(0),
        });

        formatPreviewBuffersRef.current?.destroy(formatPreviewBuffersRef.current);
        formatPreviewBuffersRef.current = null;
        formatPreviewScriptRef.current?.ptr.destroy();
        formatPreviewScriptRef.current = null;
        savedEditorStateRef.current = null;
        formattedTextRef.current = null;
        setFormatPending(false);
    }, [editorView]);

    const handleFormatCancel = React.useCallback(() => {
        if (editorView == null || savedEditorStateRef.current == null) return;

        document.getSelection()?.removeAllRanges();
        editorView.setState(savedEditorStateRef.current);
        editorView.dispatch({
            selection: EditorSelection.cursor(0),
        });

        formatPreviewBuffersRef.current?.destroy(formatPreviewBuffersRef.current);
        formatPreviewBuffersRef.current = null;
        formatPreviewScriptRef.current?.ptr.destroy();
        formatPreviewScriptRef.current = null;
        savedEditorStateRef.current = null;
        formattedTextRef.current = null;
        setFormatPending(false);
    }, [editorView]);

    React.useEffect(() => {
        return () => {
            formatPreviewBuffersRef.current?.destroy(formatPreviewBuffersRef.current);
            formatPreviewScriptRef.current?.ptr.destroy();
        };
    }, []);

    // A staged agent rewrite is shown as an in-place diff on the editable editor here (the diff
    // decorations + ⏎/⎋ keymap come from the editor's DashQL extensions). Surface visible controls
    // too, mirroring the feed's status bar. Both drive the editor-effect accept/reject path, which
    // round-trips through UPDATE_FROM_PROCESSOR to clear the pending diff.
    const hasPendingDiff = scriptData?.pendingDiff != null;
    const handleAcceptDiff = React.useCallback(() => {
        if (editorView != null) {
            acceptPendingDiff(editorView);
        } else if (scriptData != null) {
            props.modifyNotebookScripts({ type: ACCEPT_PENDING_DIFF, value: scriptData.scriptKey });
        }
    }, [editorView, props.modifyNotebookScripts, scriptData]);
    const handleRejectDiff = React.useCallback(() => {
        if (editorView != null) {
            rejectPendingDiff(editorView);
        } else if (scriptData != null) {
            props.modifyNotebookScripts({ type: REJECT_PENDING_DIFF, value: scriptData.scriptKey });
        }
    }, [editorView, props.modifyNotebookScripts, scriptData]);

    const activeQueryId = scriptData?.latestQueryId ?? null;
    const activeQueryState = useQueryState(props.notebookScripts?.notebookId ?? null, activeQueryId);
    const cancelQuery = useCancelQuery();
    const cancelAgentRun = useCancelAgentRun();

    // Refresh: drop the stale cache entry for this result, then re-execute — a plain cacheable run
    // then misses the cache and re-populates it. Surfaced on the Data/Chart tab headers when the
    // current result was served from cache.
    const executeQuery = useQueryExecutor();
    const storageReader = useStorageReader();
    const handleRerun = React.useCallback(async (cacheKey: string | null) => {
        if (scriptData == null) {
            return;
        }
        // Best-effort delete of the stale cache entry first; the re-execution then misses and
        // re-populates the cache (the executor's write path overwrites it either way).
        if (cacheKey != null) {
            await storageReader.backend.deleteQueryResultCache(props.notebookScripts.notebookId, cacheKey).catch(() => {});
        }
        rerunEntry(props.notebookScripts, scriptData, executeQuery, props.modifyNotebookScripts);
    }, [props.notebookScripts, props.modifyNotebookScripts, scriptData, executeQuery, storageReader]);

    // The status bar above the tabs mirrors the feed's: while an agent run or query is in flight it's
    // a clickable strip (spinner + latest line) that reveals the trace on the Status tab. A staged
    // rewrite doesn't feed the bar — Accept/Reject stays on the editor overlay, tied to the diff
    // decorations — so the bar stays free to show the rewritten statement's re-execution status.
    const agentRunState = useAgentRunState(scriptData?.latestAgentRunId ?? null);
    const agentTraceId = agentRunState?.traceId ?? null;
    const queryTraceId = activeQueryState?.traceId ?? null;
    const entryStatus = deriveEntryStatus(agentRunState, activeQueryState);
    const cancelEntryOperation = React.useCallback(() => {
        if (entryStatus?.kind === EntryStatusKind.Agent) {
            cancelAgentRun(props.notebookScripts.notebookId);
        } else if (entryStatus?.kind === EntryStatusKind.Query && activeQueryId != null) {
            cancelQuery(props.notebookScripts.notebookId, activeQueryId);
        }
    }, [activeQueryId, cancelAgentRun, cancelQuery, entryStatus?.kind, props.notebookScripts.notebookId]);

    // Clicking the status bar reveals the matching trace on the server card's Status tab.
    const showLog = React.useCallback((traceId: number | null) => {
        selectTab(traceId != null && traceId === agentTraceId
            ? TabKey.AgentStatusPanel
            : TabKey.QueryStatusPanel);
    }, [agentTraceId]);

    const visualizeQuery = scriptData?.annotations.visualizeQuery ?? null;
    const hasVisualizeStmt = visualizeQuery != null;

    // Row count for the Data/Chart tab headers (shared with the feed footer so the count reads
    // identically). Details shows the full result — no feed row cap — so both headers use the total.
    const { totalRows } = useResultRowCount(activeQueryState);
    const rowCountDetail = formatRowCountDetail(totalRows);

    const hasOutput = activeQueryState != null || agentTraceId != null;
    const hasResult = activeQueryState?.status === QueryExecutionStatus.SUCCEEDED;
    const hasVisualization = hasResult && hasVisualizeStmt;
    const serverTabs = React.useMemo(() => {
        const tabs: TabKey[] = [TabKey.QueryStatusPanel, TabKey.AgentStatusPanel];
        if (hasResult) tabs.push(TabKey.QueryResultView);
        if (hasVisualization) tabs.push(TabKey.Visualization);
        return tabs;
    }, [hasResult, hasVisualization]);
    const enabledServerTabs = React.useMemo(() => serverTabs.filter(tab => {
        switch (tab) {
            case TabKey.QueryStatusPanel: return queryTraceId != null;
            case TabKey.AgentStatusPanel: return agentTraceId != null;
            case TabKey.QueryResultView: return hasResult;
            case TabKey.Visualization: return hasVisualization;
            default: return false;
        }
    }), [serverTabs, queryTraceId, agentTraceId, hasResult, hasVisualization]);

    const keyHandlers = React.useMemo<KeyEventHandler[]>(
        () => [
            {
                // Details is pinned to a script identity, while the global command executes the
                // NotebookScripts' mutable selection. Do not let Ctrl+E target a different hidden script.
                key: 'e',
                ctrlKey: true,
                capture: true,
                callback: (event) => {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                },
            },
            {
                key: 'j',
                ctrlKey: true,
                callback: () => {
                    if (!showServerDetails || enabledServerTabs.length === 0) return;
                    selectTab(current => {
                        const currentIndex = enabledServerTabs.indexOf(current);
                        return enabledServerTabs[(currentIndex + 1) % enabledServerTabs.length];
                    });
                },
            },
            {
                key: 'Escape',
                ctrlKey: false,
                capture: true,
                callback: (event) => {
                    if (isEditingName) {
                        cancelNameEdit();
                        event.stopImmediatePropagation();
                        return;
                    }
                    if (editorView) {
                        const processor = editorView.state.field(DashQLProcessorPlugin, false);
                        if (processor?.scriptCompletion?.status === DashQLCompletionStatus.AVAILABLE) {
                            editorView.dispatch({ effects: DashQLCompletionAbortEffect.of(null) });
                            event.stopImmediatePropagation();
                            return;
                        }
                    }
                    props.hideDetails();
                    event.stopImmediatePropagation();
                },
            },
        ],
        [props.hideDetails, showServerDetails, enabledServerTabs, isEditingName, cancelNameEdit, editorView],
    );
    useKeyEvents(keyHandlers);

    const prevStatus = React.useRef<[number | null, QueryExecutionStatus | null] | null>([
        activeQueryId,
        activeQueryState?.status ?? null,
    ]);
    React.useEffect(() => {
        const status = activeQueryState?.status ?? null;
        const previous = prevStatus.current;
        const changed = previous == null || previous[0] !== activeQueryId || previous[1] !== status;
        if (!changed) return;
        switch (status) {
            case null:
                break;
            case QueryExecutionStatus.REQUESTED:
            case QueryExecutionStatus.PREPARING:
            case QueryExecutionStatus.SENDING:
            case QueryExecutionStatus.QUEUED:
            case QueryExecutionStatus.RUNNING:
            case QueryExecutionStatus.RECEIVED_FIRST_BATCH:
            case QueryExecutionStatus.RECEIVED_ALL_BATCHES:
            case QueryExecutionStatus.PROCESSING_RESULTS:
                if (showServerDetails) selectTab(TabKey.QueryStatusPanel);
                break;
            case QueryExecutionStatus.FAILED:
                if (showServerDetails) selectTab(TabKey.QueryStatusPanel);
                break;
            case QueryExecutionStatus.SUCCEEDED:
                if (showServerDetails) {
                    const successTab = hasVisualizeStmt ? TabKey.Visualization : TabKey.QueryResultView;
                    selectTab(successTab);
                }
                break;
        }
        prevStatus.current = [activeQueryId, status];
    }, [activeQueryId, activeQueryState?.status, hasVisualizeStmt, showServerDetails]);

    React.useEffect(() => {
        if (editorView == null) {
            return;
        }
        const handle = requestAnimationFrame(() => {
            editorView.focus();
        });
        return () => cancelAnimationFrame(handle);
    }, [editorView]);

    React.useEffect(() => {
        if (showServerDetails && enabledServerTabs.length > 0 && !enabledServerTabs.includes(selectedTab)) {
            const fallback = queryTraceId != null
                ? TabKey.QueryStatusPanel
                : enabledServerTabs[0];
            selectTab(fallback);
        }
    }, [selectedTab, showServerDetails, enabledServerTabs, queryTraceId]);

    if (notebookEntry == null || scriptData == null) {
        return <div className={styles.entry_body_container} />;
    }

    const ScreenNormalIcon: Icon = SymbolIcon('screen_normal_16');
    const tableDebugMode = config?.settings?.tableDebugMode ?? false;
    const scriptDebugMode = config?.settings?.scriptDebugMode ?? false;
    // Script-card activation opens the editor (no initial tab). Any explicit output tab comes from
    // the server card and opens a response-only Details view.
    return (
        <div className={styles.entry_body_container}>
            <div
                key={notebookEntry?.scriptId}
                className={styles.entry_single}
            >
                {!showServerDetails && (
                <div className={styles.entry_message_single}>
                    <div className={styles.entry_script_card}>
                        <div className={styles.entry_card_action_bar}>
                        <div className={styles.entry_card_file_name}>
                            <ScriptName
                                folder={folderName}
                                file={scriptDisplay}
                                onFolderClick={props.hideDetails}
                                onFileClick={startEditingName}
                                editing={isEditingName ? {
                                    value: draftFileName,
                                    onChange: setDraftFileName,
                                    onCommit: saveNameEdit,
                                    onCancel: cancelNameEdit,
                                    inputRef: editInputRef,
                                } : undefined}
                                fileNameTrailing={
                                    <span className={styles.entry_card_file_name_actions}>
                                        <IconButton
                                            variant={ButtonVariant.Invisible}
                                            size={ButtonSize.Tiny}
                                            aria-label="Rename script"
                                            onClick={startEditingName}
                                            className={styles.entry_card_file_name_action_button}
                                        >
                                            <PencilIcon size={12} />
                                        </IconButton>
                                    </span>
                                }
                            />
                        </div>
                        {scriptDebugMode && scriptData != null && (
                            <div className={styles.entry_card_stats_bar}>
                                <ScriptStatisticsBar stats={scriptData.statistics} />
                            </div>
                        )}
                            <IconButton
                                className={styles.entry_card_collapse_button}
                                variant={ButtonVariant.Invisible}
                                onClick={props.hideDetails}
                                aria-label="Collapse"
                            >
                                <ScreenNormalIcon size={16} />
                            </IconButton>
                        </div>
                        <div className={styles.script_body}>
                            <div className={styles.editor_container}>
                                <ScriptEditor
                                    notebookId={props.notebookScripts.notebookId}
                                    scriptKey={notebookEntry.scriptId}
                                    setView={setEditorView}
                                />
                                <div className={styles.format_toggle}>
                                    {hasPendingDiff ? (
                                        <ButtonGroup>
                                            <IconButton
                                                variant={ButtonVariant.Default}
                                                onClick={handleAcceptDiff}
                                                aria-label="Accept rewrite"
                                            >
                                                <CheckIcon />
                                            </IconButton>
                                            <IconButton
                                                variant={ButtonVariant.Default}
                                                onClick={handleRejectDiff}
                                                aria-label="Reject rewrite"
                                            >
                                                <FormatXIcon />
                                            </IconButton>
                                        </ButtonGroup>
                                    ) : !formatPending ? (
                                        <IconButton
                                            variant={ButtonVariant.Invisible}
                                            onClick={handleFormat}
                                            aria-label="Pretty format"
                                        >
                                            <PencilAIIcon />
                                        </IconButton>
                                    ) : (
                                        <ButtonGroup>
                                            <IconButton
                                                variant={ButtonVariant.Default}
                                                onClick={handleFormatAccept}
                                                aria-label="Accept format"
                                            >
                                                <CheckIcon />
                                            </IconButton>
                                            <IconButton
                                                variant={ButtonVariant.Default}
                                                onClick={handleFormatCancel}
                                                aria-label="Cancel format"
                                            >
                                                <FormatXIcon />
                                            </IconButton>
                                        </ButtonGroup>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                )}
                {showServerDetails && (
                <div className={styles.entry_message_single}>
                    <div className={styles.entry_server_card}>
                        <EntryStatusBar
                            status={entryStatus}
                            onClick={entryStatus.traceId != null ? () => showLog(entryStatus.traceId) : undefined}
                            onCancel={entryStatus.indicator === IndicatorStatus.Running ? cancelEntryOperation : undefined}
                            cancelLabel={entryStatus.kind === EntryStatusKind.Agent ? 'Cancel agent run' : 'Cancel query'}
                            actions={
                                <>
                                    <QueryResultCacheLabel query={activeQueryState} />
                                    <QueryResultRerunButton query={activeQueryState} onRerun={handleRerun} />
                                    <IconButton
                                        variant={ButtonVariant.Invisible}
                                        onClick={props.hideDetails}
                                        aria-label="Collapse"
                                    >
                                        <ScreenNormalIcon size={16} />
                                    </IconButton>
                                </>
                            }
                        />
                        {hasOutput ? (
                            <VerticalTabs
                            className={styles.entry_card_tabs}
                            variant={VerticalTabVariant.Stacked}
                            selectedTab={selectedTab}
                            selectTab={selectTab}
                            tabProps={{
                            [TabKey.QueryStatusPanel]: {
                                tabId: TabKey.QueryStatusPanel,
                                icon: `${icons}#log_24`,
                                labelShort: 'Log',
                                ariaLabel: 'Execution log',
                                description: 'Execution log',
                                disabled: queryTraceId == null,
                            },
                            [TabKey.AgentStatusPanel]: {
                                tabId: TabKey.AgentStatusPanel,
                                icon: `${icons}#sparkles_fill_24`,
                                labelShort: 'Agent',
                                ariaLabel: 'Agent log',
                                description: 'Agent log',
                                disabled: agentTraceId == null,
                            },
                            [TabKey.QueryResultView]: {
                                tabId: TabKey.QueryResultView,
                                icon: `${icons}#table_24`,
                                labelShort: 'Data',
                                ariaLabel: 'Query results',
                                description: 'Query results',
                                disabled: !hasResult,
                            },
                            [TabKey.Visualization]: {
                                tabId: TabKey.Visualization,
                                icon: `${icons}#graph_24`,
                                labelShort: 'Chart',
                                ariaLabel: 'Visualization',
                                description: 'Visualization',
                                disabled: !hasVisualization,
                            },
                        }}
                            tabKeys={serverTabs}
                        tabRenderers={{
                            [TabKey.QueryStatusPanel]: _props => (
                                <div className={styles.status_tab}>
                                    <TraceLogPanel
                                        traceId={queryTraceId}
                                        title="Execution Logs"
                                    />
                                </div>
                            ),
                            [TabKey.AgentStatusPanel]: _props => (
                                <div className={styles.status_tab}>
                                    <TraceLogPanel
                                        traceId={agentTraceId}
                                        title="Agent Logs"
                                    />
                                </div>
                            ),
                            [TabKey.QueryResultView]: _props => (
                                <div className={styles.result_tab}>
                                    {/* Non-clickable count header, matching the feed footer's Data tab
                                        (there it opens Details; here it's a plain label + count). The
                                        cache controls (age + delete) only render when the result has
                                        a cache entry. */}
                                    <TabHeader
                                        title="Query Results"
                                        detail={rowCountDetail}
                                    />
                                    <div className={styles.result_tab_body}>
                                        <QueryResultView query={activeQueryState} debugMode={tableDebugMode} />
                                    </div>
                                </div>
                            ),
                            [TabKey.Visualization]: _props => (
                                <div className={styles.visualization_container}>
                                    <TabHeader
                                        title="Visualization"
                                        detail={rowCountDetail}
                                    />
                                    <ColumnAggregationBar query={activeQueryState} debugMode={tableDebugMode} />
                                    <div className={styles.visualization_body}>
                                        <VisualizationDispatch query={activeQueryState} visualizeQuery={visualizeQuery} />
                                    </div>
                                </div>
                            ),
                        }}
                            />
                        ) : null}
                    </div>
                </div>
                )}
            </div>
        </div>
    );
};
