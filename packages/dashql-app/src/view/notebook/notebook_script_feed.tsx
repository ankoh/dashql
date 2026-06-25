import * as React from 'react';
import * as styles from './notebook_script_feed.module.css';

import type { EditorView } from '@codemirror/view';
import type { Icon } from '@primer/octicons-react';
import { CodeIcon, PaperAirplaneIcon, SparklesFillIcon } from '@primer/octicons-react';
import { motion } from 'framer-motion';

import { useAppConfig } from '../../app_config.js';
import { ScriptStatisticsBar } from './script_statistics_bar.js';

import { List, useListRef } from 'react-window';
import type { RowComponentProps } from 'react-window';

import { ButtonSize, ButtonVariant, IconButton } from '../foundations/button.js';
import { ConnectionHealth, ConnectionState } from '../../connection/connection_state.js';
import { getExecutableQueryText, getSelectedEntry, getSelectedPage, getSelectedPageEntries, getUncommittedScriptData, REGISTER_QUERY, type ScriptData, NotebookState, SELECT_ENTRY, PROMOTE_UNCOMMITTED_SCRIPT, DELETE_NOTEBOOK_ENTRY, UPDATE_NOTEBOOK_ENTRY } from '../../notebook/notebook_state.js';
import { useAIClient } from '../../platform/ai_client_provider.js';
import { useComposeInputMode } from '../../notebook/notebook_commands.js';
import { useAgentLoopState, useRunAgentLoop, useCancelAgentLoop } from '../../notebook/agent/agent_loop_provider.js';
import { AgentLoopPhase, agentLoopIsActive, agentLoopPhaseLabel } from '../../notebook/agent/agent_loop_state.js';
import { QueryType } from '../../connection/query_execution_state.js';
import { useQueryExecutor, useQueryState } from '../../connection/query_executor.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';
import { ScriptEditor } from './script_editor.js';
import { PromptEditor } from './prompt_editor.js';
import { ScriptPreview } from './notebook_script_preview.js';
import { observeSize } from '../foundations/size_observer.js';
import type { ModifyNotebook } from '../../notebook/notebook_state_registry.js';
import { type KeyEventHandler, useKeyEvents } from '../../utils/key_events.js';
import { SegmentedControl, SegmentedControlSize } from '../foundations/segmented_control.js';
import { NotebookScriptName } from './notebook_script_name.js';
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
    onFocus: (fileName: string) => void;
    onExpand: (fileName: string) => void;
    onDelete: (fileName: string) => void;
    onRename: (oldFileName: string, newFileName: string) => void;
    onShowTable: (fileName: string) => void;
    onShowStatus: (fileName: string) => void;
}

