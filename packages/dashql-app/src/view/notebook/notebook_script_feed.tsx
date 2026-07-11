import * as React from 'react';
import * as styles from './notebook_script_feed.module.css';

import type { EditorView } from '@codemirror/view';
import type { Icon } from '@primer/octicons-react';
import { CodeIcon, PaperAirplaneIcon, SparklesFillIcon, SquareFillIcon } from '@primer/octicons-react';

import { useAppConfig } from '../../app_config.js';
import { ScriptStatisticsBar } from './script_statistics_bar.js';

import { List, useListRef } from 'react-window';
import type { RowComponentProps } from 'react-window';

import { ButtonSize, ButtonVariant, IconButton } from '../foundations/button.js';
import { ConnectionHealth, ConnectionState } from '../../connection/connection_state.js';
import { getExecutableQueryText, getSelectedEntry, getSelectedPage, getSelectedPageEntries, getSortedFileNames, getUncommittedScriptData, REGISTER_QUERY, type ScriptData, NotebookState, SELECT_ENTRY, PROMOTE_UNCOMMITTED_SCRIPT, DELETE_NOTEBOOK_ENTRY, UPDATE_NOTEBOOK_ENTRY, REORDER_NOTEBOOK_SCRIPTS } from '../../notebook/notebook_state.js';
import { useAIClient } from '../../platform/ai_client_provider.js';
import { useComposeInputMode } from '../../notebook/notebook_commands.js';
import { useLatestAgentRunState, useAgentRunState, useStartAgentRun, useCancelAgentRun } from '../../notebook/agent/agent_run_provider.js';
import { AgentRunPhase, agentRunIsActive } from '../../notebook/agent/agent_run_state.js';
import { QueryType } from '../../connection/query_execution_state.js';
import { useQueryExecutor, useQueryState } from '../../connection/query_executor.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';
import { ScriptEditor } from './script_editor.js';
import { PromptEditor } from './prompt_editor.js';
import { ScriptPreview } from './notebook_script_preview.js';
import { observeSize } from '../foundations/size_observer.js';
import type { ModifyNotebook } from '../../notebook/notebook_state_registry.js';
import { normalizePageName, scriptDisplayName } from '../../notebook/notebook_types.js';
import { type KeyEventHandler, useKeyEvents } from '../../utils/key_events.js';
import { SegmentedControl, SegmentedControlSize } from '../foundations/segmented_control.js';
import { NotebookScriptName } from './notebook_script_name.js';
import { IndicatorStatus, StatusIndicator } from '../foundations/status_indicator.js';
import { FeedEntryFooter } from './feed_entry_footer.js';
import { TabKey as DetailsTabKey } from './notebook_script_details.js';

interface FeedScrollTarget {
    fileName: string;
    version: number;
}

export interface NotebookScriptListProps {
    notebook: NotebookState;
    modifyNotebook: ModifyNotebook;
    showDetails: (initialTab?: DetailsTabKey) => void;
    scrollTarget?: FeedScrollTarget | null;
    conn: ConnectionState | null;
    openConnectionOverlay: () => void;
}

const ESTIMATED_ROW_HEIGHT = 120;
const FEED_EDGE_PADDING = 8;
const FEED_BOTTOM_FADE_HEIGHT = 24;

interface CollapsedScriptCardProps {
    sessionId: string;
    isFocused: boolean;
    scriptData: ScriptData | undefined;
    folderName: string;
    scriptFileName: string;
    scriptDebugMode: boolean;
    canDelete: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onFocus: (fileName: string) => void;
    onExpand: (fileName: string) => void;
    onDelete: (fileName: string) => void;
    onRename: (oldFileName: string, newFileName: string) => void;
    onMoveUp: (fileName: string) => void;
    onMoveDown: (fileName: string) => void;
    onShowTable: (fileName: string) => void;
    onShowVisualization: (fileName: string) => void;
}

