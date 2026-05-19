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
import { getSelectedPageEntries, getUncommittedScriptData, REGISTER_QUERY, type ScriptData, NotebookState, SELECT_ENTRY, PROMOTE_UNCOMMITTED_SCRIPT, DELETE_NOTEBOOK_ENTRY, UPDATE_NOTEBOOK_ENTRY } from '../../notebook/notebook_state.js';
import { QueryType } from '../../connection/query_execution_state.js';
import { useQueryExecutor, useQueryState } from '../../connection/query_executor.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';
import { ScriptEditor } from './script_editor.js';
import { ScriptPreview } from './notebook_script_preview.js';
import { observeSize } from '../foundations/size_observer.js';
import type { ModifyNotebook } from '../../notebook/notebook_state_registry.js';
import { type KeyEventHandler, useKeyEvents } from '../../utils/key_events.js';
import { SegmentedControl, SegmentedControlSize } from '../foundations/segmented_control.js';
import { NotebookScriptName } from './notebook_script_name.js';
import { FeedEntryFooter } from './feed_entry_footer.js';
import { TabKey as DetailsTabKey } from './notebook_script_details.js';

interface FeedScrollTarget {
    entryIndex: number;
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
    entryIndex: number;
    isFocused: boolean;
    scriptData: ScriptData | undefined;
    folderName: string;
    scriptFileName: string;
    scriptDebugMode: boolean;
    canDelete: boolean;
    onFocus: (entryIndex: number) => void;
    onExpand: (entryIndex: number) => void;
    onDelete: (entryIndex: number) => void;
    onRename: (entryIndex: number, fileName: string) => void;
    onShowTable: (entryIndex: number) => void;
    onShowStatus: (entryIndex: number) => void;
}