const ScriptCard: React.FC<CollapsedScriptCardProps> = ({ sessionId, isFocused, scriptData, folderName, scriptFileName, scriptDebugMode, canDelete, onFocus, onExpand, onDelete, onRename, onShowTable, onShowStatus }) => {
    const TrashIcon: Icon = SymbolIcon('trash_16');
    const EyeIcon: Icon = SymbolIcon(isFocused ? 'eye_16' : 'eye_closed_16');
    const PencilIcon: Icon = SymbolIcon('pencil_16');
    const queryState = useQueryState(sessionId, scriptData?.latestQueryId ?? null);
    const [isReady, setIsReady] = React.useState(false);
    const [isEditing, setIsEditing] = React.useState(false);
    const [draftFileName, setDraftFileName] = React.useState(scriptFileName);
    const editInputRef = React.useRef<HTMLInputElement>(null);

    const startEditing = React.useCallback((event: React.MouseEvent) => {
        event.stopPropagation();
        setDraftFileName(scriptFileName);
        setIsEditing(true);
    }, [scriptFileName]);

    const saveEdit = React.useCallback(() => {
        const trimmed = draftFileName.trim();
        if (trimmed && trimmed !== scriptFileName) {
            onRename(scriptFileName, trimmed);
        }
        setIsEditing(false);
    }, [draftFileName, scriptFileName, onRename]);

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
        onExpand(scriptFileName);
    }, [scriptFileName, onExpand]);

    return (
        <motion.div
            className={styles.feed_entry_card}
            initial={{ y: 4, opacity: 0 }}
            animate={{ y: isReady ? 0 : 4, opacity: isReady ? 1 : 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            onPointerEnter={() => onFocus(scriptFileName)}
        >
            <div className={styles.feed_entry_action_bar} onPointerDown={handleHeaderPointerDown}>
                <div className={styles.feed_entry_focus}>
                    <EyeIcon className={isFocused ? styles.feed_entry_focus_icon_focused : styles.feed_entry_focus_icon_unfocused} size={16} />
                </div>
                <div className={styles.feed_entry_file_name}>
                    <NotebookScriptName
                        folder={folderName}
                        file={scriptFileName}
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
                    onClick={() => onDelete(scriptFileName)}
                    aria-label="delete"
                    aria-labelledby="delete-entry"
                    disabled={!canDelete}
                >
                    <TrashIcon size={16} />
                </IconButton>
            </div>
            <div className={styles.feed_body} onPointerDownCapture={handlePreviewPointerDown}>
                {scriptData != null ? <ScriptPreview className={styles.script_preview_editor} scriptData={scriptData} onReady={setIsReady} /> : null}
            </div>
            {queryState != null && (
                <div className={styles.feed_entry_execution_footer}>
                    <FeedEntryFooter
                        sessionId={sessionId}
                        queryId={queryState.queryId}
                        traceId={queryState.traceId}
                        queryState={queryState}
                        vegaLiteSpec={scriptData?.annotations.visualizeQuery?.vegaLiteSpec ?? null}
                        onShowTable={() => onShowTable(scriptFileName)}
                        onShowStatus={() => onShowStatus(scriptFileName)}
                    />
                </div>
            )}
        </motion.div>
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
    onShowTable: (fileName: string) => void;
    onShowStatus: (fileName: string) => void;
    onHeightMeasured: (index: number, height: number) => void;
    fillerRowHeight: number;
    heightsVersion: number;
}

function ScriptFeedRow(props: RowComponentProps<ScriptFeedRowProps>) {
    const { sessionId, entries, scripts, folderName, scriptDebugMode, focusedFileName, canDelete, onFocus, onExpand, onDelete, onRename, onShowTable, onShowStatus, onHeightMeasured } = props;
    const isFillerRow = props.index === 0 || props.index > entries.length;
    const entryIndex = props.index - 1;
    const entry = !isFillerRow ? entries[entryIndex] : undefined;
    const scriptData = entry != null ? scripts[entry.scriptId] : undefined;
    const scriptFileName = entry?.fileName ?? '01-script.sql';

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
                    onFocus={onFocus}
                    onExpand={onExpand}
                    onDelete={onDelete}
                    onRename={onRename}
                    onShowTable={onShowTable}
                    onShowStatus={onShowStatus}
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
    const runAgentLoop = useRunAgentLoop();
    const cancelAgentLoop = useCancelAgentLoop();
    const agentState = useAgentLoopState(sessionId);
    const agentActive = agentState != null && agentLoopIsActive(agentState.phase);

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

    const handleShowStatus = React.useCallback((fileName: string) => {
        props.modifyNotebook({ type: SELECT_ENTRY, value: fileName });
        props.showDetails(DetailsTabKey.QueryStatusPanel);
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

    // Send the compose editor's text to the agent loop as a natural-language prompt.
    // The focused feed entry is the context + default in-place target.
    const handleSendAI = React.useCallback(() => {
        if (!aiAvailable) return;
        const prompt = composeEditorView?.state.doc.toString().trim() ?? '';
        if (prompt.length === 0) return;
        const focusedEntry = getSelectedEntry(props.notebook);
        const contextScriptKey = focusedEntry?.scriptId ?? null;
        runAgentLoop({
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
    }, [aiAvailable, composeEditorView, props.notebook, props.modifyNotebook, runAgentLoop]);

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

    // Get folder name from current page
    const selectedPage = getSelectedPage(props.notebook);
    const folderName = selectedPage?.folderName ?? 'Untitled';

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
        onShowTable: handleShowTable,
        onShowStatus: handleShowStatus,
        onHeightMeasured: handleHeightMeasured,
        fillerRowHeight,
        heightsVersion,
    }), [entries, props.notebook.scripts, folderName, scriptDebugMode, focusedFileName, canDelete, handleFocus, handleExpand, handleDelete, handleRename, handleShowTable, handleShowStatus, handleHeightMeasured, fillerRowHeight, heightsVersion]);

    return (
        <div className={styles.feed_body_container}>
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
                            <IconButton
                                variant={ButtonVariant.Default}
                                size={ButtonSize.Small}
                                className={styles.compose_send_button}
                                aria-label={inputMode === 1 ? 'Send to AI' : (executeOnSend ? 'Save & Execute' : 'Save')}
                                disabled={inputMode === 1 && agentActive}
                                onClick={handleComposeSend}
                            >
                                <PaperAirplaneIcon />
                            </IconButton>
                        </div>
                    </div>
                    {inputMode === 1 && agentState != null && agentState.phase !== AgentLoopPhase.IDLE && (
                        <div className={styles.compose_status_strip}>
                            <span className={styles.compose_status_phase}>
                                {agentLoopPhaseLabel(agentState.phase)}
                            </span>
                            {agentActive && agentState.attempt > 0 && (
                                <span className={styles.compose_status_attempt}>
                                    attempt {agentState.attempt}/{agentState.maxAttempts}
                                </span>
                            )}
                            {agentState.phase === AgentLoopPhase.FAILED && agentState.error && (
                                <span className={styles.compose_status_error} title={agentState.error}>
                                    {agentState.error}
                                </span>
                            )}
                            <span className={styles.compose_status_spacer} />
                            {agentActive && (
                                <button
                                    type="button"
                                    className={styles.compose_status_cancel}
                                    onClick={() => cancelAgentLoop(sessionId)}
                                >
                                    Cancel
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
