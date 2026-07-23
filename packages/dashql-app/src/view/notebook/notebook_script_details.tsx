import * as React from 'react';
import * as styles from './notebook_script_details.module.css';
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
import { useQueryState } from '../../connection/query_executor.js';
import { useAgentRunState } from '../../agent/agent_run_provider.js';
import { EntryStatusBar } from './entry_status_bar.js';
import { deriveEntryStatus } from './entry_status_model.js';
import { TraceLogPanel } from './trace_log_panel.js';
import { TabHeader, useResultRowCount, formatRowCountDetail } from './tab_header.js';
import { QueryResultCacheControls } from './query_result_cache_controls.js';
import { getSelectedEntry, getSelectedPage, NotebookState, UPDATE_NOTEBOOK_ENTRY } from '../../notebook/notebook_state.js';
import { normalizePageName, scriptDisplayName } from '../../notebook/notebook_types.js';
import type { ModifyNotebook } from '../../notebook/notebook_state_registry.js';
import { useAppConfig } from '../../app_config.js';
import { ScriptEditor } from './script_editor.js';
import { acceptPendingDiff, rejectPendingDiff } from '../editor/dashql_diff_hint.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';
import { VerticalTabs, VerticalTabVariant } from '../foundations/vertical_tabs.js';
import { NotebookScriptName } from './notebook_script_name.js';
import { ScriptStatisticsBar } from './script_statistics_bar.js';
import { VisualizationDispatch } from '../visualization/visualization_dispatch.js';
import { ColumnAggregationBar } from '../visualization/column_aggregation_bar.js';
import { createReadonlyCodeMirrorExtensions } from '../editor/codemirror.js';
import { DashQLUpdateEffect, DashQLScriptBuffers, analyzeScript } from '../editor/dashql_processor.js';

const AUTO_VSPLIT_MIN_HEIGHT = 720;

export enum TabKey {
    Editor = 0,
    QueryStatusPanel = 1,
    QueryResultView = 2,
    Visualization = 3,
}

interface TabState {
    enabledTabs: number;
}

export interface NotebookScriptDetailsProps {
    notebook: NotebookState;
    modifyNotebook: ModifyNotebook;
    connection: ConnectionState | null;
    hideDetails: () => void;
    initialTab?: TabKey;
}