const ScriptCard: React.FC<CollapsedScriptCardProps> = ({ sessionId, isFocused, scriptData, folderName, scriptFileName, scriptDebugMode, canDelete, canMoveUp, canMoveDown, onFocus, onExpand, onDelete, onRename, onMoveUp, onMoveDown, onShowTable, onShowVisualization }) => {
    const TrashIcon: Icon = SymbolIcon('trash_16');
    const MoveUpIcon: Icon = SymbolIcon('chevron_up_16');
    const MoveDownIcon: Icon = SymbolIcon('chevron_down_16');
    // Both eye states are rendered at once and toggled via CSS visibility. SymbolIcon caches a
    // distinct component type per symbol, so swapping the bound icon on focus change would
    // unmount/remount the <svg><use> and force the external symbol reference to re-resolve —
    // which shows up as a flicker when navigating quickly with Ctrl+H/J/K/L.
    const EyeOpenIcon: Icon = SymbolIcon('eye_16');
    const EyeClosedIcon: Icon = SymbolIcon('eye_closed_16');
    const PencilIcon: Icon = SymbolIcon('pencil_16');
    const queryState = useQueryState(sessionId, scriptData?.latestQueryId ?? null);
    // Resolve the agent run by its id (handle) just like the query above — the run carries its
    // own trace id, so the footer no longer needs a denormalized trace id on ScriptData.
    const agentRunState = useAgentRunState(scriptData?.latestAgentRunId ?? null);
    const agentTraceId = agentRunState?.traceId ?? null;
    // A staged agent rewrite waiting to be accepted/rejected. While set, the card mounts the full
    // editable editor (below) instead of the read-only preview so the in-place diff overlay and its
    // Accept/Reject panel show directly on the entry card.
    const hasPendingDiff = scriptData?.pendingDiff != null;
    const [isReady, setIsReady] = React.useState(false);
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

    const handleHeaderPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || event.defaultPrevented) {
            return;
        }
        onFocus(scriptFileName);
    }, [scriptFileName, onFocus]);

    const handlePreviewPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || event.defaultPrevented) {
            return;
        }
        // While a pending diff is shown the body hosts the interactive diff editor (Accept/Reject,
        // cursor placement); don't hijack those clicks to expand the card into Details.
        if (hasPendingDiff) {
            return;
        }
        onExpand(scriptFileName);
    }, [scriptFileName, onExpand, hasPendingDiff]);

    return (
        <div
            className={styles.feed_entry_card}
            onPointerEnter={() => onFocus(scriptFileName)}
        >
            <div className={styles.feed_entry_action_bar} onPointerDown={handleHeaderPointerDown}>
                <div className={styles.feed_entry_focus}>
                    <EyeOpenIcon
                        className={isFocused ? styles.feed_entry_focus_icon_focused : styles.feed_entry_focus_icon_hidden}
                        size={16}
                    />
                    <EyeClosedIcon
                        className={isFocused ? styles.feed_entry_focus_icon_hidden : styles.feed_entry_focus_icon_unfocused}
                        size={16}
                    />
                </div>
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
                                <IconButton
                                    variant={ButtonVariant.Invisible}
                                    size={ButtonSize.Tiny}
                                    aria-label="Rename script"
                                    onClick={startEditing}
                                    className={styles.feed_entry_action_button}
                                >
                                    <PencilIcon size={12} />
                                </IconButton>
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
                    aria-label="delete"
                    aria-labelledby="delete-entry"
                    disabled={!canDelete}
                >
                    <TrashIcon size={16} />
                </IconButton>
            </div>
            <div className={styles.feed_body} onPointerDownCapture={handlePreviewPointerDown}>
                {scriptData == null ? null : hasPendingDiff ? (
                    // Agent staged a rewrite: mount the full editable editor so the in-place diff
                    // decorations and the Accept ⏎ / Reject ⎋ panel render on the card. Accepting or
                    // rejecting clears pendingDiff, which flips this back to the read-only preview.
                    <ScriptEditor
                        sessionId={sessionId}
                        scriptKey={scriptData.scriptKey}
                        className={styles.diff_editor}
                        autoHeight
                    />
                ) : (
                    <ScriptPreview className={styles.script_preview_editor} scriptData={scriptData} onReady={setIsReady} />
                )}
            </div>
            {(queryState != null || agentTraceId != null) && (
                <div className={styles.feed_entry_execution_footer}>
                    <FeedEntryFooter
                        sessionId={sessionId}
                        queryState={queryState}
                        agentTraceId={agentTraceId}
                        vegaLiteSpec={scriptData?.annotations.visualizeQuery?.vegaLiteSpec ?? null}
                        onShowTable={() => onShowTable(scriptFileName)}
                        onShowVisualization={() => onShowVisualization(scriptFileName)}
                    />
                </div>
            )}
        </div>
    );
};