const ScriptCard: React.FC<CollapsedScriptCardProps> = ({ sessionId, entryIndex, isFocused, scriptData, folderName, scriptFileName, scriptDebugMode, canDelete, onFocus, onExpand, onDelete, onRename, onShowTable, onShowStatus }) => {
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
            onRename(entryIndex, trimmed);
        }
        setIsEditing(false);
    }, [draftFileName, scriptFileName, entryIndex, onRename]);

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
        onFocus(entryIndex);
    }, [entryIndex, onFocus]);

    const handlePreviewPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || event.defaultPrevented) {
            return;
        }
        onExpand(entryIndex);
    }, [entryIndex, onExpand]);

    return (
        <motion.div
            className={styles.feed_entry_card}
            initial={{ y: 4, opacity: 0 }}
            animate={{ y: isReady ? 0 : 4, opacity: isReady ? 1 : 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            onPointerEnter={() => onFocus(entryIndex)}
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
                    onClick={() => onDelete(entryIndex)}
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
                        onShowTable={() => onShowTable(entryIndex)}
                        onShowStatus={() => onShowStatus(entryIndex)}
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
    focusedEntryIndex: number;
    canDelete: boolean;
    onFocus: (index: number) => void;
    onExpand: (index: number) => void;
    onDelete: (index: number) => void;
    onRename: (index: number, fileName: string) => void;
    onShowTable: (index: number) => void;
    onShowStatus: (index: number) => void;
    onHeightMeasured: (index: number, height: number) => void;
    fillerRowHeight: number;
    heightsVersion: number;
}

function ScriptFeedRow(props: RowComponentProps<ScriptFeedRowProps>) {
    const { sessionId, entries, scripts, folderName, scriptDebugMode, focusedEntryIndex, canDelete, onFocus, onExpand, onDelete, onRename, onShowTable, onShowStatus, onHeightMeasured } = props;
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
                    entryIndex={entryIndex}
                    isFocused={entryIndex === focusedEntryIndex}
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
    const [inputMode, setInputMode] = React.useState<number>(0); // 0 = SQL, 1 = Natural Language

    const handleFocus = React.useCallback((entryIndex: number) => {
        props.modifyNotebook({ type: SELECT_ENTRY, value: entryIndex });
    }, [props.modifyNotebook]);

    const handleExpand = React.useCallback((entryIndex: number) => {
        props.modifyNotebook({ type: SELECT_ENTRY, value: entryIndex });
        props.showDetails();
    }, [props.modifyNotebook, props.showDetails]);

    const handleShowTable = React.useCallback((entryIndex: number) => {
        props.modifyNotebook({ type: SELECT_ENTRY, value: entryIndex });
        props.showDetails(DetailsTabKey.QueryResultView);
    }, [props.modifyNotebook, props.showDetails]);

    const handleShowStatus = React.useCallback((entryIndex: number) => {
        props.modifyNotebook({ type: SELECT_ENTRY, value: entryIndex });
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
        const mainScriptText = scriptData?.script.toString() ?? '';
        props.modifyNotebook({ type: PROMOTE_UNCOMMITTED_SCRIPT, value: null });
        if (executeOnSend && !isDisconnected && mainScriptText.trim().length > 0) {
            const pageIndex = notebook.notebookUserFocus.pageIndex;
            const page = notebook.notebookPages[pageIndex];
            const entryInPage = page ? page.scripts.length : 0;
            const [queryId] = executeQuery(notebook.sessionId, {
                query: mainScriptText,
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
                value: [pageIndex, entryInPage, scriptKey, queryId]
            });
        }
    }, [props.notebook, props.modifyNotebook, executeOnSend, isDisconnected, executeQuery]);

    const handleDelete = React.useCallback((entryIndex: number) => {
        props.modifyNotebook({ type: DELETE_NOTEBOOK_ENTRY, value: entryIndex });
    }, [props.modifyNotebook]);

    const handleRename = React.useCallback((entryIndex: number, fileName: string) => {
        props.modifyNotebook({ type: UPDATE_NOTEBOOK_ENTRY, value: { entryIndex, fileName } });
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
                handleSend();
            },
        },
    ], [composeEditorView, handleSend]);
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

    React.useEffect(() => {
        if (props.scrollTarget == null || !listRef.current || entries.length === 0) {
            return;
        }
        const clampedEntryIndex = Math.max(0, Math.min(props.scrollTarget.entryIndex, entries.length - 1));
        listRef.current.scrollToRow({
            index: clampedEntryIndex + 1,
            align: 'start',
        });
    }, [entries.length, listRef, props.scrollTarget]);

    // Measure the actual scrollbar inset from the scroller element directly,
    // rather than relying on a static measurement that can be wrong when macOS
    // switches between overlay and non-overlay scrollbar styles.
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
        setComposeScrollbarInset(scroller.offsetWidth - scroller.clientWidth);
    }, [listHeight, fillerRowHeight, entries.length, heightsVersion]);

    // Get folder name from current page
    const selectedPage = props.notebook.notebookPages[props.notebook.notebookUserFocus.pageIndex];
    const folderName = selectedPage?.folderName ?? 'Untitled';

    // Row props — heightsVersion is included so react-window re-evaluates row heights on change
    const focusedEntryIndex = props.notebook.notebookUserFocus.entryInPage;
    const canDelete = props.notebook.notebookPages.length > 1 || entries.length > 1;
    const rowProps = React.useMemo<ScriptFeedRowProps>(() => ({
        sessionId: props.notebook.sessionId,
        entries,
        scripts: props.notebook.scripts,
        folderName,
        scriptDebugMode,
        focusedEntryIndex,
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
    }), [entries, props.notebook.scripts, folderName, scriptDebugMode, focusedEntryIndex, canDelete, handleFocus, handleExpand, handleDelete, handleRename, handleShowTable, handleShowStatus, handleHeightMeasured, fillerRowHeight, heightsVersion]);

    return (
        <div className={styles.feed_body_container}>
            <div className={styles.feed_list_container} ref={listContainerRef}>
                <List
                    key={props.notebook.notebookUserFocus.pageIndex}
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
                    <ScriptEditor
                        sessionId={props.notebook.sessionId}
                        scriptKey={getUncommittedScriptData(props.notebook)?.scriptKey ?? 0}
                        className={styles.compose_card_body}
                        autoHeight
                        setView={setComposeEditorView}
                    />
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
                                disabled
                            >
                                AI
                            </SegmentedControl.Button>
                        </SegmentedControl>
                        <div className={styles.compose_send_group}>
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
                            <IconButton
                                variant={ButtonVariant.Default}
                                size={ButtonSize.Small}
                                className={styles.compose_send_button}
                                aria-label={executeOnSend ? 'Save & Execute' : 'Save'}
                                onClick={handleSend}
                            >
                                <PaperAirplaneIcon />
                            </IconButton>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