export const NotebookScriptDetails: React.FC<NotebookScriptDetailsProps> = (props) => {
    const config = useAppConfig();
    const [selectedTab, selectTab] = React.useState<TabKey>(props.initialTab ?? TabKey.Editor);
    const [splitModeEnabled, setSplitModeEnabled] = React.useState<boolean>(false);
    const [splitTab, setSplitTab] = React.useState<TabKey | null>(null);
    const [editorView, setEditorView] = React.useState<EditorView | null>(null);
    const [hasAutoEnabledSplit, setHasAutoEnabledSplit] = React.useState<boolean>(false);
    const [formatPending, setFormatPending] = React.useState(false);
    const savedEditorStateRef = React.useRef<EditorState | null>(null);
    const formattedTextRef = React.useRef<string | null>(null);
    const formatPreviewBuffersRef = React.useRef<DashQLScriptBuffers | null>(null);
    const formatPreviewScriptRef = React.useRef<dashql.DashQLScript | null>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);

    const notebookEntry = getSelectedEntry(props.notebook);
    const scriptData = notebookEntry != null ? props.notebook.scripts[notebookEntry.scriptId] : null;

    // Get folder name and script file name (display-only: strip the on-disk ordering prefix). The
    // raw scriptFileName stays the rename identity; the label and draft use the clean display name
    // (no prefix, no ".sql").
    const selectedPage = getSelectedPage(props.notebook);
    const folderName = normalizePageName(selectedPage?.folderName ?? '') || 'Untitled';
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
            props.modifyNotebook({ type: UPDATE_NOTEBOOK_ENTRY, value: { fileName: scriptFileName, newFileName: trimmed } });
        }
        setIsEditingName(false);
    }, [draftFileName, scriptDisplay, scriptFileName, props.modifyNotebook]);

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
        if (editorView != null) acceptPendingDiff(editorView);
    }, [editorView]);
    const handleRejectDiff = React.useCallback(() => {
        if (editorView != null) rejectPendingDiff(editorView);
    }, [editorView]);

    const activeQueryId = scriptData?.latestQueryId ?? null;
    const activeQueryState = useQueryState(props.notebook?.sessionId ?? null, activeQueryId);

    // The status bar above the tabs mirrors the feed's: while an agent run or query is in flight it's
    // a clickable strip (spinner + latest line) that reveals the trace on the Status tab. A staged
    // rewrite doesn't feed the bar — Accept/Reject stays on the editor overlay, tied to the diff
    // decorations — so the bar stays free to show the rewritten statement's re-execution status. It
    // auto-hides on idle and on query success.
    const agentRunState = useAgentRunState(scriptData?.latestAgentRunId ?? null);
    const agentTraceId = agentRunState?.traceId ?? null;
    const queryTraceId = activeQueryState?.traceId ?? null;
    const entryStatus = deriveEntryStatus(agentRunState, activeQueryState);

    // Clicking the status bar reveals the matching trace on the Status tab (bump a nonce the
    // TraceLogPanel keys off, riding along the clicked source's trace id — same contract as the feed
    // footer). In split mode the log opens in the right pane (matching the query-status auto-switch);
    // otherwise it takes the single pane. The panel selects the right source off the nonce.
    const [logRequest, setLogRequest] = React.useState<{ nonce: number; traceId: number | null }>({ nonce: 0, traceId: null });
    const showLog = React.useCallback((traceId: number | null) => {
        setLogRequest(prev => ({ nonce: prev.nonce + 1, traceId }));
        if (splitModeEnabled) {
            setSplitTab(TabKey.QueryStatusPanel);
        } else {
            selectTab(TabKey.QueryStatusPanel);
        }
    }, [splitModeEnabled]);

    const visualizeQuery = scriptData?.annotations.visualizeQuery ?? null;
    const hasVisualizeStmt = visualizeQuery != null;

    // Row count for the Data/Chart tab headers (shared with the feed footer so the count reads
    // identically). Details shows the full result — no feed row cap — so both headers use the total.
    const { totalRows } = useResultRowCount(activeQueryState);
    const rowCountDetail = formatRowCountDetail(totalRows);

    const tabState = React.useRef<TabState>({
        enabledTabs: 1,
    });
    let enabledTabs = 1;
    enabledTabs += +(activeQueryState != null);
    enabledTabs += +(activeQueryState?.status == QueryExecutionStatus.SUCCEEDED);
    enabledTabs += +(hasVisualizeStmt && activeQueryState?.status == QueryExecutionStatus.SUCCEEDED);
    tabState.current.enabledTabs = enabledTabs;

    const toggleSplitMode = React.useCallback(() => {
        setSplitModeEnabled(prev => {
            if (!prev) {
                // Enabling split mode: set primary tab as selected and choose split tab
                selectTab(TabKey.Editor);
                const defaultSplitTab = tabState.current.enabledTabs >= 4
                    ? TabKey.Visualization
                    : tabState.current.enabledTabs >= 3
                        ? TabKey.QueryResultView
                        : (tabState.current.enabledTabs >= 2 ? TabKey.QueryStatusPanel : null);
                setSplitTab(defaultSplitTab);
            } else {
                // Disabling split mode
                setSplitTab(null);
            }
            return !prev;
        });
    }, []);

    const handleSelectTab = React.useCallback((tab: TabKey) => {
        if (!splitModeEnabled) {
            selectTab(tab);
        }
        // In split mode, tab selection is handled by onSelectSplitTab
    }, [splitModeEnabled]);

    const handleSelectSplitTab = React.useCallback((tab: TabKey) => {
        if (tab === TabKey.Editor) return; // Can't select Editor for split
        setSplitTab(tab);
    }, []);

    const keyHandlers = React.useMemo<KeyEventHandler[]>(
        () => [
            {
                key: 'j',
                ctrlKey: true,
                callback: () => {
                    if (splitModeEnabled) {
                        // In split mode, cycle through available split tabs
                        setSplitTab(currentSplitTab => {
                            const availableTabs = [TabKey.QueryStatusPanel, TabKey.QueryResultView, TabKey.Visualization].filter((_, idx) =>
                                tabState.current.enabledTabs >= idx + 2
                            );
                            if (availableTabs.length === 0) return currentSplitTab;

                            const currentIndex = currentSplitTab ? availableTabs.indexOf(currentSplitTab) : -1;
                            const nextIndex = (currentIndex + 1) % availableTabs.length;
                            return availableTabs[nextIndex];
                        });
                    } else {
                        // Normal mode: cycle through all tabs
                        selectTab(key => {
                            const tabs = [TabKey.Editor, TabKey.QueryStatusPanel, TabKey.QueryResultView, TabKey.Visualization];
                            return tabs[((key as number) + 1) % tabState.current.enabledTabs];
                        });
                    }
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
        [props.hideDetails, tabState, selectTab, splitModeEnabled, isEditingName, cancelNameEdit, editorView],
    );
    useKeyEvents(keyHandlers);

    const prevStatus = React.useRef<[number | null, QueryExecutionStatus | null] | null>(null);
    React.useEffect(() => {
        const status = activeQueryState?.status ?? null;
        switch (status) {
            case null:
                if (!splitModeEnabled) {
                    selectTab(TabKey.Editor);
                }
                break;
            case QueryExecutionStatus.REQUESTED:
            case QueryExecutionStatus.PREPARING:
            case QueryExecutionStatus.SENDING:
            case QueryExecutionStatus.QUEUED:
            case QueryExecutionStatus.RUNNING:
            case QueryExecutionStatus.RECEIVED_FIRST_BATCH:
            case QueryExecutionStatus.RECEIVED_ALL_BATCHES:
            case QueryExecutionStatus.PROCESSING_RESULTS:
                if (prevStatus.current == null || prevStatus.current[0] != activeQueryId || prevStatus.current[1] != status) {
                    if (splitModeEnabled) {
                        selectTab(TabKey.Editor);
                        setSplitTab(TabKey.QueryStatusPanel);
                    } else {
                        selectTab(TabKey.QueryStatusPanel);
                    }
                }
                break;
            case QueryExecutionStatus.FAILED:
                if (prevStatus.current != null && prevStatus.current[1] != QueryExecutionStatus.FAILED) {
                    if (splitModeEnabled) {
                        selectTab(TabKey.Editor);
                        setSplitTab(TabKey.QueryStatusPanel);
                    } else {
                        selectTab(TabKey.QueryStatusPanel);
                    }
                }
                break;
            case QueryExecutionStatus.SUCCEEDED:
                if (prevStatus.current != null && prevStatus.current[1] != QueryExecutionStatus.SUCCEEDED) {
                    const successTab = hasVisualizeStmt ? TabKey.Visualization : TabKey.QueryResultView;
                    if (splitModeEnabled) {
                        selectTab(TabKey.Editor);
                        setSplitTab(successTab);
                    } else {
                        selectTab(successTab);
                    }
                }
                break;
        }
        prevStatus.current = [activeQueryId, status];
    }, [activeQueryId, activeQueryState?.status, splitModeEnabled, hasVisualizeStmt]);

    // Auto-enable split mode the first time a second tab becomes active (if height > AUTO_VSPLIT_MIN_HEIGHT)
    React.useEffect(() => {
        if (!hasAutoEnabledSplit && !splitModeEnabled && tabState.current.enabledTabs >= 2) {
            const container = containerRef.current;
            if (container) {
                const height = container.getBoundingClientRect().height;
                if (height > AUTO_VSPLIT_MIN_HEIGHT) {
                    selectTab(TabKey.Editor); // Ensure primary tab is selected
                    setSplitModeEnabled(true);
                    const defaultSplitTab = tabState.current.enabledTabs >= 3
                        ? TabKey.QueryResultView
                        : TabKey.QueryStatusPanel;
                    setSplitTab(defaultSplitTab);
                    setHasAutoEnabledSplit(true);
                }
            }
        }
    }, [hasAutoEnabledSplit, splitModeEnabled, tabState.current.enabledTabs]);

    // Handle edge case: if split tab becomes disabled, switch to another tab or disable split mode
    React.useEffect(() => {
        if (splitModeEnabled && splitTab !== null && splitTab !== TabKey.Editor) {
            // Check if the current split tab is disabled
            const isSplitTabDisabled = (splitTab === TabKey.QueryStatusPanel && tabState.current.enabledTabs < 2) ||
                (splitTab === TabKey.QueryResultView && tabState.current.enabledTabs < 3) ||
                (splitTab === TabKey.Visualization && tabState.current.enabledTabs < 4);

            if (isSplitTabDisabled) {
                // Try to find another enabled tab, preferring richer views
                if (tabState.current.enabledTabs >= 4 && splitTab !== TabKey.Visualization) {
                    setSplitTab(TabKey.Visualization);
                } else if (tabState.current.enabledTabs >= 3 && splitTab !== TabKey.QueryResultView) {
                    setSplitTab(TabKey.QueryResultView);
                } else if (tabState.current.enabledTabs >= 2 && splitTab !== TabKey.QueryStatusPanel) {
                    setSplitTab(TabKey.QueryStatusPanel);
                } else {
                    // No other tabs available, disable split mode
                    setSplitModeEnabled(false);
                    setSplitTab(null);
                }
            }
        }
    }, [splitModeEnabled, splitTab, activeQueryState?.status]);

    React.useEffect(() => {
        if (selectedTab !== TabKey.Editor || editorView == null) {
            return;
        }
        const handle = requestAnimationFrame(() => {
            editorView.focus();
        });
        return () => cancelAnimationFrame(handle);
    }, [editorView, selectedTab]);

    if (notebookEntry == null || scriptData == null) {
        return <div className={styles.entry_body_container} />;
    }

    const ScreenNormalIcon: Icon = SymbolIcon('screen_normal_16');
    const tableDebugMode = config?.settings?.tableDebugMode ?? false;
    const scriptDebugMode = config?.settings?.scriptDebugMode ?? false;
    return (
        <div className={styles.entry_body_container}>
            <div
                ref={containerRef}
                key={notebookEntry?.scriptId}
                className={styles.entry_body_card}
            >
                <div className={styles.entry_card_container}>
                    <div className={styles.entry_card_action_bar}>
                        <div className={styles.entry_card_file_name}>
                            <NotebookScriptName
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
                            aria-labelledby="collapse-entry"
                        >
                            <ScreenNormalIcon size={16} />
                        </IconButton>
                    </div>
                    {entryStatus != null && (
                        // Same status bar as the feed. It only shows execution progress; Accept/Reject
                        // for a staged rewrite lives on the editor overlay (spatially tied to the diff
                        // decorations), so the bar is always the clickable trace strip here.
                        <EntryStatusBar
                            status={entryStatus}
                            onClick={() => showLog(entryStatus.traceId)}
                        />
                    )}
                    <VerticalTabs
                        className={styles.entry_card_tabs}
                        variant={VerticalTabVariant.Stacked}
                        selectedTab={selectedTab}
                        selectTab={handleSelectTab}
                        splitModeEnabled={splitModeEnabled}
                        splitTab={splitTab}
                        primaryTabKey={TabKey.Editor}
                        onToggleSplitMode={toggleSplitMode}
                        onSelectSplitTab={handleSelectSplitTab}
                        tabProps={{
                            [TabKey.Editor]: {
                                tabId: TabKey.Editor,
                                icon: `${icons}#file`,
                                labelShort: 'Editor',
                                ariaLabel: 'Script editor',
                                description: 'Edit script',
                                disabled: false
                            },
                            [TabKey.QueryStatusPanel]: {
                                tabId: TabKey.QueryStatusPanel,
                                icon: `${icons}#log_24`,
                                labelShort: 'Status',
                                ariaLabel: 'Query status',
                                description: 'Query status',
                                disabled: tabState.current.enabledTabs < 2,
                            },
                            [TabKey.QueryResultView]: {
                                tabId: TabKey.QueryResultView,
                                icon: `${icons}#table_24`,
                                labelShort: 'Data',
                                ariaLabel: 'Query results',
                                description: 'Query results',
                                disabled: tabState.current.enabledTabs < 3,
                            },
                            [TabKey.Visualization]: {
                                tabId: TabKey.Visualization,
                                icon: `${icons}#graph_24`,
                                labelShort: 'Chart',
                                ariaLabel: 'Visualization',
                                description: 'Visualization',
                                disabled: tabState.current.enabledTabs < 4,
                            },
                        }}
                        tabKeys={[
                            TabKey.Editor,
                            TabKey.QueryStatusPanel,
                            TabKey.QueryResultView,
                            TabKey.Visualization,
                        ]}
                        tabRenderers={{
                            [TabKey.Editor]: _props => (
                                <div className={styles.editor_container}>
                                    <ScriptEditor
                                        sessionId={props.notebook.sessionId}
                                        scriptKey={notebookEntry.scriptId}
                                        setView={setEditorView}
                                    />
                                    <div className={styles.format_toggle}>
                                        {/* A staged agent rewrite takes priority over the format
                                            affordance: show its Accept/Reject controls (the editor
                                            renders the diff overlay + honors ⏎/⎋). */}
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
                            ),
                            [TabKey.QueryStatusPanel]: _props => (
                                <div className={styles.status_tab}>
                                    <TraceLogPanel
                                        queryTraceId={queryTraceId}
                                        agentTraceId={agentTraceId}
                                        logRequest={logRequest}
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
                                        actions={
                                            <QueryResultCacheControls
                                                sessionId={props.notebook.sessionId}
                                                query={activeQueryState}
                                            />
                                        }
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
                                        actions={
                                            <QueryResultCacheControls
                                                sessionId={props.notebook.sessionId}
                                                query={activeQueryState}
                                            />
                                        }
                                    />
                                    <ColumnAggregationBar query={activeQueryState} debugMode={tableDebugMode} />
                                    <div className={styles.visualization_body}>
                                        <VisualizationDispatch query={activeQueryState} visualizeQuery={visualizeQuery} />
                                    </div>
                                </div>
                            ),
                        }}
                    />
                </div>
            </div>
        </div>
    );
};
