import * as React from 'react';
import * as styles from './session_feed.module.css';


import type { EditorView } from '@codemirror/view';
import { useAppConfig } from '../../config/app_config.js';
import { AgentFace } from '../../agent/agent_face.js';

import { List } from 'react-window';
import {
    DndContext,
    DragEndEvent,
    KeyboardSensor,
    type Modifier,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';

import { ConnectionHealth, ConnectionState, connectionCachesQueryResults } from '../../connections/connection_state.js';
import { getSelectedScriptRef, getScriptRefs, newScriptConnection, SessionScripts, type ScriptData, SELECT_SCRIPT, CREATE_SCRIPT, DELETE_SCRIPT, REORDER_SCRIPTS, SET_SCRIPT_TEXT, SET_SCRIPT_VIS_SPEC, ACCEPT_PENDING_DIFF, REJECT_PENDING_DIFF, SET_SESSION_ATTACHMENTS } from '../scripts/session_scripts.js';
import { markSessionAttachmentsChanged } from '../attachments/attachment_mounts.js';
import { renameAttachment } from '../attachments/attachment_rename.js';
import { attachmentParameterName, readSessionAttachments, sameSessionAttachments, uniqueAttachmentFileName } from '../attachments/session_attachments.js';
import { useQueryExecutor } from '../../connections/query_executor.js';
import { type ModifySessionScripts } from '../scripts/session_scripts_registry.js';
import { scriptDisplayName } from '../scripts/script_types.js';
import { checkSessionScriptReferences } from '../scripts/script_reference_reports.js';
import { sessionTableParameters } from '../scripts/table_parameters_publisher.js';
import { insertMentionAtCursor, useLastFocusedEditor } from '../editor/editor_focus.js';
import { DashQLProcessorPlugin } from '../editor/dashql_processor.js';
import { renameScript, type RenameDraftReferences } from '../scripts/script_rename.js';
import { type KeyEventHandler, useKeyEvents } from '../../utils/key_events.js';
import { runSessionScript } from '../scripts/rerun_query.js';
import { computeScriptResultCacheKey, scriptRunServices } from '../scripts/script_run.js';
import { useStorageReader, useStorageWriter } from '../../storage/storage_provider.js';
import { useQueryResultCache } from '../../storage/query_result_cache_provider.js';
import { groupSessionAttachmentListWrites, REFRESH_SESSION_ATTACHMENTS } from '../../storage/storage_writer.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { FEED_GAP, revealScrollOffset, useSessionFeedLayout } from './session_feed_layout.js';
import { ScriptFeedRow, type ScriptFeedRowProps } from './session_feed_row.js';
import { getKeywordCase } from '../scripts/script_format.js';
import { reorderFeedEntries } from './session_feed_drag.js';
import { ATTACHMENT_EXTENSION, isAttachmentFileName, type DataFile } from '../../storage/storage_backend.js';
import { stringifyError } from '../../platform/logger/logger.js';
import { SessionDataCard } from './session_data_card.js';
import { SessionInputStrip } from '../inputs/session_input_strip.js';
import { VerticalScrollShadows } from '../../ui/foundations/vertical_scroll_shadows.js';
import {
    ScriptConnectionPicker,
    scriptConnectionView,
    useAttachPendingConnection,
    usePickPendingConnection,
    usePickScriptConnection,
    type ScriptConnectionView,
} from '../scripts/script_connection_picker.js';
import { useConnectionLabeler } from '../connection_labels.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { ChevronDownIcon, ChevronUpIcon, PlusIcon } from '../../ui/foundations/symbol_icon.js';
import { connectionReadsAttachments } from '../../connections/connector_descriptor.js';
import { SessionConnectionAttentionContext } from '../session_connection_attention.js';
import { SessionComposer, SessionComposerVariant } from './session_composer.js';
import { ComposerInputMode } from '../../agent/input_mode.js';
import { useAgentBridge } from '../../agent/agent_bridge.js';
import type { AgentFollowTarget } from '../../agent/use_agent_questions.js';
import { useComposerAgent } from '../../agent/use_composer_agent.js';

export interface SessionFeedProps {
    sessionScripts: SessionScripts;
    modifySessionScripts: ModifySessionScripts;
    /// Receives the function that renames the references in the draft of the composer, for renames of other views
    draftRenameRef?: React.RefObject<RenameDraftReferences | null>;
    /// The connection that the next script runs on
    conn: ConnectionState | null;
    /// The connections that the scripts run on, by default the connection of the next script
    scriptConnections?: ReadonlyMap<string, ConnectionState>;
    /// Whether the feed is the visible, interactive layer. The feed stays mounted (just hidden) while
    /// another view, e.g. a connection overview, is open so it keeps its scroll position and measured row heights;
    /// while inactive its global key handlers must stand down so Escape/Enter belong to the overlay.
    active: boolean;
    /// A script to scroll into view, e.g. one opened from the sidebar. A new request object reveals again.
    revealRequest?: SessionFeedRevealRequest | null;
    dependencies?: SessionFeedDependencies;
}

/// A script that the feed scrolls into view once its session shows
export interface SessionFeedRevealRequest {
    sessionId: string;
    fileName: string;
}

export interface SessionFeedDependencies {
    useQueryExecutor: typeof useQueryExecutor;
    useStorageReader: typeof useStorageReader;
    useStorageWriter: typeof useStorageWriter;
    usePickScriptConnection: typeof usePickScriptConnection;
    usePickPendingConnection: typeof usePickPendingConnection;
    useAttachPendingConnection: typeof useAttachPendingConnection;
    useKeyEvents: typeof useKeyEvents;
    runSessionScript: typeof runSessionScript;
    useAgentBridge: typeof useAgentBridge;
    SessionComposer: typeof SessionComposer;
    ScriptFeedRow: typeof ScriptFeedRow;
}

const DEFAULT_DEPENDENCIES: SessionFeedDependencies = {
    useQueryExecutor,
    useStorageReader,
    useStorageWriter,
    usePickScriptConnection,
    usePickPendingConnection,
    useAttachPendingConnection,
    useKeyEvents,
    runSessionScript,
    useAgentBridge,
    SessionComposer,
    ScriptFeedRow,
};

const LOG_CTX = 'session_feed';
const OVERSCAN_ROW_COUNT = 16;
const FEED_ENTRY_CHROME_HEIGHT = 50;
const FEED_EDITOR_LINE_HEIGHT = 18;
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/// The views of the connections that the scripts run on.
/// The map keeps its identity while the shown fields are unchanged, the memoized feed rows depend on it.
function useScriptConnectionViews(connections: ReadonlyMap<string, ConnectionState>): ReadonlyMap<string, ScriptConnectionView> {
    const labeler = useConnectionLabeler();
    const views = React.useRef<Map<string, ScriptConnectionView>>(new Map());
    const next = new Map<string, ScriptConnectionView>();
    for (const connection of connections.values()) next.set(connection.connectionId, scriptConnectionView(connection, labeler(connection)));
    const prev = views.current;
    const unchanged = prev.size === next.size && [...next].every(([id, view]) => {
        const old = prev.get(id);
        return old != null && old.connectionHealth === view.connectionHealth && old.details === view.details && old.label === view.label;
    });
    if (!unchanged) views.current = next;
    return views.current;
}

/// The rows are keyed by script, a script inserted above moves the mounted rows of the scripts below instead of
/// handing their rows to other scripts. The cards keep their editors and their measured heights.
function feedRowKey(index: number, rowProps: ScriptFeedRowProps): React.Key {
    return rowProps.entries[index]?.scriptId ?? `index-${index}`;
}

function estimateFeedEntryHeight(scriptText: string) {
    return FEED_ENTRY_CHROME_HEIGHT + Math.max(1, scriptText.split('\n').length) * FEED_EDITOR_LINE_HEIGHT;
}

export const SessionFeed: React.FC<SessionFeedProps> = (props) => {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const config = useAppConfig();
    const logger = useLogger();
    const scriptDebugMode = config?.settings?.scriptDebugMode ?? false;
    const formattingDebugMode = config?.settings?.formattingDebugMode ?? false;
    const attachmentsVisible = config?.settings?.experimental_file_attachments === true;
    const keywordCase = getKeywordCase(config?.settings);
    const scriptRefs = props.sessionScripts.scriptRefs;
    const scriptOrder = props.sessionScripts.scriptOrder;
    // The estimated heights only matter until a row is measured.
    // Don't re-estimate (and copy the text of every script) whenever any script changes.
    const canonicalEntries = React.useMemo(
        () => getScriptRefs(props.sessionScripts).map(entry => ({
            ...entry,
            estimatedHeight: estimateFeedEntryHeight(
                props.sessionScripts.scripts[entry.scriptId]?.scriptSession.getText() ?? '',
            ),
        })),
        [scriptRefs, scriptOrder],
    );
    const [displayEntries, setDisplayEntries] = React.useState(() => ({
        source: canonicalEntries,
        entries: canonicalEntries,
    }));
    const entries = displayEntries.source === canonicalEntries
        ? displayEntries.entries
        : canonicalEntries;
    React.useLayoutEffect(() => {
        setDisplayEntries({ source: canonicalEntries, entries: canonicalEntries });
    }, [canonicalEntries]);
    const defaultConnections = React.useMemo(
        () => new Map(props.conn == null ? [] : [[props.conn.connectionId, props.conn]]),
        [props.conn],
    );
    const scriptConnections = useScriptConnectionViews(props.scriptConnections ?? defaultConnections);
    // The connections that cache query results, the cache indicators follow them
    const cachingConnections = [...(props.scriptConnections ?? defaultConnections).values()]
        .filter(connectionCachesQueryResults).map(connection => connection.connectionId).join(',');
    // The composer drafts the next script, on the connection that the script will run on
    const composerConnection = newScriptConnection(props.sessionScripts, null);
    const storageReader = dependencies.useStorageReader();
    const queryResultCache = useQueryResultCache();
    const storageWriter = dependencies.useStorageWriter();
    const sessionId = props.sessionScripts.sessionId;
    const [dataFiles, setDataFiles] = React.useState<{ sessionId: string; files: DataFile[] } | null>(null);
    const [dataFilesVersion, setDataFilesVersion] = React.useState(0);
    const [attachmentsExpanded, setAttachmentsExpanded] = React.useState(false);
    const [attachmentError, setAttachmentError] = React.useState<string | null>(null);
    const attachmentInputRef = React.useRef<HTMLInputElement>(null);
    const latestAttachments = React.useRef(props.sessionScripts.attachments);
    latestAttachments.current = props.sessionScripts.attachments;
    const latestScriptOrder = React.useRef(props.sessionScripts.scriptOrder);
    latestScriptOrder.current = props.sessionScripts.scriptOrder;
    // The session file lists the attachments, a changed attachment updates the list and the mount of the attachments
    const refreshDataFiles = React.useCallback(() => {
        markSessionAttachmentsChanged(sessionId);
        setDataFilesVersion(version => version + 1);
        void storageWriter.write(groupSessionAttachmentListWrites(sessionId), { type: REFRESH_SESSION_ATTACHMENTS, value: sessionId });
    }, [sessionId, storageWriter]);
    React.useEffect(() => {
        const cancel = new AbortController();
        storageReader.backend.listDataFiles(sessionId).then(files => {
            if (!cancel.signal.aborted) {
                // The scripts read the Parquet attachments as table parameters
                const known = latestAttachments.current ?? [];
                if (!sameSessionAttachments(known, readSessionAttachments(files, known))) {
                    void props.modifySessionScripts({ type: SET_SESSION_ATTACHMENTS, value: files });
                }
                setDataFiles({
                    sessionId, files: [...files].sort((a, b) => (
                        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
                    ))
                });
            }
        }).catch(e => {
            if (!cancel.signal.aborted) {
                logger.error('Listing session data files failed', { error: stringifyError(e) }, LOG_CTX);
            }
        });
        return () => cancel.abort();
    }, [sessionId, storageReader.backend, dataFilesVersion, logger, props.modifySessionScripts]);
    const pinnedDataFiles = dataFiles?.sessionId === sessionId ? dataFiles.files : [];
    const attachmentsEnabled = connectionReadsAttachments(props.conn?.details);
    const saveAttachments = React.useCallback(async (files: Iterable<File>) => {
        setAttachmentError(null);
        // A session attaches Parquet files only, they are table parameters of the scripts
        const parquet = [...files].filter(file => isAttachmentFileName(file.name));
        const refused = [...files].filter(file => !isAttachmentFileName(file.name));
        if (refused.length > 0) {
            setAttachmentError(`Only Parquet files can be attached: ${refused.map(file => file.name).join(', ')}`);
        }
        if (parquet.length === 0) return;
        try {
            // An attachment takes no name of a script or another attachment
            const scriptNames = latestScriptOrder.current.map(scriptDisplayName);
            const attachments = [...(latestAttachments.current ?? [])];
            for (const file of parquet) {
                const fileName = uniqueAttachmentFileName(file.name, scriptNames, attachments);
                await storageReader.backend.saveDataFile(sessionId, fileName, file);
                attachments.push(...readSessionAttachments([{ name: fileName, sizeBytes: file.size }]));
            }
            refreshDataFiles();
        } catch (e) {
            setAttachmentError('Adding attachment failed');
            logger.error('Adding session attachment failed', { error: stringifyError(e) }, LOG_CTX);
        }
    }, [logger, sessionId, refreshDataFiles, storageReader.backend]);
    const handleAttachmentInput = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        if (attachmentsEnabled && event.target.files != null) void saveAttachments(Array.from(event.target.files));
        event.target.value = '';
    }, [saveAttachments]);
    const handleAttachmentDrop = React.useCallback((event: React.DragEvent<HTMLElement>) => {
        event.preventDefault();
        if (props.active && attachmentsEnabled) void saveAttachments(Array.from(event.dataTransfer.files));
    }, [attachmentsEnabled, props.active, saveAttachments]);

    // The session scripts change with every keystroke and the connection with every query event.
    // Callbacks read the latest values through a ref to stay stable for the memoized feed rows.
    const latest = React.useRef({ sessionScripts: props.sessionScripts, scriptConnections });
    latest.current = { sessionScripts: props.sessionScripts, scriptConnections };
    const pickScriptConnection = dependencies.usePickScriptConnection(props.sessionScripts.sessionId, props.modifySessionScripts);
    // New scripts, and the draft of the composer, use the default connection of the session
    const pickPendingConnection = dependencies.usePickPendingConnection(props.modifySessionScripts);
    const attachPendingConnection = dependencies.useAttachPendingConnection(props.sessionScripts.instance, props.modifySessionScripts);

    const pendingCreatedScriptKeyRef = React.useRef<number | null>(null);
    const editorViewsRef = React.useRef(new Map<number, EditorView>());
    // Presence means collapsed. A query id marks an automatic no-result collapse; null marks a
    // manual collapse, which must not be reset when a later query starts.
    const [collapsedResults, setCollapsedResults] = React.useState<ReadonlyMap<number, number | null>>(() => new Map());

    const handleFocus = React.useCallback((fileName: string) => {
        props.modifySessionScripts({ type: SELECT_SCRIPT, value: fileName });
    }, [props.modifySessionScripts]);

    const executeQuery = dependencies.useQueryExecutor();
    // A script runs while its own connection is online
    const isScriptOnline = (scriptData: ScriptData) =>
        latest.current.scriptConnections.get(scriptData.connection.connectionId)?.connectionHealth === ConnectionHealth.ONLINE;

    // Refresh: run the script and the scripts it references without reading cached results, their results become the
    // newest files of their keys. Resolves the script by feed file name.
    const handleRerunEntry = React.useCallback((fileName: string) => {
        const { sessionScripts } = latest.current;
        const entry = sessionScripts.scriptRefs[fileName];
        const scriptData = entry != null ? sessionScripts.scripts[entry.scriptId] : undefined;
        if (scriptData == null || !isScriptOnline(scriptData)) {
            return;
        }
        dependencies.runSessionScript(sessionScripts, scriptData, executeQuery, props.modifySessionScripts, logger, { refresh: true });
    }, [props.modifySessionScripts, executeQuery, logger]);

    // The cache indicator of a script looks up the key of a run of the script in the cache of the app
    const lookupCachedResult = React.useCallback(async (cacheKey: string) => (await queryResultCache?.lookup(cacheKey))?.cachedAtMs ?? null, [queryResultCache]);

    // The cache key of a run of a script, the cache indicator of the script checks it. A new callback when connections
    // start or stop caching, so the indicators check again.
    const computeCacheKey = React.useCallback(async (scriptKey: number) => {
        const { sessionScripts } = latest.current;
        const scriptData = sessionScripts.scripts[scriptKey];
        if (scriptData == null) return null;
        return await computeScriptResultCacheKey(scriptRunServices(sessionScripts.instance), sessionScripts, scriptData);
    }, [cachingConnections]);

    const handleExecuteEntry = React.useCallback((fileName: string) => {
        const { sessionScripts } = latest.current;
        const entry = sessionScripts.scriptRefs[fileName];
        const scriptData = entry != null ? sessionScripts.scripts[entry.scriptId] : undefined;
        if (scriptData == null || !isScriptOnline(scriptData)) return;
        dependencies.runSessionScript(sessionScripts, scriptData, executeQuery, props.modifySessionScripts, logger);
    }, [executeQuery, props.modifySessionScripts, logger]);

    const handleDelete = React.useCallback((fileName: string) => {
        props.modifySessionScripts({ type: DELETE_SCRIPT, value: fileName });
    }, [props.modifySessionScripts]);

    // A rename rewrites the references in the other scripts and in the draft of the composer
    const ownDraftRenameRef = React.useRef<RenameDraftReferences | null>(null);
    const composerRenameScriptRef = props.draftRenameRef ?? ownDraftRenameRef;
    const handleRename = React.useCallback((oldFileName: string, newFileName: string) => {
        void renameScript(props.sessionScripts, props.modifySessionScripts, oldFileName, newFileName, composerRenameScriptRef.current);
    }, [props.sessionScripts, props.modifySessionScripts, composerRenameScriptRef]);

    // Move a script one position up/down within the session by swapping it with its neighbour in the
    // feed order and dispatching the new full order to REORDER_SCRIPTS.
    const moveScript = React.useCallback((fileName: string, delta: number) => {
        const order = [...latest.current.sessionScripts.scriptOrder];
        const from = order.indexOf(fileName);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= order.length) return;
        [order[from], order[to]] = [order[to], order[from]];
        props.modifySessionScripts({
            type: REORDER_SCRIPTS,
            value: order,
        });
    }, [props.modifySessionScripts]);
    const handleMoveUp = React.useCallback((fileName: string) => moveScript(fileName, -1), [moveScript]);
    const handleMoveDown = React.useCallback((fileName: string) => moveScript(fileName, 1), [moveScript]);
    const dndSensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    const handleDragEnd = React.useCallback((event: DragEndEvent) => {
        const { active, over } = event;
        if (over == null || active.id === over.id) return;
        const reordered = reorderFeedEntries(entries, active.id, over.id);
        if (reordered == null) return;
        // Keep the dropped order visible while REORDER_SCRIPTS updates the order of the session.
        // Stable script ids let React and dnd-kit retain card identity without forcing a render while
        // dnd-kit still has the active drag transform applied.
        setDisplayEntries({ source: canonicalEntries, entries: reordered });
        props.modifySessionScripts({
            type: REORDER_SCRIPTS,
            value: reordered.map(entry => entry.fileName),
        });
    }, [entries, props.modifySessionScripts, canonicalEntries]);

    const handleFormat = React.useCallback((scriptKey: number, text: string) => {
        props.modifySessionScripts({
            type: SET_SCRIPT_TEXT,
            value: { scriptKey, text, withDiff: true },
        });
    }, [props.modifySessionScripts]);

    // A snippet replaces the text of a script, a script with text shows the replacement as a diff to accept or reject
    const handleApplySnippet = React.useCallback((scriptKey: number, text: string) => {
        const priorText = props.sessionScripts.scripts[scriptKey]?.scriptSession.getText() ?? '';
        props.modifySessionScripts({
            type: SET_SCRIPT_TEXT,
            value: { scriptKey, text, withDiff: priorText.trim().length > 0 },
        });
    }, [props.modifySessionScripts, props.sessionScripts.scripts]);

    // The chart builder of a card stages every edit of its spec for the `@vis vegalite` tag as a diff to accept or reject
    const handleSetVisSpec = React.useCallback((scriptKey: number, spec: string) => {
        props.modifySessionScripts({ type: SET_SCRIPT_VIS_SPEC, value: { scriptKey, spec } });
    }, [props.modifySessionScripts]);

    // Accept / reject a staged rewrite from the feed. Accept keeps the new text; reject restores the
    // prior text and re-analyzes.
    const handleAcceptDiff = React.useCallback((scriptKey: number) => {
        props.modifySessionScripts({ type: ACCEPT_PENDING_DIFF, value: scriptKey });
    }, [props.modifySessionScripts]);
    const handleRejectDiff = React.useCallback((scriptKey: number) => {
        props.modifySessionScripts({ type: REJECT_PENDING_DIFF, value: scriptKey });
    }, [props.modifySessionScripts]);
    const handleToggleResultExpanded = React.useCallback((scriptKey: number) => {
        setCollapsedResults(current => {
            const next = new Map(current);
            if (next.has(scriptKey)) next.delete(scriptKey);
            else next.set(scriptKey, null);
            return next;
        });
    }, []);
    const handleAutoCollapseResult = React.useCallback((scriptKey: number, queryId: number) => {
        setCollapsedResults(current => {
            if (current.has(scriptKey)) return current;
            const next = new Map(current);
            next.set(scriptKey, queryId);
            return next;
        });
    }, []);
    const handleResetAutoCollapsedResult = React.useCallback((scriptKey: number, queryId: number | null) => {
        setCollapsedResults(current => {
            const autoCollapsedQueryId = current.get(scriptKey);
            if (autoCollapsedQueryId == null || autoCollapsedQueryId === queryId) return current;
            const next = new Map(current);
            next.delete(scriptKey);
            return next;
        });
    }, []);

    const [composerView, setComposerView] = React.useState<EditorView | null>(null);
    const [composerDraftEmpty, setComposerDraftEmpty] = React.useState(true);
    const composerSubmitRef = React.useRef<(() => void) | null>(null);
    // The mention button of a script references it in the question of the composer
    const composerTargetScriptRef = React.useRef<((name: string) => void) | null>(null);
    // A mention of a script goes to the cursor of the script editor that had the focus last, other than the editor of
    // the script itself, or into the composer
    const lastFocusedEditor = useLastFocusedEditor();
    // The mention of a table parameter, a script that is not `fileName` reads it
    const handleMention = React.useCallback((name: string, fileName: string | null) => {
        const view = lastFocusedEditor();
        if (view != null && view !== composerView) {
            const scriptKey = view.state.field(DashQLProcessorPlugin, false)?.scriptKey;
            const target = scriptKey != null ? props.sessionScripts.scripts[scriptKey] : undefined;
            if (target != null && target.fileName !== fileName) {
                insertMentionAtCursor(view, `:${props.sessionScripts.instance.quoteIdentifier(name)}`);
                return;
            }
        }
        composerTargetScriptRef.current?.(name);
    }, [lastFocusedEditor, composerView, props.sessionScripts.scripts, props.sessionScripts.instance]);
    const handleTargetScript = React.useCallback((fileName: string) => handleMention(scriptDisplayName(fileName), fileName), [handleMention]);
    const handleMentionAttachment = React.useCallback((name: string) => handleMention(name, null), [handleMention]);
    // An attachment renames like a script, the scripts and the draft that read it follow
    const handleRenameAttachment = React.useCallback((fileName: string, name: string) => {
        void renameAttachment(latest.current.sessionScripts, props.modifySessionScripts, storageReader.backend, fileName, name, composerRenameScriptRef.current)
            .then(renamed => { if (renamed != null) refreshDataFiles(); })
            .catch(e => {
                setAttachmentError('Renaming attachment failed');
                logger.error('Renaming session attachment failed', { error: stringifyError(e) }, LOG_CTX);
            });
    }, [props.modifySessionScripts, storageReader.backend, composerRenameScriptRef, refreshDataFiles, logger]);
    const scriptNames = React.useMemo(() => props.sessionScripts.scriptOrder.map(scriptDisplayName), [props.sessionScripts.scriptOrder]);

    // The feed stays mounted (just hidden) while another view, e.g. a connection overview, is open, so its global
    // key handlers would otherwise keep firing behind the overlay. Gate them all on the active flag.
    const feedActive = props.active;
    // A modal dialog keeps Enter and Escape, e.g. Escape closes the chart builder instead of rejecting the diff that
    // the builder stages behind it
    const modalDialogOpen = () => document.querySelector('[aria-modal="true"]') != null;
    const keyHandlers = React.useMemo<KeyEventHandler[]>(() => [
        {
            // Plain Enter, while browsing the feed with nothing focused, accepts a staged
            // rewrite (matching the status bar's "Accept ⏎" hint). It intentionally does nothing for
            // ordinary scripts.
            key: 'Enter',
            ctrlKey: false,
            capture: true,
            callback: (event: KeyboardEvent) => {
                if (!feedActive || modalDialogOpen()) {
                    return;
                }
                const active = document.activeElement as HTMLElement | null;
                if (active && active !== document.body && active !== document.documentElement) {
                    return;
                }
                const sessionScripts = latest.current.sessionScripts;
                const focused = getSelectedScriptRef(sessionScripts);
                const focusedScript = focused != null ? sessionScripts.scripts[focused.scriptId] : null;
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
            // An inline editor, rename input, or open completion dropdown keeps Escape when focused.
            key: 'Escape',
            ctrlKey: false,
            capture: true,
            callback: (event: KeyboardEvent) => {
                if (!feedActive || modalDialogOpen()) {
                    return;
                }
                const active = document.activeElement as HTMLElement | null;
                if (active && active !== document.body && active !== document.documentElement) {
                    return;
                }
                const sessionScripts = latest.current.sessionScripts;
                const focused = getSelectedScriptRef(sessionScripts);
                const focusedScript = focused != null ? sessionScripts.scripts[focused.scriptId] : null;
                if (focusedScript?.pendingDiff != null) {
                    event.preventDefault();
                    handleRejectDiff(focusedScript.scriptKey);
                }
            },
        },
        {
            // Ctrl+E executes the selected script globally. While the composer has focus, it sends the
            // draft instead of running a script the user isn't looking at.
            key: 'e',
            ctrlKey: true,
            capture: true,
            callback: (event: KeyboardEvent) => {
                if (!feedActive || composerView == null || !composerView.hasFocus) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                composerSubmitRef.current?.();
            },
        },
    ], [feedActive, composerView, handleAcceptDiff, handleRejectDiff]);
    dependencies.useKeyEvents(keyHandlers);

    const feedLayout = useSessionFeedLayout(entries);

    const handleEditorView = React.useCallback((scriptKey: number, view: EditorView) => {
        editorViewsRef.current.set(scriptKey, view);
        if (pendingCreatedScriptKeyRef.current !== scriptKey) return;
        pendingCreatedScriptKeyRef.current = null;
        requestAnimationFrame(() => view.focus());
    }, []);

    // The composer appends its draft as a new script and runs it right away.
    // The composer keeps a SQL draft while its connection is not connected, a script that the agent writes
    // on a connection that is not connected is only created and the connection asks for attention.
    const connectionAttention = React.useContext(SessionConnectionAttentionContext);
    const pendingScrollToEndRef = React.useRef(false);
    const appendScript = React.useCallback(async (text: string) => {
        const result = props.modifySessionScripts({ type: CREATE_SCRIPT, value: { index: null, text } });
        if (!result) return null;
        pendingScrollToEndRef.current = true;
        const next = await result;
        if (next == null) return null;
        const created = getSelectedScriptRef(next);
        const scriptData = created != null ? next.scripts[created.scriptId] : undefined;
        return scriptData != null ? { next, scriptData } : null;
    }, [props.modifySessionScripts]);
    const runAppendedScript = React.useCallback((next: SessionScripts, scriptData: ScriptData) => {
        // The agent may write the script on another connection than the one of the composer
        if (!isScriptOnline(scriptData)) {
            connectionAttention?.request(next.sessionId);
            return;
        }
        dependencies.runSessionScript(next, scriptData, executeQuery, props.modifySessionScripts, logger);
    }, [connectionAttention, executeQuery, logger, props.modifySessionScripts]);

    // Scroll a script into view.
    // A script with results that does not fit shows its results, once its row is mounted and the results are measured.
    // A created script has no entry until the next render.
    const revealScript = React.useCallback((scriptKey: number, target: AgentFollowTarget) => {
        const index = entries.findIndex(entry => entry.scriptId === scriptKey);
        const element = feedLayout.listRef.current?.element;
        if (index < 0 || element == null) return;
        const [cardTop, bottom] = feedLayout.getEntrySpan(index);
        // The first script also shows the space above the feed, the add button above the script sits in it
        let top = index === 0 ? 0 : cardTop;
        const viewportHeight = element.clientHeight;
        if (target === 'result' && bottom - cardTop > viewportHeight) {
            const item = element.querySelector(`[data-script-key="${scriptKey}"]`);
            const result = item?.querySelector('[data-feed-result]');
            if (item != null && result != null) {
                top = cardTop + result.getBoundingClientRect().top - item.getBoundingClientRect().top;
            }
        }
        const offset = revealScrollOffset(top, bottom, element.scrollTop, viewportHeight);
        if (offset != null) element.scrollTo({ top: offset });
    }, [entries, feedLayout.listRef, feedLayout.getEntrySpan]);

    // The feed follows the agent to the scripts it edits and runs in a question of the composer, also while the
    // agent still works. The followed script stays in view as it is measured and its results arrive.
    // Following stops once the user scrolls, clicks or types in the feed, the user does not want to be yanked around.
    const followAgentRef = React.useRef(false);
    const followedRef = React.useRef<{ scriptKey: number; target: AgentFollowTarget } | null>(null);
    const stopFollowingAgent = React.useCallback(() => {
        followAgentRef.current = false;
        followedRef.current = null;
    }, []);
    const [followRequest, setFollowRequest] = React.useState(0);
    const followAgentScript = React.useCallback((scriptKey: number, target: AgentFollowTarget) => {
        if (!followAgentRef.current) return;
        followedRef.current = { scriptKey, target };
        setFollowRequest(n => n + 1);
    }, []);
    React.useEffect(() => {
        const followed = followedRef.current;
        if (followed == null) return;
        revealScript(followed.scriptKey, followed.target);
        // A row that the scroll mounts can show its results in the next frame
        const frame = requestAnimationFrame(() => {
            if (followedRef.current === followed) revealScript(followed.scriptKey, followed.target);
        });
        return () => cancelAnimationFrame(frame);
    }, [revealScript, followRequest, feedLayout.rowHeightsVersion]);

    // A requested script stays in view like a followed one, until the user scrolls, clicks or types in the feed.
    // The request waits until the feed shows the session of the script.
    const revealedRef = React.useRef<SessionFeedRevealRequest | null>(null);
    const revealRequest = props.revealRequest ?? null;
    React.useEffect(() => {
        if (revealRequest == null || revealRequest === revealedRef.current || !props.active) return;
        if (revealRequest.sessionId !== props.sessionScripts.sessionId) return;
        const scriptKey = props.sessionScripts.scriptRefs[revealRequest.fileName]?.scriptId;
        if (scriptKey == null) return;
        revealedRef.current = revealRequest;
        followAgentRef.current = false;
        followedRef.current = { scriptKey, target: 'script' };
        setFollowRequest(n => n + 1);
    }, [revealRequest, props.active, props.sessionScripts.sessionId, props.sessionScripts.scriptRefs]);

    const handleCreate = React.useCallback((index: number) => {
        const result = props.modifySessionScripts({ type: CREATE_SCRIPT, value: { index } });
        if (!result) return;
        void result.then(next => {
            if (next == null) return;
            const created = getSelectedScriptRef(next);
            if (created == null) return;
            // The created script stays in view like a followed one, until the user scrolls, clicks or types in the feed
            followAgentRef.current = false;
            followedRef.current = { scriptKey: created.scriptId, target: 'script' };
            setFollowRequest(n => n + 1);
            const view = editorViewsRef.current.get(created.scriptId);
            if (view != null) {
                view.focus();
            } else {
                pendingCreatedScriptKeyRef.current = created.scriptId;
            }
        });
    }, [props.modifySessionScripts]);

    // The agent answers a question in the scripts of the session
    const agent = dependencies.useAgentBridge();
    const handleShowAgentScript = React.useCallback((scriptKey: number) => {
        const scriptData = latest.current.sessionScripts.scripts[scriptKey];
        if (scriptData == null) return;
        handleFocus(scriptData.fileName);
        revealScript(scriptKey, 'script');
    }, [handleFocus, revealScript]);
    const composerAgent = useComposerAgent({
        agent,
        sessionScripts: props.sessionScripts,
        runScript: runAppendedScript,
        followScript: followAgentScript,
        showScript: handleShowAgentScript,
    });

    const handleComposerSend = React.useCallback((text: string, mode: ComposerInputMode) => {
        if (mode === ComposerInputMode.Ai) {
            followAgentRef.current = true;
            void composerAgent.ask(text);
            return;
        }
        // The appended script takes over the feed
        stopFollowingAgent();
        logger.debug('Running the composer draft as SQL', { characters: String(text.length) }, LOG_CTX);
        void appendScript(text).then(appended => {
            if (appended != null) runAppendedScript(appended.next, appended.scriptData);
        });
    }, [composerAgent.ask, appendScript, runAppendedScript, stopFollowingAgent, logger]);
    React.useEffect(() => {
        if (!pendingScrollToEndRef.current || entries.length === 0) return;
        pendingScrollToEndRef.current = false;
        feedLayout.listRef.current?.scrollToRow({ index: entries.length - 1, align: 'end' });
    }, [entries.length]);

    // The checked script references of every script, the check runs again only when a script changes
    const scriptReferences = React.useMemo(() => checkSessionScriptReferences(props.sessionScripts), [props.sessionScripts]);
    const rowProps = React.useMemo<ScriptFeedRowProps>(() => ({
        sessionId: props.sessionScripts.sessionId,
        scriptReferences,
        connections: scriptConnections,
        computeCacheKey,
        lookupCachedResult,
        entries,
        storageReader: storageReader,
        scripts: props.sessionScripts.scripts,
        scriptDebugMode,
        formattingDebugMode,
        keywordCase,
        focusedFileName: props.sessionScripts.scriptFocus.fileName,
        active: props.active,
        onFocus: handleFocus,
        onDelete: handleDelete,
        onRename: handleRename,
        onPickConnection: pickScriptConnection,
        onMoveUp: handleMoveUp,
        onMoveDown: handleMoveDown,
        onExecute: handleExecuteEntry,
        onRerun: handleRerunEntry,
        onFormat: handleFormat,
        onApplySnippet: handleApplySnippet,
        onSetVisSpec: handleSetVisSpec,
        canTarget: true,
        onTarget: handleTargetScript,
        onAcceptDiff: handleAcceptDiff,
        onRejectDiff: handleRejectDiff,
        collapsedResults,
        onToggleResultExpanded: handleToggleResultExpanded,
        onAutoCollapseResult: handleAutoCollapseResult,
        onResetAutoCollapsedResult: handleResetAutoCollapsedResult,
        onCreate: handleCreate,
        onEditorView: handleEditorView,
        onRowHeightChange: feedLayout.rowHeights.setRowHeight,
    }), [entries, scriptReferences, props.active, scriptConnections, props.sessionScripts.scripts, props.sessionScripts.scriptFocus.fileName, computeCacheKey, lookupCachedResult, scriptDebugMode, formattingDebugMode, keywordCase, handleFocus, handleDelete, handleRename, pickScriptConnection, handleMoveUp, handleMoveDown, handleExecuteEntry, handleRerunEntry, handleFormat, handleApplySnippet, handleSetVisSpec, handleTargetScript, handleAcceptDiff, handleRejectDiff, collapsedResults, handleToggleResultExpanded, handleAutoCollapseResult, handleResetAutoCollapsedResult, handleCreate, handleEditorView, feedLayout.rowHeights.setRowHeight]);

    const getScrollElement = React.useCallback(() => feedLayout.listRef.current?.element ?? null, [feedLayout.listRef]);

    // An empty session greets the user with the composer in place of the feed.
    // The composer stays at the same position in the tree so it keeps focus when the first script lands.
    const landing = entries.length === 0;
    // The draft and the agent turns grow the composer, the greeting stays hidden while either is shown.
    // Sending clears the draft before the agent writes the first script, the turn keeps the greeting away.
    const greetingHidden = !composerDraftEmpty || (composerAgent.agent?.turns.length ?? 0) > 0;
    return (
        <div
            className={styles.feed_body_container}
            data-landing={landing ? '' : undefined}
            style={{ '--feed-scrollbar-inset': `${feedLayout.listScrollbarInset}px` } as React.CSSProperties}
        >
            {/* The inputs and the attachments sit on a bar above the feed */}
            <SessionInputStrip
                className={styles.feed_top_strip}
                sessionScripts={props.sessionScripts}
                modifySessionScripts={props.modifySessionScripts}
                leading={attachmentsVisible ? (
                    <button type="button" className={styles.feed_data_chip}
                        aria-expanded={attachmentsExpanded}
                        aria-controls="session-attachments"
                        onClick={() => setAttachmentsExpanded(expanded => !expanded)}>
                        Attached Files
                        <span className={styles.feed_data_count}>{pinnedDataFiles.length}</span>
                        {attachmentsExpanded ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
                    </button>
                ) : undefined}
                below={attachmentsVisible && (attachmentsExpanded || attachmentError != null) ? (
                    <section className={styles.feed_data_section} aria-label="Session attachments">
                        <input ref={attachmentInputRef} className={styles.feed_data_input} type="file" multiple accept={ATTACHMENT_EXTENSION}
                            onChange={handleAttachmentInput} aria-label="Add session attachments" disabled={!attachmentsEnabled} />
                        {attachmentsExpanded && (
                            <div id="session-attachments" className={styles.feed_data_drawer}
                                onDragOver={event => event.preventDefault()} onDrop={handleAttachmentDrop}>
                                <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Small}
                                    aria-label="Add session attachments" disabled={!attachmentsEnabled}
                                    onClick={event => {
                                        event.stopPropagation();
                                        attachmentInputRef.current?.click();
                                    }}>
                                    <PlusIcon size={16} />
                                </IconButton>
                                <div className={styles.feed_data_cards}>
                                    {pinnedDataFiles.map(file => (
                                        <SessionDataCard key={`${sessionId}/${file.name}`} sessionId={sessionId}
                                            file={file} conn={props.conn} storageReader={storageReader} onRemoved={refreshDataFiles}
                                            onMention={handleMentionAttachment}
                                            onRename={name => handleRenameAttachment(file.name, name)}
                                            collides={scriptNames.some(name => name.toLowerCase() === attachmentParameterName(file.name)?.toLowerCase())} />
                                    ))}
                                    {pinnedDataFiles.length === 0 && <div className={styles.feed_data_empty}>Drop files here or add attachments.</div>}
                                </div>
                            </div>
                        )}
                        {attachmentError != null && <div className={styles.feed_data_error} role="alert">{attachmentError}</div>}
                    </section>
                ) : undefined}
            />
            {landing && (
                <div className={styles.feed_landing_header} data-hidden={greetingHidden ? '' : undefined}>
                    <AgentFace className={styles.feed_landing_face} data-testid="feed-landing-face" label="DashQL agent" paused={greetingHidden} />
                </div>
            )}
            {/* Hidden rather than unmounted on the landing view, the size observer binds to the element once */}
            <div className={styles.feed_list_container} ref={feedLayout.listContainerRef} hidden={landing} data-testid="feed-list"
                onWheel={stopFollowingAgent} onTouchMove={stopFollowingAgent} onPointerDown={stopFollowingAgent} onKeyDown={stopFollowingAgent}>
                <DndContext
                    sensors={dndSensors}
                    collisionDetection={closestCenter}
                    modifiers={[restrictToVerticalAxis]}
                    onDragEnd={handleDragEnd}
                >
                    <SortableContext items={entries.map(entry => entry.scriptId)} strategy={verticalListSortingStrategy}>
                        <List
                            key={props.sessionScripts.sessionId}
                            listRef={feedLayout.listRef}
                            style={{
                                width: feedLayout.listWidth,
                                height: feedLayout.listHeight,
                                overflowX: 'hidden',
                                scrollbarGutter: 'stable',
                                '--feed-scrollbar-inset': `${feedLayout.listScrollbarInset}px`,
                                '--feed-gap': `${FEED_GAP}px`,
                            } as React.CSSProperties}
                            rowCount={entries.length}
                            overscanCount={OVERSCAN_ROW_COUNT}
                            rowHeight={feedLayout.rowHeights}
                            rowKey={feedRowKey}
                            rowComponent={dependencies.ScriptFeedRow}
                            rowProps={rowProps}
                        />
                    </SortableContext>
                </DndContext>
                {props.active && (
                    <VerticalScrollShadows
                        getScrollElement={getScrollElement}
                        prominent
                        refreshKey={`${props.sessionScripts.sessionId}:${entries.length}:${feedLayout.rowHeightsVersion}`}
                    />
                )}
            </div>
            <div className={styles.feed_composer_section}>
                <div className={styles.feed_composer_body}>
                    {composerConnection != null && <dependencies.SessionComposer
                        key={props.sessionScripts.sessionId}
                        instance={props.sessionScripts.instance}
                        catalog={composerConnection.catalog}
                        variant={landing ? SessionComposerVariant.Hero : SessionComposerVariant.Docked}
                        keywordCase={keywordCase}
                        aiAvailable={composerAgent.available}
                        agent={composerAgent.agent}
                        onSend={handleComposerSend}
                        onDraftEmptyChange={setComposerDraftEmpty}
                        setView={setComposerView}
                        submitRef={composerSubmitRef}
                        scriptNames={scriptNames}
                        targetScriptRef={composerTargetScriptRef}
                        renameScriptRef={composerRenameScriptRef}
                        tableParameters={sessionTableParameters(props.sessionScripts)}
                        snippetConnector={composerConnection.connectorInfo.connectorType}
                        offlineSessionId={scriptConnections.get(composerConnection.connectionId)?.connectionHealth === ConnectionHealth.ONLINE
                            ? null : props.sessionScripts.sessionId}
                        connectionPicker={(
                            <ScriptConnectionPicker
                                sessionId={props.sessionScripts.sessionId}
                                scriptName="new"
                                connection={scriptConnections.get(composerConnection.connectionId) ?? null}
                                disabled={false}
                                onPick={pickPendingConnection}
                                onAttach={attachPendingConnection}
                                testId="composer-connection-picker"
                            />
                        )}
                    />}
                </div>
            </div>
        </div>
    );
};
