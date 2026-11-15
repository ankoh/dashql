import * as React from 'react';
import type * as dashql from '@ankoh/dashql-core';
import * as styles from './workbook_feed.module.css';


import type { EditorView } from '@codemirror/view';
import { useAppConfig } from '../../config/app_config.js';
import { AgentGreeting } from '../../agent/agent_greeting.js';
import type { WobbleTuning } from '../../agent/wobble.js';

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

import { ConnectionHealth, ConnectionState, connectionCachesQueryResults } from '@ankoh/dashql-runtime/connections/connection_state';
import { useWorkbookReadOnly } from '../workbook_read_only.js';
import { deleteScript, useScriptSelection, useSelectedScriptRef } from '../scripts/script_selection.js';
import { getScriptRefs, newScriptConnection, type ModifyWorkbookScripts, type ScriptData, type WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import { createScriptAction, selectCreatedScript, useLiveScriptReader, useLiveWorkbookReader } from '../scripts/script_creation.js';
import { useWorkbookDerived, useWorkbookScriptMap } from '../scripts/workbook_scripts_registry.js';
import { useScriptResultKey, useScriptRun } from '../scripts/use_workbook_execution.js';
import { useOptionalCoreRuntime } from '../../runtime/runtime_hooks.js';
import { ConnectorType } from '@ankoh/dashql-runtime/connections/connector_info';
import { markWorkbookAttachmentsChanged } from '@ankoh/dashql-runtime/workbook/attachments/attachment_mounts';
import { renameAttachment } from '@ankoh/dashql-runtime/workbook/attachments/attachment_rename';
import { attachmentParameterName, readWorkbookAttachments, sameWorkbookAttachments, uniqueAttachmentFileName } from '@ankoh/dashql-runtime/workbook/attachments/workbook_attachments';
import { scriptDisplayName } from '@ankoh/dashql-runtime/workbook/scripts/script_types';
import { insertMentionAtCursor, useLastFocusedEditor } from '../editor/editor_focus.js';
import { DashQLProcessorPlugin } from '../editor/dashql_processor.js';
import { renameScript, type RenameDraftReferences } from '@ankoh/dashql-runtime/workbook/scripts/script_rename';
import { type KeyEventHandler, useKeyEvents } from '../../utils/key_events.js';
import { useStorageReader, useStorageWriter } from '../../storage/storage_provider.js';
import { useQueryResultCache } from '../../storage/query_result_cache_provider.js';
import { groupWorkbookAttachmentListWrites } from '@ankoh/dashql-runtime/storage/runtime_storage';
import { quoteIdentifier as quoteSqlIdentifier } from '@ankoh/dashql-runtime/utils/sql_quote';
import type { WorkbookTableParameters } from './workbook_composer.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { FEED_GAP, revealScrollOffset, useWorkbookFeedLayout } from './workbook_feed_layout.js';
import { ScriptFeedRow, type ScriptFeedRowProps } from './workbook_feed_row.js';
import { getKeywordCase } from '@ankoh/dashql-runtime/workbook/scripts/script_format';
import { reorderFeedEntries } from './workbook_feed_drag.js';
import { ATTACHMENT_EXTENSION, isAttachmentFileName, type DataFile } from '@ankoh/dashql-runtime/storage/storage_backend';
import { stringifyError } from '@ankoh/dashql-runtime/platform/logger/logger';
import { WorkbookDataCard } from './workbook_data_card.js';
import { WorkbookInputStrip } from '../inputs/workbook_input_strip.js';
import { VerticalScrollShadows } from '../../ui/foundations/vertical_scroll_shadows.js';
import { observeSize } from '../../ui/foundations/size_observer.js';
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
import { connectionReadsAttachments } from '@ankoh/dashql-runtime/connections/connector_descriptor';
import { WorkbookConnectionAttentionContext } from '../workbook_connection_attention.js';
import { WorkbookComposer, WorkbookComposerVariant } from './workbook_composer.js';
import { isAgentWorking, type AgentFollowTarget } from '../../agent/agent_session.js';
import { useAgentConnect, useAgentSession } from '../../agent/agent_session_provider.js';
import { agentLiveStatuses, diffAgentQuestions } from '../../agent/agent_workbook_status.js';
import { WorkbookStatusBar, WorkbookStatusBarVariant } from '../status/workbook_status_bar.js';
import { useLiveWorkbookStatuses, useReportWorkbookOutcomes, useWorkbookOutcomeTransitions } from '../status/workbook_status_store.js';
import { useWorkbookStatusSources } from '../status/use_workbook_status_sources.js';
import { WorkbookStatusSource, WorkbookStatusTone, type WorkbookStatus } from '../status/workbook_status.js';
import { useWorkbookExecution } from '../scripts/use_workbook_execution.js';
import { useCloudPublishStatus } from '../../cloud/cloud_publish_status.js';
import { quoteIdentifier } from '@ankoh/dashql-runtime/utils/sql_quote';

export interface WorkbookFeedProps {
    workbookScripts: WorkbookScripts;
    modifyWorkbookScripts: ModifyWorkbookScripts;
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
    revealRequest?: WorkbookFeedRevealRequest | null;
    dependencies?: WorkbookFeedDependencies;
}

/// A script that the feed scrolls into view once its workbook shows
export interface WorkbookFeedRevealRequest {
    workbookId: string;
    fileName: string;
}

export interface WorkbookFeedDependencies {
    useStorageReader: typeof useStorageReader;
    useStorageWriter: typeof useStorageWriter;
    usePickScriptConnection: typeof usePickScriptConnection;
    usePickPendingConnection: typeof usePickPendingConnection;
    useAttachPendingConnection: typeof useAttachPendingConnection;
    useKeyEvents: typeof useKeyEvents;
    useScriptRun: typeof useScriptRun;
    useScriptResultKey: typeof useScriptResultKey;
    useWorkbookScriptMap: typeof useWorkbookScriptMap;
    useWorkbookDerived: typeof useWorkbookDerived;
    useLiveWorkbookReader: typeof useLiveWorkbookReader;
    useLiveScriptReader: typeof useLiveScriptReader;
    useComposerCore: typeof useComposerCore;
    useAgentSession: typeof useAgentSession;
    useAgentConnect: typeof useAgentConnect;
    WorkbookComposer: typeof WorkbookComposer;
    WorkbookStatusBar: typeof WorkbookStatusBar;
    ScriptFeedRow: typeof ScriptFeedRow;
}

const DEFAULT_DEPENDENCIES: WorkbookFeedDependencies = {
    useStorageReader,
    useStorageWriter,
    usePickScriptConnection,
    usePickPendingConnection,
    useAttachPendingConnection,
    useKeyEvents,
    useScriptRun,
    useScriptResultKey,
    useWorkbookScriptMap,
    useWorkbookDerived,
    useLiveWorkbookReader,
    useLiveScriptReader,
    useComposerCore,
    useAgentSession,
    useAgentConnect,
    WorkbookComposer,
    WorkbookStatusBar,
    ScriptFeedRow,
};

const LOG_CTX = 'workbook_feed';
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

/// What the composer drafts with: the core, the catalog of the connection of the next script, the table parameters of
/// the workbook and the connector of the connection. Null until the runtime has its core.
export interface ComposerCore {
    instance: dashql.DashQL;
    catalog: dashql.DashQLCatalog;
    tableParameters: WorkbookTableParameters;
    connectorType: ConnectorType | null;
}

/// The core of the composer of a workbook on the connection of its next script
export function useComposerCore(workbookId: string, connectionId: string | null): ComposerCore | null {
    const runtime = useOptionalCoreRuntime();
    const instance = runtime?.core ?? null;
    return React.useMemo(() => {
        if (runtime == null || instance == null || connectionId == null) return null;
        const catalog = runtime.catalog(connectionId);
        if (catalog == null) return null;
        return {
            instance,
            catalog,
            tableParameters: { attach: session => runtime.attachTableParameters(workbookId, session) },
            connectorType: runtime.connection(connectionId)?.connectorType as ConnectorType | undefined ?? null,
        };
    }, [runtime, instance, workbookId, connectionId]);
}

/// Wobble moves more and faster on the empty workbook than by default, it is the only thing moving on the page
const LANDING_WOBBLE_TUNING: Partial<WobbleTuning> = { wobble: 0.03, wobbleSpeed: 2 };

export const WorkbookFeed: React.FC<WorkbookFeedProps> = (props) => {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const config = useAppConfig();
    const logger = useLogger();
    const scriptDebugMode = config?.settings?.scriptDebugMode ?? false;
    const formattingDebugMode = config?.settings?.formattingDebugMode ?? false;
    const attachmentsVisible = config?.settings?.experimental_file_attachments === true;
    const keywordCase = getKeywordCase(config?.settings);
    const scriptRefs = props.workbookScripts.scriptRefs;
    const scriptOrder = props.workbookScripts.scriptOrder;
    // The scripts of the workbook, every keystroke changes one of them
    const scripts = dependencies.useWorkbookScriptMap(props.workbookScripts.workbookId);
    const scriptsRef = React.useRef(scripts);
    scriptsRef.current = scripts;
    // The estimated heights only matter until a row is measured.
    // Don't re-estimate (and copy the text of every script) whenever any script changes.
    const canonicalEntries = React.useMemo(
        () => getScriptRefs(props.workbookScripts).map(entry => ({
            ...entry,
            estimatedHeight: estimateFeedEntryHeight(
                scriptsRef.current[entry.scriptId]?.scriptSession.getText() ?? '',
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
    const composerConnectionId = newScriptConnection(props.workbookScripts, null);
    const composerCore = dependencies.useComposerCore(props.workbookScripts.workbookId, composerConnectionId);
    const storageReader = dependencies.useStorageReader();
    const queryResultCache = useQueryResultCache();
    const storageWriter = dependencies.useStorageWriter();
    const workbookId = props.workbookScripts.workbookId;
    const [dataFiles, setDataFiles] = React.useState<{ workbookId: string; files: DataFile[] } | null>(null);
    const [dataFilesVersion, setDataFilesVersion] = React.useState(0);
    const [attachmentsExpanded, setAttachmentsExpanded] = React.useState(false);
    const [attachmentError, setAttachmentError] = React.useState<string | null>(null);
    const attachmentInputRef = React.useRef<HTMLInputElement>(null);
    const latestAttachments = React.useRef(props.workbookScripts.attachments);
    latestAttachments.current = props.workbookScripts.attachments;
    const latestScriptOrder = React.useRef(props.workbookScripts.scriptOrder);
    latestScriptOrder.current = props.workbookScripts.scriptOrder;
    // The workbook file lists the attachments, a changed attachment updates the list and the mount of the attachments
    const refreshDataFiles = React.useCallback(() => {
        markWorkbookAttachmentsChanged(workbookId);
        setDataFilesVersion(version => version + 1);
        void storageWriter.write(groupWorkbookAttachmentListWrites(workbookId), { type: 'refreshWorkbookAttachments', workbookId });
    }, [workbookId, storageWriter]);
    React.useEffect(() => {
        const cancel = new AbortController();
        storageReader.backend.listDataFiles(workbookId).then(files => {
            if (!cancel.signal.aborted) {
                // The scripts read the Parquet attachments as table parameters
                const known = latestAttachments.current ?? [];
                if (!sameWorkbookAttachments(known, readWorkbookAttachments(files, known))) {
                    props.modifyWorkbookScripts({ kind: 'setWorkbookAttachments', value: { files: files.map(file => ({ name: file.name, sizeBytes: file.sizeBytes, mtimeMs: file.mtimeMs })) } });
                }
                setDataFiles({
                    workbookId, files: [...files].sort((a, b) => (
                        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
                    ))
                });
            }
        }).catch(e => {
            if (!cancel.signal.aborted) {
                logger.error('Listing workbook data files failed', { error: stringifyError(e) }, LOG_CTX);
            }
        });
        return () => cancel.abort();
    }, [workbookId, storageReader.backend, dataFilesVersion, logger, props.modifyWorkbookScripts]);
    const pinnedDataFiles = dataFiles?.workbookId === workbookId ? dataFiles.files : [];
    // A read-only workbook adds no scripts and no attachments
    const readOnly = useWorkbookReadOnly();
    const attachmentsEnabled = !readOnly && connectionReadsAttachments(props.conn);
    // The files that are being attached, the status of the workbook tells them
    const [attaching, setAttaching] = React.useState<{ workbookId: string; files: number } | null>(null);
    const reportOutcomes = useReportWorkbookOutcomes();
    const saveAttachments = React.useCallback(async (files: Iterable<File>) => {
        setAttachmentError(null);
        const logFiles = (tone: WorkbookStatusTone, text: string, detail: string | null = null) => reportOutcomes(workbookId, [{
            key: `files:${text}:${Date.now()}`, source: WorkbookStatusSource.Files, tone, text, detail, at: Date.now(),
        }]);
        // A workbook attaches Parquet files only, they are table parameters of the scripts
        const parquet = [...files].filter(file => isAttachmentFileName(file.name));
        const refused = [...files].filter(file => !isAttachmentFileName(file.name));
        if (refused.length > 0) {
            setAttachmentError(`Only Parquet files can be attached: ${refused.map(file => file.name).join(', ')}`);
            logFiles(WorkbookStatusTone.Failed, 'Only Parquet files can be attached', refused.map(file => file.name).join(', '));
        }
        if (parquet.length === 0) return;
        setAttaching({ workbookId, files: parquet.length });
        try {
            // An attachment takes no name of a script or another attachment
            const scriptNames = latestScriptOrder.current.map(scriptDisplayName);
            const attachments = [...(latestAttachments.current ?? [])];
            for (const file of parquet) {
                const fileName = uniqueAttachmentFileName(file.name, scriptNames, attachments);
                await storageReader.backend.saveDataFile(workbookId, fileName, file);
                attachments.push(...readWorkbookAttachments([{ name: fileName, sizeBytes: file.size }]));
                logFiles(WorkbookStatusTone.Success, `Attached ${fileName}`);
            }
            refreshDataFiles();
        } catch (e) {
            setAttachmentError('Adding attachment failed');
            // The outcome is the record of the log
            logFiles(WorkbookStatusTone.Failed, 'Adding an attachment failed', stringifyError(e));
        } finally {
            setAttaching(null);
        }
    }, [logger, workbookId, refreshDataFiles, storageReader.backend, reportOutcomes]);
    const attachingFiles = attaching?.workbookId === workbookId ? attaching.files : 0;
    const filesLive = React.useMemo<WorkbookStatus[]>(() => attachingFiles === 0 ? [] : [{
        key: 'files:attaching', source: WorkbookStatusSource.Files, tone: WorkbookStatusTone.Progress,
        text: attachingFiles === 1 ? 'Attaching a file' : `Attaching ${attachingFiles} files`, at: Date.now(),
    }], [attachingFiles]);
    useLiveWorkbookStatuses(workbookId, 'files', filesLive);

    // The runs, the connections and the publishes of the workbook tell its status, the bars of Wobble show it in
    // every view. The feed stays mounted while the other views show.
    const execution = useWorkbookExecution(workbookId);
    const publishStatus = useCloudPublishStatus(workbookId);
    const statusLabeler = useConnectionLabeler();
    useWorkbookStatusSources({
        workbookScripts: props.workbookScripts,
        scripts,
        connections: props.scriptConnections ?? defaultConnections,
        label: statusLabeler,
        execution: execution.state,
        publish: publishStatus,
    });
    const handleAttachmentInput = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        if (attachmentsEnabled && event.target.files != null) void saveAttachments(Array.from(event.target.files));
        event.target.value = '';
    }, [saveAttachments]);
    const handleAttachmentDrop = React.useCallback((event: React.DragEvent<HTMLElement>) => {
        event.preventDefault();
        if (props.active && attachmentsEnabled) void saveAttachments(Array.from(event.dataTransfer.files));
    }, [attachmentsEnabled, props.active, saveAttachments]);

    // The workbook scripts change with every keystroke and the connection with every query event.
    // Callbacks read the latest values through a ref to stay stable for the memoized feed rows.
    const latest = React.useRef({ workbookScripts: props.workbookScripts, scripts, scriptConnections });
    latest.current = { workbookScripts: props.workbookScripts, scripts, scriptConnections };
    const pickScriptConnection = dependencies.usePickScriptConnection(props.workbookScripts.workbookId, props.modifyWorkbookScripts);
    // New scripts, and the draft of the composer, use the default connection of the workbook
    const pickPendingConnection = dependencies.usePickPendingConnection(props.modifyWorkbookScripts);
    const attachPendingConnection = dependencies.useAttachPendingConnection(props.modifyWorkbookScripts);

    const pendingCreatedScriptKeyRef = React.useRef<number | null>(null);
    const editorViewsRef = React.useRef(new Map<number, EditorView>());
    // Presence means collapsed. A query id marks an automatic no-result collapse; null marks a
    // manual collapse, which must not be reset when a later query starts.
    const [collapsedResults, setCollapsedResults] = React.useState<ReadonlyMap<number, number | null>>(() => new Map());

    const selection = useScriptSelection();
    const selectedFileName = useSelectedScriptRef(props.workbookScripts)?.fileName ?? '';
    const handleFocus = React.useCallback((fileName: string) => {
        selection.selectFile(latest.current.workbookScripts, fileName);
    }, [selection]);

    // A script runs while its own connection is online
    const isScriptOnline = (scriptData: ScriptData) =>
        latest.current.scriptConnections.get(scriptData.connectionId)?.connectionHealth === ConnectionHealth.ONLINE;
    const runScript = dependencies.useScriptRun();
    const resultKey = dependencies.useScriptResultKey();

    // Refresh: run the script and the scripts it references without reading cached results, their results become the
    // newest files of their keys. Resolves the script by feed file name.
    const handleRerunEntry = React.useCallback((fileName: string) => {
        const { workbookScripts, scripts } = latest.current;
        const entry = workbookScripts.scriptRefs[fileName];
        const scriptData = entry != null ? scripts[entry.scriptId] : undefined;
        if (scriptData == null || runScript == null || !isScriptOnline(scriptData)) {
            return;
        }
        void runScript(workbookScripts.workbookId, scriptData.scriptKey, { refresh: true });
    }, [runScript]);

    // The cache indicator of a script looks up the key of a run of the script in the cache of the app
    const lookupCachedResult = React.useCallback(async (cacheKey: string) => (await queryResultCache?.lookup(cacheKey))?.cachedAtMs ?? null, [queryResultCache]);

    // The cache key of a run of a script, the cache indicator of the script checks it. A new callback when connections
    // start or stop caching, so the indicators check again.
    const computeCacheKey = React.useCallback(async (scriptKey: number) => {
        const { workbookScripts, scripts } = latest.current;
        const scriptData = scripts[scriptKey];
        if (scriptData == null || resultKey == null) return null;
        return await resultKey(workbookScripts.workbookId, scriptKey);
    }, [cachingConnections, resultKey]);

    const handleExecuteEntry = React.useCallback((fileName: string) => {
        const { workbookScripts, scripts } = latest.current;
        const entry = workbookScripts.scriptRefs[fileName];
        const scriptData = entry != null ? scripts[entry.scriptId] : undefined;
        if (scriptData == null || runScript == null || !isScriptOnline(scriptData)) return;
        void runScript(workbookScripts.workbookId, scriptData.scriptKey);
    }, [runScript]);

    const handleDelete = React.useCallback((fileName: string) => {
        deleteScript(selection, latest.current.workbookScripts, props.modifyWorkbookScripts, fileName);
    }, [props.modifyWorkbookScripts, selection]);

    // A rename rewrites the references in the other scripts and in the draft of the composer
    const ownDraftRenameRef = React.useRef<RenameDraftReferences | null>(null);
    const composerRenameScriptRef = props.draftRenameRef ?? ownDraftRenameRef;
    const readScript = dependencies.useLiveScriptReader();
    const handleRename = React.useCallback((oldFileName: string, newFileName: string) => {
        renameScript(props.workbookScripts, props.modifyWorkbookScripts, oldFileName, newFileName, composerRenameScriptRef.current,
            key => readScript(key)?.fileName ?? null);
    }, [props.workbookScripts, props.modifyWorkbookScripts, composerRenameScriptRef, readScript]);

    // Move a script one position up/down within the workbook by swapping it with its neighbour in the
    // feed order and dispatching the new full order.
    const moveScript = React.useCallback((fileName: string, delta: number) => {
        const order = [...latest.current.workbookScripts.scriptOrder];
        const from = order.indexOf(fileName);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= order.length) return;
        [order[from], order[to]] = [order[to], order[from]];
        props.modifyWorkbookScripts({ kind: 'reorderScripts', value: { order } });
    }, [props.modifyWorkbookScripts]);
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
        // Keep the dropped order visible while the reorder updates the order of the workbook.
        // Stable script ids let React and dnd-kit retain card identity without forcing a render while
        // dnd-kit still has the active drag transform applied.
        setDisplayEntries({ source: canonicalEntries, entries: reordered });
        props.modifyWorkbookScripts({ kind: 'reorderScripts', value: { order: reordered.map(entry => entry.fileName) } });
    }, [entries, props.modifyWorkbookScripts, canonicalEntries]);

    const handleFormat = React.useCallback((scriptKey: number, text: string) => {
        props.modifyWorkbookScripts({ kind: 'setScriptText', value: { scriptKey, text, withDiff: true } });
    }, [props.modifyWorkbookScripts]);

    // A snippet replaces the text of a script, a script with text shows the replacement as a diff to accept or reject
    const handleApplySnippet = React.useCallback((scriptKey: number, text: string) => {
        const priorText = latest.current.scripts[scriptKey]?.scriptSession.getText() ?? '';
        props.modifyWorkbookScripts({ kind: 'setScriptText', value: { scriptKey, text, withDiff: priorText.trim().length > 0 } });
    }, [props.modifyWorkbookScripts]);

    // The chart builder of a card stages every edit of its spec for the `@vis vegalite` tag as a diff to accept or reject
    const handleSetVisSpec = React.useCallback((scriptKey: number, spec: string) => {
        props.modifyWorkbookScripts({ kind: 'setScriptVisSpec', value: { scriptKey, spec } });
    }, [props.modifyWorkbookScripts]);

    // Accept / reject a staged rewrite from the feed. Accept keeps the new text; reject restores the
    // prior text and re-analyzes.
    const handleAcceptDiff = React.useCallback((scriptKey: number) => {
        props.modifyWorkbookScripts({ kind: 'acceptPendingDiff', value: { scriptKey } });
    }, [props.modifyWorkbookScripts]);
    const handleRejectDiff = React.useCallback((scriptKey: number) => {
        props.modifyWorkbookScripts({ kind: 'rejectPendingDiff', value: { scriptKey } });
    }, [props.modifyWorkbookScripts]);
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
            const target = scriptKey != null ? latest.current.scripts[scriptKey] : undefined;
            if (target != null && target.fileName !== fileName) {
                insertMentionAtCursor(view, `:${composerCore?.instance.quoteIdentifier(name) ?? quoteSqlIdentifier(name)}`);
                return;
            }
        }
        composerTargetScriptRef.current?.(name);
    }, [lastFocusedEditor, composerView, composerCore]);
    const handleTargetScript = React.useCallback((fileName: string) => handleMention(scriptDisplayName(fileName), fileName), [handleMention]);
    const handleMentionAttachment = React.useCallback((name: string) => handleMention(name, null), [handleMention]);
    // An attachment renames like a script, the scripts and the draft that read it follow
    const handleRenameAttachment = React.useCallback((fileName: string, name: string) => {
        void renameAttachment(latest.current.workbookScripts, props.modifyWorkbookScripts, storageReader.backend, fileName, name, composerRenameScriptRef.current)
            .then(renamed => { if (renamed != null) refreshDataFiles(); })
            .catch(e => {
                setAttachmentError('Renaming attachment failed');
                logger.error('Renaming workbook attachment failed', { workbookId, error: stringifyError(e) }, LOG_CTX);
            });
    }, [props.modifyWorkbookScripts, storageReader.backend, composerRenameScriptRef, refreshDataFiles, logger]);
    const scriptNames = React.useMemo(() => props.workbookScripts.scriptOrder.map(scriptDisplayName), [props.workbookScripts.scriptOrder]);

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
                const workbookScripts = latest.current.workbookScripts;
                const focused = selection.selectedRef(workbookScripts);
                const focusedScript = focused != null ? latest.current.scripts[focused.scriptId] : null;
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
                const workbookScripts = latest.current.workbookScripts;
                const focused = selection.selectedRef(workbookScripts);
                const focusedScript = focused != null ? latest.current.scripts[focused.scriptId] : null;
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
    ], [feedActive, composerView, handleAcceptDiff, handleRejectDiff, selection]);
    dependencies.useKeyEvents(keyHandlers);

    // The docked prompt floats over the bottom of the feed, the last script scrolls clear of it
    const composerSectionRef = React.useRef<HTMLDivElement>(null);
    const composerSectionSize = observeSize(composerSectionRef);
    const bottomInset = entries.length === 0 ? 0 : Math.ceil(composerSectionSize?.height ?? 0);
    const feedLayout = useWorkbookFeedLayout(entries, bottomInset);

    const handleEditorView = React.useCallback((scriptKey: number, view: EditorView) => {
        editorViewsRef.current.set(scriptKey, view);
        if (pendingCreatedScriptKeyRef.current !== scriptKey) return;
        pendingCreatedScriptKeyRef.current = null;
        requestAnimationFrame(() => view.focus());
    }, []);

    // The composer appends its draft as a new script and runs it right away.
    // The composer keeps a SQL draft while its connection is not connected, a script that the agent writes
    // on a connection that is not connected is only created and the connection asks for attention.
    const connectionAttention = React.useContext(WorkbookConnectionAttentionContext);
    const pendingScrollToEndRef = React.useRef(false);
    const readWorkbook = dependencies.useLiveWorkbookReader();
    const appendScript = React.useCallback(async (text: string) => {
        const prev = latest.current.workbookScripts;
        const outcome = props.modifyWorkbookScripts(createScriptAction(prev, { text }));
        if (!outcome.ok) return null;
        pendingScrollToEndRef.current = true;
        const next = readWorkbook(prev.workbookId);
        const created = selectCreatedScript(selection, prev, next);
        if (next == null || created == null) return null;
        const scriptData = readScript(created.scriptId);
        return scriptData != null ? { next, scriptData } : null;
    }, [props.modifyWorkbookScripts, selection, readWorkbook, readScript]);
    const runAppendedScript = React.useCallback((next: WorkbookScripts, scriptData: ScriptData) => {
        // The agent may write the script on another connection than the one of the composer
        if (!isScriptOnline(scriptData)) {
            connectionAttention?.request(next.workbookId);
            return;
        }
        if (runScript == null) return;
        void runScript(next.workbookId, scriptData.scriptKey);
    }, [connectionAttention, runScript]);

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
        // The part of the feed that the prompt leaves free
        const viewportHeight = element.clientHeight - bottomInset;
        if (target === 'result' && bottom - cardTop > viewportHeight) {
            const item = element.querySelector(`[data-script-key="${scriptKey}"]`);
            const result = item?.querySelector('[data-feed-result]');
            if (item != null && result != null) {
                top = cardTop + result.getBoundingClientRect().top - item.getBoundingClientRect().top;
            }
        }
        const offset = revealScrollOffset(top, bottom, element.scrollTop, viewportHeight);
        if (offset != null) element.scrollTo({ top: offset });
    }, [entries, feedLayout.listRef, feedLayout.getEntrySpan, bottomInset]);

    // The feed follows the agent of a session to the scripts it edits and runs for a question, also while the agent
    // still works. The followed script stays in view as it is measured and its results arrive.
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
    // The request waits until the feed shows the workbook of the script.
    const revealedRef = React.useRef<WorkbookFeedRevealRequest | null>(null);
    const revealRequest = props.revealRequest ?? null;
    React.useEffect(() => {
        if (revealRequest == null || revealRequest === revealedRef.current || !props.active) return;
        if (revealRequest.workbookId !== props.workbookScripts.workbookId) return;
        const scriptKey = props.workbookScripts.scriptRefs[revealRequest.fileName]?.scriptId;
        if (scriptKey == null) return;
        revealedRef.current = revealRequest;
        followAgentRef.current = false;
        followedRef.current = { scriptKey, target: 'script' };
        setFollowRequest(n => n + 1);
    }, [revealRequest, props.active, props.workbookScripts.workbookId, props.workbookScripts.scriptRefs]);

    const handleCreate = React.useCallback((index: number) => {
        const prev = latest.current.workbookScripts;
        const outcome = props.modifyWorkbookScripts(createScriptAction(prev, { index }));
        if (!outcome.ok) return;
        const created = selectCreatedScript(selection, prev, readWorkbook(prev.workbookId));
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
    }, [props.modifyWorkbookScripts, selection, readWorkbook]);

    // The agent of a session in the terminal answers questions in the scripts of the workbook, the page watches
    const handleShowAgentScript = React.useCallback((scriptKey: number) => {
        const scriptData = latest.current.scripts[scriptKey];
        if (scriptData == null) return;
        handleFocus(scriptData.fileName);
        revealScript(scriptKey, 'script');
    }, [handleFocus, revealScript]);
    const session = dependencies.useAgentSession({
        workbookScripts: props.workbookScripts,
        followScript: followAgentScript,
        showScript: handleShowAgentScript,
    });
    const agentConnect = dependencies.useAgentConnect();
    // Every new question of the session follows the agent again
    const latestQuestionId = session != null && session.turns.length > 0 ? session.turns[session.turns.length - 1].questionId : null;
    React.useEffect(() => {
        if (latestQuestionId != null) followAgentRef.current = true;
    }, [latestQuestionId]);
    // The agent tells what it works on, its questions go to the log
    const agentLive = React.useMemo(() => agentLiveStatuses(session, Date.now()), [session]);
    useLiveWorkbookStatuses(workbookId, 'agent', agentLive);
    useWorkbookOutcomeTransitions(workbookId, session, (prev, next) => diffAgentQuestions(prev, next, Date.now()));

    const handleComposerSend = React.useCallback((text: string) => {
        // The appended script takes over the feed
        stopFollowingAgent();
        logger.debug('Running the composer draft', { characters: String(text.length) }, LOG_CTX);
        void appendScript(text).then(appended => {
            if (appended != null) runAppendedScript(appended.next, appended.scriptData);
        });
    }, [appendScript, runAppendedScript, stopFollowingAgent, logger]);
    React.useEffect(() => {
        if (!pendingScrollToEndRef.current || entries.length === 0) return;
        pendingScrollToEndRef.current = false;
        feedLayout.listRef.current?.scrollToRow({ index: entries.length - 1, align: 'end' });
    }, [entries.length]);

    // The checked script references of every script, the runtime checks them again when an analysis changes
    const scriptReferences = dependencies.useWorkbookDerived(workbookId)?.references;
    // The rows mount their editors once the list has a width. The list takes a width only after the size observer of
    // a container that was hidden reports, and a wrapped editor that measures at no width estimates the height of its
    // lines at a few characters per row, and gets no resize event to correct that.
    const rowsActive = props.active && feedLayout.listWidth > 0;
    const rowProps = React.useMemo<ScriptFeedRowProps>(() => ({
        workbookId: props.workbookScripts.workbookId,
        scriptReferences,
        connections: scriptConnections,
        computeCacheKey,
        lookupCachedResult,
        entries,
        storageReader: storageReader,
        scripts,
        scriptDebugMode,
        formattingDebugMode,
        keywordCase,
        focusedFileName: selectedFileName,
        active: rowsActive,
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
    }), [entries, scriptReferences, rowsActive, scriptConnections, scripts, selectedFileName, computeCacheKey, lookupCachedResult, scriptDebugMode, formattingDebugMode, keywordCase, handleFocus, handleDelete, handleRename, pickScriptConnection, handleMoveUp, handleMoveDown, handleExecuteEntry, handleRerunEntry, handleFormat, handleApplySnippet, handleSetVisSpec, handleTargetScript, handleAcceptDiff, handleRejectDiff, collapsedResults, handleToggleResultExpanded, handleAutoCollapseResult, handleResetAutoCollapsedResult, handleCreate, handleEditorView, feedLayout.rowHeights.setRowHeight]);

    const getScrollElement = React.useCallback(() => feedLayout.listRef.current?.element ?? null, [feedLayout.listRef]);
    // The composer drafts on the connection of the next script, against its catalog and the table parameters of the
    // workbook
    const composerConnectorType = (composerConnectionId == null ? null : scriptConnections.get(composerConnectionId)?.connectorInfo.connectorType)
        ?? composerCore?.connectorType ?? ConnectorType.HYPER;

    // An empty workbook greets the user with the composer in place of the feed, until the agent of a session works on a
    // question. The composer stays at the same position in the tree so it keeps focus when the view docks it.
    const agentTurns = session?.turns.length ?? 0;
    const landing = entries.length === 0 && agentTurns === 0;
    // While the user writes, Wobble watches the caret of the composer
    const composerCaret = React.useCallback(() => {
        const head = composerView?.state?.selection?.main.head;
        if (composerView == null || head == null || !composerView.hasFocus) return null;
        const coords = composerView.coordsAtPos(head);
        return coords == null ? null : { x: coords.left, y: (coords.top + coords.bottom) / 2 };
    }, [composerView]);
    // Wobble gets excited about every keystroke in the composer, a ref keeps the feed from rendering per key
    const lastComposerInput = React.useRef<number | null>(null);
    React.useEffect(() => {
        const dom = composerView?.contentDOM;
        if (dom == null || typeof dom.addEventListener !== 'function') return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter') {
                lastComposerInput.current = performance.now();
            }
        };
        dom.addEventListener('keydown', onKeyDown);
        return () => dom.removeEventListener('keydown', onKeyDown);
    }, [composerView]);
    const composerLastInput = React.useCallback(() => lastComposerInput.current, []);
    const landingWobble = React.useMemo(() => ({
        className: styles.feed_landing_wobble,
        'data-testid': 'feed-landing-wobble',
        label: 'DashQL agent',
        paused: !props.active,
        tuning: LANDING_WOBBLE_TUNING,
        gaze: { pointer: true, target: composerCaret },
        lastInput: composerLastInput,
    }), [props.active, composerCaret, composerLastInput]);
    const dockGaze = React.useMemo(() => ({ target: composerCaret }), [composerCaret]);

    // The bar of Wobble on the prompt: the status of the workbook, the agent and the log. On the landing view the
    // greeting is Wobble, the bar leaves it out. A read-only workbook has no prompt, the bar stands alone.
    const statusBar = (variant: WorkbookStatusBarVariant) => (
        <dependencies.WorkbookStatusBar
            workbookId={workbookId}
            variant={variant}
            session={readOnly ? null : session}
            wobble={!landing}
            gaze={dockGaze}
            lastInput={composerLastInput}
            paused={!props.active}
        />
    );
    return (
        <div
            className={styles.feed_body_container}
            data-landing={landing ? '' : undefined}
            style={{
                '--feed-scrollbar-inset': `${feedLayout.listScrollbarInset}px`,
                '--feed-bottom-inset': `${bottomInset}px`,
            } as React.CSSProperties}
        >
            {/* The inputs and the attachments sit on a bar above the feed */}
            <WorkbookInputStrip
                className={styles.feed_top_strip}
                workbookId={workbookId}
                modifyWorkbookScripts={props.modifyWorkbookScripts}
                leading={attachmentsVisible ? (
                    <button type="button" className={styles.feed_data_chip}
                        aria-expanded={attachmentsExpanded}
                        aria-controls="workbook-attachments"
                        onClick={() => setAttachmentsExpanded(expanded => !expanded)}>
                        Attached Files
                        <span className={styles.feed_data_count}>{pinnedDataFiles.length}</span>
                        {attachmentsExpanded ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
                    </button>
                ) : undefined}
                below={attachmentsVisible && (attachmentsExpanded || attachmentError != null) ? (
                    <section className={styles.feed_data_section} aria-label="Workbook attachments">
                        <input ref={attachmentInputRef} className={styles.feed_data_input} type="file" multiple accept={ATTACHMENT_EXTENSION}
                            onChange={handleAttachmentInput} aria-label="Add workbook attachments" disabled={!attachmentsEnabled} />
                        {attachmentsExpanded && (
                            <div id="workbook-attachments" className={styles.feed_data_drawer}
                                onDragOver={event => event.preventDefault()} onDrop={handleAttachmentDrop}>
                                {!readOnly && <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Small}
                                    aria-label="Add workbook attachments" disabled={!attachmentsEnabled}
                                    onClick={event => {
                                        event.stopPropagation();
                                        attachmentInputRef.current?.click();
                                    }}>
                                    <PlusIcon size={16} />
                                </IconButton>}
                                <div className={styles.feed_data_cards}>
                                    {pinnedDataFiles.map(file => (
                                        <WorkbookDataCard key={`${workbookId}/${file.name}`} workbookId={workbookId}
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
                <div className={styles.feed_landing_top}>
                    <div className={styles.feed_landing_header}>
                        <AgentGreeting
                            wobble={landingWobble}
                            questionClassName={styles.feed_landing_question}
                            questionTestId="feed-landing-question" />
                    </div>
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
                            key={props.workbookScripts.workbookId}
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
                        refreshKey={`${props.workbookScripts.workbookId}:${entries.length}:${feedLayout.rowHeightsVersion}`}
                    />
                )}
            </div>
            {readOnly && !landing && (
                <div className={styles.feed_composer_section} ref={composerSectionRef}>
                    <div className={styles.feed_composer_body}>{statusBar(WorkbookStatusBarVariant.Standalone)}</div>
                </div>
            )}
            {!readOnly && <div className={styles.feed_composer_section} ref={composerSectionRef}>
                <div className={styles.feed_composer_body}>
                    {composerConnectionId != null && composerCore != null && <dependencies.WorkbookComposer
                        key={props.workbookScripts.workbookId}
                        instance={composerCore.instance}
                        catalog={composerCore.catalog}
                        variant={landing ? WorkbookComposerVariant.Hero : WorkbookComposerVariant.Docked}
                        keywordCase={keywordCase}
                        agentWorking={session != null && isAgentWorking(session)}
                        session={session}
                        connect={agentConnect}
                        onSend={handleComposerSend}
                        bar={statusBar(WorkbookStatusBarVariant.Prompt)}
                        setView={setComposerView}
                        submitRef={composerSubmitRef}
                        scriptNames={scriptNames}
                        targetScriptRef={composerTargetScriptRef}
                        renameScriptRef={composerRenameScriptRef}
                        tableParameters={composerCore.tableParameters}
                        snippetConnector={composerConnectorType}
                        offlineWorkbookId={scriptConnections.get(composerConnectionId)?.connectionHealth === ConnectionHealth.ONLINE
                            ? null : props.workbookScripts.workbookId}
                        connectionPicker={(
                            <ScriptConnectionPicker
                                workbookId={props.workbookScripts.workbookId}
                                scriptName="new"
                                connection={scriptConnections.get(composerConnectionId) ?? null}
                                disabled={false}
                                onPick={pickPendingConnection}
                                onAttach={attachPendingConnection}
                                testId="composer-connection-picker"
                            />
                        )}
                    />}
                </div>
            </div>}
        </div>
    );
};