interface ScriptFeedRowProps {
    sessionId: string;
    entries: ReturnType<typeof getSelectedPageEntries>;
    scripts: NotebookState['scripts'];
    folderName: string;
    scriptDebugMode: boolean;
    focusedFileName: string;
    canDelete: boolean;
    onFocus: (fileName: string) => void;
    onExpand: (fileName: string) => void;
    onDelete: (fileName: string) => void;
    onRename: (oldFileName: string, newFileName: string) => void;
    onMoveUp: (fileName: string) => void;
    onMoveDown: (fileName: string) => void;
    onShowTable: (fileName: string) => void;
    onShowVisualization: (fileName: string) => void;
    onHeightMeasured: (index: number, height: number) => void;
    fillerRowHeight: number;
    heightsVersion: number;
}

function ScriptFeedRow(props: RowComponentProps<ScriptFeedRowProps>) {
    const { sessionId, entries, scripts, folderName, scriptDebugMode, focusedFileName, canDelete, onFocus, onExpand, onDelete, onRename, onMoveUp, onMoveDown, onShowTable, onShowVisualization, onHeightMeasured } = props;
    const isFillerRow = props.index === 0 || props.index > entries.length;
    const entryIndex = props.index - 1;
    const entry = !isFillerRow ? entries[entryIndex] : undefined;
    const scriptData = entry != null ? scripts[entry.scriptId] : undefined;
    const scriptFileName = entry?.fileName ?? '01-script.sql';
    // entries are in feed order, so position bounds drive the move-button enablement.
    const canMoveUp = !isFillerRow && entryIndex > 0;
    const canMoveDown = !isFillerRow && entryIndex < entries.length - 1;

    const outerRef = React.useRef<HTMLDivElement>(null);

    React.useLayoutEffect(() => {
        if (isFillerRow) {
            return;
        }
        const el = outerRef.current;
        if (!el) return;
        const measure = () => {
            const h = el.getBoundingClientRect().height;
            if (h > 0) onHeightMeasured(entryIndex, h);
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [entryIndex, isFillerRow, onHeightMeasured]);

    if (isFillerRow) {
        return <div className={styles.feed_list_filler} style={props.style} />;
    }

    return (
        <div ref={outerRef} style={{ ...props.style, height: 'auto' }}>
            <div
                className={styles.feed_list_item}
            >
                <ScriptCard
                    sessionId={sessionId}
                    isFocused={scriptFileName === focusedFileName}
                    scriptData={scriptData}
                    folderName={folderName}
                    scriptFileName={scriptFileName}
                    scriptDebugMode={scriptDebugMode}
                    canDelete={canDelete}
                    canMoveUp={canMoveUp}
                    canMoveDown={canMoveDown}
                    onFocus={onFocus}
                    onExpand={onExpand}
                    onDelete={onDelete}
                    onRename={onRename}
                    onMoveUp={onMoveUp}
                    onMoveDown={onMoveDown}
                    onShowTable={onShowTable}
                    onShowVisualization={onShowVisualization}
                />
            </div>
        </div>
    );
}

export const NotebookScriptFeed: React.FC<NotebookScriptListProps> = (props) => {
    const config = useAppConfig();
    const scriptDebugMode = config?.settings?.scriptDebugMode ?? false;
    const entries = getSelectedPageEntries(props.notebook);
    const pendingScrollToBottomRef = React.useRef(false);
    const [composeEditorView, setComposeEditorView] = React.useState<EditorView | null>(null);
    // The SQL/AI input mode is hoisted into the command context so the "Switch Mode" command
    // and the Ctrl+M shortcut can drive it from outside the feed.
    const { mode: inputMode, setMode: setInputMode } = useComposeInputMode();
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

    const handleFocus = React.useCallback((fileName: string) => {
        props.modifyNotebook({ type: SELECT_ENTRY, value: fileName });
    }, [props.modifyNotebook]);

    const handleExpand = React.useCallback((fileName: string) => {
        props.modifyNotebook({ type: SELECT_ENTRY, value: fileName });
        props.showDetails();
    }, [props.modifyNotebook, props.showDetails]);

    const handleShowTable = React.useCallback((fileName: string) => {
        props.modifyNotebook({ type: SELECT_ENTRY, value: fileName });
        props.showDetails(DetailsTabKey.QueryResultView);
    }, [props.modifyNotebook, props.showDetails]);

    const handleShowVisualization = React.useCallback((fileName: string) => {
        props.modifyNotebook({ type: SELECT_ENTRY, value: fileName });
        props.showDetails(DetailsTabKey.Visualization);
    }, [props.modifyNotebook, props.showDetails]);

    const isDisconnected = props.conn?.connectionHealth !== ConnectionHealth.ONLINE;
    const openConnectionOverlay = props.openConnectionOverlay;
    const executeQuery = useQueryExecutor();

    const [executeOnSend, setExecuteOnSend] = React.useState(false);
    React.useEffect(() => {
        if (isDisconnected) {
            setExecuteOnSend(false);
        } else {
            setExecuteOnSend(true);
        }
    }, [isDisconnected]);

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
        const [queryId] = executeQuery(props.notebook.sessionId, {
            query: queryText,
            analyzeResults: true,
            metadata: {
                queryType: QueryType.USER_PROVIDED,
                title: 'Notebook Query',
                description: null,
                issuer: 'Agent Visualization Re-execution',
                userProvided: true,
            },
        });
        props.modifyNotebook({ type: REGISTER_QUERY, value: [scriptData.scriptKey, queryId] });
    }, [agentState, props.notebook, props.modifyNotebook, isDisconnected, executeQuery]);

    const handleSend = React.useCallback(() => {
        pendingScrollToBottomRef.current = true;
        const notebook = props.notebook;
        const scriptKey = notebook.uncommittedScriptId;
        const scriptData = notebook.scripts[scriptKey];
        // The compose editor keeps the draft analyzed as it is typed, so the
        // resolved VISUALIZE query / derived annotations are already present (and
        // carried across promotion, which preserves the script key).
        const queryText = scriptData ? getExecutableQueryText(notebook, scriptData) : '';
        props.modifyNotebook({ type: PROMOTE_UNCOMMITTED_SCRIPT, value: null });
        if (executeOnSend && !isDisconnected && queryText.trim().length > 0) {
            const [queryId] = executeQuery(notebook.sessionId, {
                query: queryText,
                analyzeResults: true,
                metadata: {
                    queryType: QueryType.USER_PROVIDED,
                    title: "Notebook Query",
                    description: null,
                    issuer: "Query Execution Command",
                    userProvided: true
                }
            });
            props.modifyNotebook({
                type: REGISTER_QUERY,
                value: [scriptKey, queryId]
            });
        }
    }, [props.notebook, props.modifyNotebook, executeOnSend, isDisconnected, executeQuery]);

    // Send the compose editor's text to the agent run as a natural-language prompt.
    // The focused feed entry is the context + default in-place target.
    const handleSendAI = React.useCallback(() => {
        if (!aiAvailable) return;
        const prompt = composeEditorView?.state.doc.toString().trim() ?? '';
        if (prompt.length === 0) return;
        const focusedEntry = getSelectedEntry(props.notebook);
        const contextScriptKey = focusedEntry?.scriptId ?? null;
        startAgentRun({
            sessionId: props.notebook.sessionId,
            prompt,
            contextScriptKey,
            // Intent is always classified by the model (no manual Query/Chart override).
            intentOverride: null,
            notebook: props.notebook,
            modifyNotebook: props.modifyNotebook,
        });
        // Clear the prompt so the next instruction starts fresh (the editor's docChanged also
        // resets the persisted draft via onChange, but clear the ref explicitly to be safe).
        aiPromptTextRef.current = '';
        if (composeEditorView) {
            composeEditorView.dispatch({
                changes: { from: 0, to: composeEditorView.state.doc.length, insert: '' },
            });
        }
    }, [aiAvailable, composeEditorView, props.notebook, props.modifyNotebook, startAgentRun]);

    const handleComposeSend = React.useCallback(() => {
        if (inputMode === 1) {
            handleSendAI();
        } else {
            handleSend();
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

    const keyHandlers = React.useMemo<KeyEventHandler[]>(() => [
        {
            key: 'Enter',
            ctrlKey: true,
            capture: true,
            callback: (event: KeyboardEvent) => {
                if (!composeEditorView?.hasFocus) {
                    return;
                }
                event.preventDefault();
                handleComposeSend();
            },
        },
        {
            // Plain Enter, while browsing the feed with nothing focused, opens the
            // details of the currently focused entry. If the compose editor (SQL/AI),
            // a rename input, or any other element holds focus, Enter belongs to it —
            // bail out and let it handle the key. The feed is only mounted when details
            // are hidden, so this handler is naturally scoped to the feed view.
            key: 'Enter',
            ctrlKey: false,
            capture: true,
            callback: (event: KeyboardEvent) => {
                const active = document.activeElement as HTMLElement | null;
                if (active && active !== document.body && active !== document.documentElement) {
                    return;
                }
                if (entries.length === 0) {
                    return;
                }
                event.preventDefault();
                props.showDetails();
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
                if (!composeEditorView?.hasFocus) {
                    return;
                }
                event.stopPropagation();
            },
        },
    ], [composeEditorView, handleComposeSend, entries.length, props.showDetails]);
    useKeyEvents(keyHandlers);

    // Height cache for variable-height rows
    const heightsRef = React.useRef<number[]>([]);
    const [heightsVersion, setHeightsVersion] = React.useState(0);

    const handleHeightMeasured = React.useCallback((index: number, height: number) => {
        if (heightsRef.current[index] !== height) {
            heightsRef.current[index] = height;
            setHeightsVersion(v => v + 1);
        }
    }, []);

    const getRowHeight = React.useCallback((row: number) => {
        return heightsRef.current[row] ?? ESTIMATED_ROW_HEIGHT;
    }, []);

    // Measure list container dimensions for react-window
    const listContainerRef = React.useRef<HTMLDivElement>(null);
    const listContainerSize = observeSize(listContainerRef);
    const listWidth = listContainerSize?.width ?? 0;
    const listHeight = listContainerSize?.height ?? 0;
    const listRef = useListRef(null);

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
    React.useEffect(() => {
        if (props.scrollTarget == null || !listRef.current) {
            return;
        }
        const currentEntries = entriesRef.current;
        if (currentEntries.length === 0) {
            return;
        }
        const targetIdx = currentEntries.findIndex(e => e.fileName === props.scrollTarget!.fileName);
        const clampedEntryIndex = Math.max(0, Math.min(targetIdx === -1 ? 0 : targetIdx, currentEntries.length - 1));
        listRef.current.scrollToRow({
            index: clampedEntryIndex + 1,
            align: 'start',
        });
    }, [listRef, props.scrollTarget]);

    const [composeScrollbarInset, setComposeScrollbarInset] = React.useState(0);
    React.useEffect(() => {
        const listContainer = listContainerRef.current;
        if (!listContainer) {
            return;
        }
        const scroller = listContainer.firstElementChild as HTMLElement | null;
        if (!scroller) {
            return;
        }
        const measure = () => setComposeScrollbarInset(scroller.offsetWidth - scroller.clientWidth);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(scroller);
        return () => observer.disconnect();
    }, [listHeight, fillerRowHeight, entries.length, heightsVersion]);

    // Get folder name from current page (display-only: strip the on-disk ordering prefix)
    const selectedPage = getSelectedPage(props.notebook);
    const folderName = normalizePageName(selectedPage?.folderName ?? '') || 'Untitled';

    // Row props — heightsVersion is included so react-window re-evaluates row heights on change
    const focusedFileName = props.notebook.notebookUserFocus.fileName;
    const pageCount = Object.keys(props.notebook.notebookPages).length;
    const canDelete = pageCount > 1 || entries.length > 1;
    const rowProps = React.useMemo<ScriptFeedRowProps>(() => ({
        sessionId: props.notebook.sessionId,
        entries,
        scripts: props.notebook.scripts,
        folderName,
        scriptDebugMode,
        focusedFileName,
        canDelete,
        onFocus: handleFocus,
        onExpand: handleExpand,
        onDelete: handleDelete,
        onRename: handleRename,
        onMoveUp: handleMoveUp,
        onMoveDown: handleMoveDown,
        onShowTable: handleShowTable,
        onShowVisualization: handleShowVisualization,
        onHeightMeasured: handleHeightMeasured,
        fillerRowHeight,
        heightsVersion,
    }), [entries, props.notebook.scripts, folderName, scriptDebugMode, focusedFileName, canDelete, handleFocus, handleExpand, handleDelete, handleRename, handleMoveUp, handleMoveDown, handleShowTable, handleShowVisualization, handleHeightMeasured, fillerRowHeight, heightsVersion]);

    return (
        <div className={styles.feed_body_container} data-tauri-drag-region="deep">
            <div className={styles.feed_list_container} ref={listContainerRef}>
                <List
                    key={props.notebook.notebookUserFocus.folderName}
                    listRef={listRef}
                    style={{ width: listWidth, height: listHeight }}
                    rowCount={entries.length + 2}
                    rowHeight={(rowIndex) => {
                        if (rowIndex === 0) {
                            return FEED_EDGE_PADDING;
                        }
                        if (rowIndex <= entries.length) {
                            return getRowHeight(rowIndex - 1);
                        }
                        return fillerRowHeight + FEED_EDGE_PADDING;
                    }}
                    rowComponent={ScriptFeedRow}
                    rowProps={rowProps}
                />
            </div>
            <div className={styles.compose_section} ref={composeSectionRef} style={{ right: composeScrollbarInset }}>
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
                        <div className={styles.compose_send_group}>
                            {inputMode === 0 && (
                                <SegmentedControl
                                    aria-label="Save mode"
                                    size={SegmentedControlSize.Small}
                                    onChange={(index) => setExecuteOnSend(index === 1)}
                                >
                                    <SegmentedControl.Button selected={!executeOnSend}>
                                        Save
                                    </SegmentedControl.Button>
                                    <SegmentedControl.Button selected={executeOnSend} disabled={isDisconnected}>
                                        Execute
                                    </SegmentedControl.Button>
                                </SegmentedControl>
                            )}
                            {/* While an agent run is active the send button becomes a stop button
                                that cancels it — progress is now shown in the focused card's Log tab,
                                so there is no separate status strip anymore. */}
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
                            ) : (
                                <IconButton
                                    variant={ButtonVariant.Default}
                                    size={ButtonSize.Small}
                                    className={styles.compose_send_button}
                                    aria-label={inputMode === 1 ? 'Send to AI' : (executeOnSend ? 'Save & Execute' : 'Save')}
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
