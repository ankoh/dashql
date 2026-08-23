import * as React from 'react';
import * as styles from './notebook_feed.module.css';

import type { EditorView } from '@codemirror/view';

import { useAppConfig } from '../../../config/app_config.js';

import { List } from 'react-window';

import { ConnectionHealth, ConnectionState } from '../../connections/connection_state.js';
import { compileQuery, getSelectedScriptRef, getSelectedScriptFolder, getSelectedScriptRefs, getSortedScriptFileNames, getUncommittedScriptData, NotebookScripts, SELECT_SCRIPT, PROMOTE_UNCOMMITTED_SCRIPT, DELETE_SCRIPT, RENAME_SCRIPT, REORDER_SCRIPTS, ACCEPT_PENDING_DIFF, REJECT_PENDING_DIFF } from '../../scripts/notebook_scripts.js';
import { useAIClient } from '../../agent/ai/ai_client_provider.js';
import { COMPOSE_INPUT_MODE_AI, useComposeInputMode } from '../../scripts/notebook_commands.js';
import { useLatestAgentRunState, useStartAgentRun, useCancelAgentRun } from '../../agent/agent_run_provider.js';
import { AgentRunPhase, agentRunIsActive } from '../../agent/agent_run_state.js';
import { OutputColumn } from '../../scripts/script_agent_context.js';
import { createNotebookScriptsAgentHost } from '../../scripts/script_agent_host.js';
import { QueryType } from '../../connections/query_execution_state.js';
import { useQueryExecutor } from '../../connections/query_executor.js';
import { ensureNotebookScriptAnalyzed, type ModifyNotebookScripts } from '../../scripts/notebook_scripts_registry.js';
import { normalizeScriptFolderName, projectionForVisualizeQuery, scriptDisplayName } from '../../scripts/script_types.js';
import { type KeyEventHandler, useKeyEvents } from '../../../../utils/key_events.js';
import { TabKey as DetailsTabKey } from '../script_details.js';
import { registerNotebookScriptQuery, runNotebookScript } from '../rerun_query.js';
import { useStorageReader } from '../../persistence/storage_provider.js';
import { useLogger } from '../../../../platform/logger/logger_provider.js';
import { NotebookFeedComposer } from './notebook_feed_composer.js';
import { useNotebookFeedLayout, type FeedScrollTarget } from './notebook_feed_layout.js';
import { ScriptFeedRow, type ScriptFeedRowProps } from './notebook_feed_row.js';

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
const OVERSCAN_ROW_COUNT = 16;
const FEED_BOTTOM_PADDING = 8;

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
        const [queryId, execution] = executeQuery(props.conn!.connectionId, {
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
            const [queryId, execution] = executeQuery(props.conn!.connectionId, {
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
        runNotebookScript(props.conn!.connectionId, notebookScripts, scriptData, executeQuery, props.modifyNotebookScripts, logger);
    }, [props.notebookScripts, props.modifyNotebookScripts, isDisconnected, executeQuery, storageReader, logger]);

    const handleExecuteEntry = React.useCallback((fileName: string) => {
        if (isDisconnected) return;
        const notebookScripts = props.notebookScripts;
        const entry = notebookScripts.scriptFolders[notebookScripts.scriptFocus.folderName]?.scripts[fileName];
        const scriptData = entry != null ? notebookScripts.scripts[entry.scriptId] : undefined;
        if (scriptData == null) return;
        runNotebookScript(props.conn!.connectionId, notebookScripts, scriptData, executeQuery, props.modifyNotebookScripts, logger);
    }, [executeQuery, isDisconnected, props.modifyNotebookScripts, props.notebookScripts, logger]);

    // Send the compose editor's text to the agent run as a natural-language prompt. Context is
    // explicit: no bean means a blank-draft run rather than an implicit hover-selected target.
    const handleSendAI = React.useCallback(() => {
        if (!aiAvailable) return;
        const prompt = composeEditorView?.state.doc.toString().trim() ?? '';
        if (prompt.length === 0) return;
        const contextScriptKey = aiContextScript?.scriptKey ?? null;
        const start = (notebookScripts: NotebookScripts) => {
            // Build the notebook adapter the run acts on. It closes over the focused script and the
            // NotebookScripts dispatch; for visualize runs it also exposes each script's last-execution output
            // schema (from the connection state) so the agent context can describe the chart's columns.
            const host = createNotebookScriptsAgentHost({
                notebookScripts,
                contextScriptKey,
                modifyNotebookScripts: props.modifyNotebookScripts,
                resolveOutputColumns: (scriptKey) => outputColumnsForScript(notebookScripts, props.conn, scriptKey),
                logger,
            });
            startAgentRun({
                notebookId: notebookScripts.notebookId,
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
        };

        if (contextScriptKey != null && aiContextScript?.scriptAnalysis.outdated) {
            void ensureNotebookScriptAnalyzed(
                props.notebookScripts,
                contextScriptKey,
                props.modifyNotebookScripts,
            ).then((context) => {
                if (context == null) return;
                start({
                    ...props.notebookScripts,
                    scripts: { ...props.notebookScripts.scripts, [contextScriptKey]: context },
                });
            });
        } else {
            start(props.notebookScripts);
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

    const feedLayout = useNotebookFeedLayout(entries, props.scrollTarget, pendingScrollToBottomRef);

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
        previewHints: feedLayout.previewHints,
        onHeightMeasured: feedLayout.onHeightMeasured,
        onFormattedText: feedLayout.onFormattedText,
        topPadding: feedLayout.topPadding,
        heightsVersion: feedLayout.heightsVersion,
    }), [entries, props.notebookScripts.scripts, props.notebookScripts.connectorInfo.icons?.outlines, props.notebookScripts.scriptFocus.fileName, folderName, scriptDebugMode, aiAvailable, canDelete, handleFocus, handleExpand, handleDelete, handleRename, handleMoveUp, handleMoveDown, handleExecuteEntry, handleUseAIContext, handleShowStatus, handleShowAgentStatus, handleShowTable, handleShowVisualization, handleRerunEntry, handleAcceptDiff, handleRejectDiff, feedLayout.previewHints, feedLayout.onHeightMeasured, feedLayout.onFormattedText, feedLayout.topPadding, feedLayout.heightsVersion]);

    return (
        <div
            className={styles.feed_body_container}
            data-tauri-drag-region="deep"
            style={{ '--feed-scrollbar-inset': `${feedLayout.listScrollbarInset}px` } as React.CSSProperties}
        >
            <div className={styles.feed_list_container} ref={feedLayout.listContainerRef}>
                <List
                    key={props.notebookScripts.scriptFocus.folderName}
                    listRef={feedLayout.listRef}
                    style={{
                        width: feedLayout.listWidth,
                        height: feedLayout.listHeight,
                        overflowX: 'hidden',
                        scrollbarGutter: 'stable',
                        '--feed-scrollbar-inset': `${feedLayout.listScrollbarInset}px`,
                    } as React.CSSProperties}
                    rowCount={entries.length + 1}
                    overscanCount={OVERSCAN_ROW_COUNT}
                    rowHeight={(rowIndex) => {
                        if (rowIndex < entries.length) {
                            const scriptId = entries[rowIndex].scriptId;
                            const contentHeight = feedLayout.previewHints.get(scriptId)?.height ?? ESTIMATED_ROW_HEIGHT;
                            return contentHeight + (rowIndex === 0 ? feedLayout.topPadding : 0);
                        }
                        return feedLayout.fillerRowHeight + FEED_BOTTOM_PADDING;
                    }}
                    rowComponent={ScriptFeedRow}
                    rowProps={rowProps}
                />
            </div>
            <div className={styles.compose_section} ref={feedLayout.composeSectionRef}>
                <NotebookFeedComposer
                    notebookId={notebookId}
                    scriptKey={getUncommittedScriptData(props.notebookScripts)?.scriptKey ?? 0}
                    inputMode={inputMode}
                    setInputMode={setInputMode}
                    aiAvailable={aiAvailable}
                    aiContextName={aiContextName}
                    aiPromptTextRef={aiPromptTextRef}
                    agentActive={agentActive}
                    disconnected={isDisconnected}
                    onClearAIContext={() => setAIContextScriptKey(null)}
                    onCancelAgentRun={() => cancelAgentRun(notebookId)}
                    onSave={() => handleSend(false)}
                    onSend={handleComposeSend}
                    onEditorView={handleComposeView}
                />
            </div>
        </div>
    );
};
