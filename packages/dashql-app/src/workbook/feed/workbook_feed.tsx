import * as React from 'react';
import type * as dashql from '@akohn/dashql';
import * as styles from './workbook_feed.module.css';


import type { EditorView } from '@codemirror/view';
import { useAppConfig } from '../../config/app_config.js';

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

import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { useWorkbookReadOnly } from '../workbook_read_only.js';
import { deleteScript, useScriptSelection } from '../scripts/script_selection.js';
import { getScriptRefs, type ModifyWorkbookScripts, type WorkbookDerived, type WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { createScriptAction } from '../scripts/script_creation.js';
import { useOptionalRuntime, useRuntime, useViewReader, useViewSelector } from '@akohn/dashql-react/hooks';
import type { Runtime } from '@akohn/dashql/runtime/runtime';
import { renameAttachment, type RenameDraftReferences } from '../attachment_rename.js';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';
import { insertMentionAtCursor, useLastFocusedEditor } from '../editor/editor_focus.js';
import { DashQLProcessorPlugin, type DashQLParameterClick } from '../editor/dashql_processor.js';
import { type KeyEventHandler, useKeyEvents } from '@akohn/dashql-react/dom/key_events';
import { useStorageReader } from '../../storage/storage_provider.js';
import { quoteIdentifier as quoteSqlIdentifier } from '@akohn/dashql/platform/utils/sql_quote';
import { useLogger } from '../../host/logger_provider.js';
import { FEED_GAP, revealScrollOffset, useWorkbookFeedLayout } from './workbook_feed_layout.js';
import { ScriptFeedRow, type ScriptFeedRowProps } from './workbook_feed_row.js';
import type { ScriptFeedCommands } from './script_card.js';
import { getKeywordCase } from '../scripts/script_format.js';
import { reorderFeedEntries } from './workbook_feed_drag.js';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { WorkbookDataCard } from './workbook_data_card.js';
import { WorkbookInputStrip } from '../inputs/workbook_input_strip.js';
import { StageLabel, StageSection } from '../stage_section.js';
import { WorkbookInputOverlay, type WorkbookInputOverlayTarget } from '../inputs/workbook_input_overlay.js';
import { VerticalScrollShadows } from '@akohn/dashql-react/components/vertical_scroll_shadows';
import { useObservedSize } from '@akohn/dashql-react/components/size_observer';
import {
    scriptConnectionView,
    usePickScriptConnection,
    type ScriptConnectionView,
} from '../scripts/script_connection_picker.js';
import { useConnectionLabeler } from '../connections/connection_labels.js';
import type { AgentFollowTarget } from '../../agent/agent_session.js';
import { useLiveWorkbookStatuses, useReportWorkbookOutcomes } from '../status/workbook_status_store.js';
import { WorkbookStatusSource, WorkbookStatusTone, type WorkbookStatus } from '../status/workbook_status.js';
import type { WorkbookPromptFeed, WorkbookPromptHandle } from './workbook_prompt.js';

export interface WorkbookFeedProps {
    workbookScripts: WorkbookScripts;
    modifyWorkbookScripts: ModifyWorkbookScripts;
    /// The function that renames the references in the draft of the composer, for renamed attachments
    draftRenameRef?: React.RefObject<RenameDraftReferences | null>;
    /// The connection that the next script runs on
    conn: ConnectionState | null;
    /// The connections that the scripts run on
    scriptConnections: ReadonlyMap<string, ConnectionState>;
    /// Whether the feed is the visible, interactive layer. The feed stays mounted (just hidden) while
    /// another view, e.g. a connection overview, is open so it keeps its scroll position and measured row heights;
    /// while inactive its global key handlers must stand down so Escape/Enter belong to the overlay.
    active: boolean;
    /// A script to scroll into view, e.g. one opened from the sidebar. A new request object reveals again.
    revealRequest?: WorkbookFeedRevealRequest | null;
    /// Receives the function that attaches files to the workbook, for the files dropped on the page or picked in its
    /// menu. Null while the workbook takes no attachments.
    attachRef?: React.RefObject<((files: File[]) => void) | null>;
    /// The height of the prompt docked over the bottom of the feed, the last script scrolls clear of it
    bottomInset?: number;
    /// The prompt of the workbook, the feed mentions its scripts and attachments in its question
    promptRef?: React.RefObject<WorkbookPromptHandle | null>;
    /// Receives what the prompt asks of the feed: follow the agent, show a script, scroll to an appended script
    handleRef?: React.Ref<WorkbookPromptFeed>;
    /// The parts of the feed that the prompt lines up with
    onInsets?: (insets: WorkbookFeedInsets) => void;
    dependencies?: WorkbookFeedDependencies;
}

/// The parts of the feed that the prompt over it lines up with
export interface WorkbookFeedInsets {
    /// The height of the head above an empty feed, the greeting stands below it
    head: number;
    /// The space between the scripts and the scrollbar of the list
    scrollbarInset: number;
    /// The width of the scrollbar of the list
    scrollbarGutter: number;
}

/// A script that the feed scrolls into view once its workbook shows
export interface WorkbookFeedRevealRequest {
    workbookId: string;
    fileName: string;
}

export interface WorkbookFeedDependencies {
    useStorageReader: typeof useStorageReader;
    /// The commands of the runtime that attach and detach files
    useAttachmentCommands: () => Pick<Runtime, 'attachFiles' | 'detachFile'>;
    usePickScriptConnection: typeof usePickScriptConnection;
    useKeyEvents: typeof useKeyEvents;
    /// Reads the scripts in the handlers, the feed doesn't render with their keystrokes
    useViewReader: typeof useViewReader;
    /// Selects the attachments that collide with the scripts from the derived view of the workbook
    useViewSelector: typeof useViewSelector;
    ScriptFeedRow: typeof ScriptFeedRow;
}

const DEFAULT_DEPENDENCIES: WorkbookFeedDependencies = {
    useStorageReader,
    useAttachmentCommands: () => useRuntime(),
    usePickScriptConnection,
    useKeyEvents,
    useViewReader,
    useViewSelector,
    ScriptFeedRow,
};

const LOG_CTX = 'workbook_feed';
const NO_ATTACHMENTS: readonly dashql.WorkbookAttachmentView[] = [];
const NO_FILE_NAMES: readonly string[] = [];
const OVERSCAN_ROW_COUNT = 16;
const FEED_ENTRY_CHROME_HEIGHT = 50;
const FEED_EDITOR_LINE_HEIGHT = 18;
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
const DRAG_MODIFIERS = [restrictToVerticalAxis];
/// The attachments whose table parameter has the name of a script, they keep their identity while they are the same
const selectCollidingAttachments = (derived: WorkbookDerived | null) => derived?.collidingAttachments ?? NO_FILE_NAMES;

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

export const WorkbookFeed: React.FC<WorkbookFeedProps> = (props) => {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const { modifyWorkbookScripts, draftRenameRef } = props;
    const config = useAppConfig();
    const logger = useLogger();
    const scriptDebugMode = config?.settings?.scriptDebugMode ?? false;
    const formattingDebugMode = config?.settings?.formattingDebugMode ?? false;
    const attachmentsVisible = config?.settings?.experimental_file_attachments === true;
    const keywordCase = getKeywordCase(config?.settings);
    const scriptRefs = props.workbookScripts.scriptRefs;
    const scriptOrder = props.workbookScripts.scriptOrder;
    // The scripts of the workbook as the handlers read them. The feed doesn't subscribe to them, every keystroke changes
    // one of them: the rows read their scripts.
    const readView = dependencies.useViewReader();
    // The estimated heights only matter until a row is measured.
    // Don't re-estimate (and copy the text of every script) whenever any script changes.
    const canonicalEntries = React.useMemo(
        () => getScriptRefs({ scriptRefs, scriptOrder }).map(entry => ({
            ...entry,
            estimatedHeight: estimateFeedEntryHeight(
                readView('script', entry.scriptId)?.scriptSession.getText() ?? '',
            ),
        })),
        [scriptRefs, scriptOrder, readView],
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
    const scriptConnections = useScriptConnectionViews(props.scriptConnections);
    const storageReader = dependencies.useStorageReader();
    const attachmentCommands = dependencies.useAttachmentCommands();
    const workbookId = props.workbookScripts.workbookId;
    const [attachmentError, setAttachmentError] = React.useState<string | null>(null);
    // The view of the workbook lists its attachments, a changed attachment is listed again
    const attachments = props.workbookScripts.attachments ?? NO_ATTACHMENTS;
    // The attachments whose table parameter has the name of a script, the runtime derives them again when an analysis
    // changes. The rows and the editors read the checked references of their scripts.
    const collidingAttachments = dependencies.useViewSelector('workbookDerived', workbookId, selectCollidingAttachments);
    // A read-only workbook adds no scripts and no attachments
    const readOnly = useWorkbookReadOnly();
    const attachmentsEnabled = !readOnly && (props.conn?.readsAttachments ?? false);
    // The files that are being attached, the status of the workbook tells them
    const [attaching, setAttaching] = React.useState<{ workbookId: string; files: number } | null>(null);
    const reportOutcomes = useReportWorkbookOutcomes();
    const saveAttachments = React.useCallback(async (files: Iterable<File>) => {
        setAttachmentError(null);
        const logFiles = (tone: WorkbookStatusTone, text: string, detail: string | null = null) => reportOutcomes(workbookId, [{
            key: `files:${text}:${Date.now()}`, source: WorkbookStatusSource.Files, tone, text, detail, at: Date.now(),
        }]);
        const dropped = [...files];
        if (dropped.length === 0) return;
        setAttaching({ workbookId, files: dropped.length });
        try {
            // The runtime names the attachments past the scripts and the other attachments, Parquet files only
            const outcome = await attachmentCommands.attachFiles(workbookId, dropped.map(file => ({ name: file.name, file })));
            if (outcome.refused.length > 0) {
                setAttachmentError(`Only Parquet files can be attached: ${outcome.refused.join(', ')}`);
                logFiles(WorkbookStatusTone.Failed, 'Only Parquet files can be attached', outcome.refused.join(', '));
            }
            for (const attached of outcome.attached) logFiles(WorkbookStatusTone.Success, `Attached ${attached.fileName}`);
        } catch (e) {
            setAttachmentError('Adding attachment failed');
            // The outcome is the record of the log
            logFiles(WorkbookStatusTone.Failed, 'Adding an attachment failed', stringifyError(e));
        } finally {
            setAttaching(null);
        }
    }, [workbookId, attachmentCommands, reportOutcomes]);
    const attachingFiles = attaching?.workbookId === workbookId ? attaching.files : 0;
    const filesLive = React.useMemo<WorkbookStatus[]>(() => attachingFiles === 0 ? [] : [{
        key: 'files:attaching', source: WorkbookStatusSource.Files, tone: WorkbookStatusTone.Progress,
        text: attachingFiles === 1 ? 'Attaching a file' : `Attaching ${attachingFiles} files`, at: Date.now(),
    }], [attachingFiles]);
    useLiveWorkbookStatuses(workbookId, 'files', filesLive);

    // The page takes the files in, dropped on it or picked in its menu
    const attachRef = props.attachRef;
    React.useEffect(() => {
        if (attachRef == null || !attachmentsVisible || !attachmentsEnabled) return;
        const attach = (files: File[]) => void saveAttachments(files);
        attachRef.current = attach;
        return () => {
            if (attachRef.current === attach) attachRef.current = null;
        };
    }, [attachRef, attachmentsVisible, attachmentsEnabled, saveAttachments]);

    // The workbook and the connections change with their views.
    // Callbacks read the latest values through a ref to stay stable for the memoized feed rows.
    const latest = React.useRef({ workbookScripts: props.workbookScripts, scriptConnections });
    latest.current = { workbookScripts: props.workbookScripts, scriptConnections };
    const pickScriptConnection = dependencies.usePickScriptConnection(modifyWorkbookScripts);

    const pendingCreatedScriptKeyRef = React.useRef<number | null>(null);
    const editorViewsRef = React.useRef(new Map<number, EditorView>());
    // Presence means collapsed. A query id marks an automatic no-result collapse; null marks a
    // manual collapse, which must not be reset when a later query starts.
    const [collapsedResults, setCollapsedResults] = React.useState<ReadonlyMap<number, number | null>>(() => new Map());

    const selection = useScriptSelection();
    const handleFocus = React.useCallback((fileName: string) => {
        selection.selectFile(latest.current.workbookScripts, fileName);
    }, [selection]);

    const handleDelete = React.useCallback((fileName: string) => {
        deleteScript(selection, latest.current.workbookScripts, modifyWorkbookScripts, fileName);
    }, [modifyWorkbookScripts, selection]);

    // A rename rewrites the references in the other scripts, the draft of the composer follows the new name itself
    const handleRename = React.useCallback((oldFileName: string, newFileName: string) => {
        modifyWorkbookScripts({ kind: 'renameScript', value: { fileName: oldFileName, newName: newFileName } });
    }, [modifyWorkbookScripts]);

    // Move a script one position up/down within the workbook by swapping it with its neighbour in the
    // feed order and dispatching the new full order.
    const moveScript = React.useCallback((fileName: string, delta: number) => {
        const order = [...latest.current.workbookScripts.scriptOrder];
        const from = order.indexOf(fileName);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= order.length) return;
        [order[from], order[to]] = [order[to], order[from]];
        modifyWorkbookScripts({ kind: 'reorderScripts', value: { order } });
    }, [modifyWorkbookScripts]);
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
        modifyWorkbookScripts({ kind: 'reorderScripts', value: { order: reordered.map(entry => entry.fileName) } });
    }, [entries, modifyWorkbookScripts, canonicalEntries]);




    // Accept / reject a staged rewrite from the feed. Accept keeps the new text; reject restores the
    // prior text and re-analyzes.
    const handleAcceptDiff = React.useCallback((scriptKey: number) => {
        modifyWorkbookScripts({ kind: 'acceptPendingDiff', value: { scriptKey } });
    }, [modifyWorkbookScripts]);
    const handleRejectDiff = React.useCallback((scriptKey: number) => {
        modifyWorkbookScripts({ kind: 'rejectPendingDiff', value: { scriptKey } });
    }, [modifyWorkbookScripts]);
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

    // A mention of a script goes to the cursor of the script editor that had the focus last, other than the editor of
    // the script itself, or into the question of the prompt
    const lastFocusedEditor = useLastFocusedEditor();
    const runtime = useOptionalRuntime();
    const promptRef = props.promptRef;
    // The mention of a table parameter, a script that is not `fileName` reads it
    const handleMention = React.useCallback((name: string, fileName: string | null) => {
        const view = lastFocusedEditor();
        if (view != null && view !== promptRef?.current?.view) {
            const scriptKey = view.state.field(DashQLProcessorPlugin, false)?.scriptKey;
            const target = scriptKey != null ? readView('script', scriptKey) : null;
            if (target != null && target.fileName !== fileName) {
                insertMentionAtCursor(view, `:${runtime?.core?.quoteIdentifier(name) ?? quoteSqlIdentifier(name)}`);
                return;
            }
        }
        promptRef?.current?.mention(name);
    }, [lastFocusedEditor, promptRef, runtime, readView]);
    const handleTargetScript = React.useCallback((fileName: string) => handleMention(scriptDisplayName(fileName), fileName), [handleMention]);
    const handleMentionAttachment = React.useCallback((name: string) => handleMention(name, null), [handleMention]);
    // An attachment renames like a script, the scripts and the draft that read it follow
    const handleRenameAttachment = React.useCallback((fileName: string, name: string) => {
        if (runtime == null) return;
        void renameAttachment(runtime, latest.current.workbookScripts, fileName, name, draftRenameRef?.current)
            .catch(e => {
                setAttachmentError('Renaming attachment failed');
                logger.error('Renaming workbook attachment failed', { workbookId, error: stringifyError(e) }, LOG_CTX);
            });
    }, [runtime, draftRenameRef, logger, workbookId]);

    // The feed stays mounted (just hidden) while another view, e.g. a connection overview, is open, so its global
    // key handlers would otherwise keep firing behind the overlay. Gate them all on the active flag.
    const feedActive = props.active;
    // A modal dialog keeps Enter and Escape, e.g. Escape closes the chart builder instead of rejecting the diff that
    // the builder stages behind it
    const modalDialogOpen = () => document.querySelector('[aria-modal="true"]') != null;
    // Plain Enter accepts and Escape rejects the staged rewrite of the selected script while the feed is browsed with
    // nothing focused (the "Accept ⏎" and "Reject ⎋" hints of the status bar). An inline editor, a rename input or an
    // open completion keeps the key when focused. Ordinary scripts ignore the keys.
    const keyHandlers = React.useMemo<KeyEventHandler[]>(() => {
        const diffKey = (key: string, apply: (scriptKey: number) => void): KeyEventHandler => ({
            key,
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
                const focused = selection.selectedRef(latest.current.workbookScripts);
                const focusedScript = focused != null ? readView('script', focused.scriptId) : null;
                if (focusedScript?.pendingDiff != null) {
                    event.preventDefault();
                    apply(focusedScript.scriptKey);
                }
            },
        });
        return [diffKey('Enter', handleAcceptDiff), diffKey('Escape', handleRejectDiff)];
    }, [feedActive, handleAcceptDiff, handleRejectDiff, selection, readView]);
    dependencies.useKeyEvents(keyHandlers);

    // The docked prompt floats over the bottom of the feed, the last script scrolls clear of it. An empty feed shows
    // its head above the greeting of the prompt.
    const landing = entries.length === 0;
    const bottomInset = landing ? 0 : props.bottomInset ?? 0;
    // The head stands above the first script and scrolls with the scripts, the first row leaves its height free. The
    // list mounts again for another workbook, with a new head: the size observer follows the element of the ref.
    const inputsRef = React.useRef<HTMLDivElement>(null);
    const headHeight = Math.ceil(useObservedSize(inputsRef)?.height ?? 0);
    const topInset = entries.length === 0 ? 0 : headHeight;
    const feedLayout = useWorkbookFeedLayout(entries, bottomInset, topInset);
    const { listRef: feedListRef, getEntrySpan } = feedLayout;
    // The head above an empty feed, the prompt places the greeting below it. Its height counts its padding above the
    // greeting, which the content box of the size observer leaves out.
    const [landingHeadElement, landingHeadRef] = React.useState<HTMLDivElement | null>(null);
    const [landingHeadHeight, setLandingHeadHeight] = React.useState(0);
    React.useLayoutEffect(() => {
        if (landingHeadElement == null) return;
        const measure = () => setLandingHeadHeight(Math.ceil(landingHeadElement.getBoundingClientRect().height));
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(landingHeadElement);
        return () => observer.disconnect();
    }, [landingHeadElement]);
    const { onInsets } = props;
    const insetHead = landing ? landingHeadHeight : 0;
    React.useEffect(() => {
        onInsets?.({ head: insetHead, scrollbarInset: feedLayout.listScrollbarInset, scrollbarGutter: feedLayout.listScrollbarGutter });
    }, [onInsets, insetHead, feedLayout.listScrollbarInset, feedLayout.listScrollbarGutter]);

    const handleEditorView = React.useCallback((scriptKey: number, view: EditorView) => {
        editorViewsRef.current.set(scriptKey, view);
        if (pendingCreatedScriptKeyRef.current !== scriptKey) return;
        pendingCreatedScriptKeyRef.current = null;
        requestAnimationFrame(() => view.focus());
    }, []);

    // The prompt appends its draft as a new script, the feed scrolls to the end once the script is in it
    const pendingScrollToEndRef = React.useRef(false);

    // Scroll a script into view.
    // A script with results that does not fit shows its results, once its row is mounted and the results are measured.
    // A created script has no entry until the next render.
    const revealScript = React.useCallback((scriptKey: number, target: AgentFollowTarget) => {
        const index = entries.findIndex(entry => entry.scriptId === scriptKey);
        const element = feedListRef.current?.element;
        if (index < 0 || element == null) return;
        const [cardTop, bottom] = getEntrySpan(index);
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
    }, [entries, feedListRef, getEntrySpan, bottomInset]);

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

    // A click on a scalar parameter in a script opens its input at the parameter, a click on a table parameter brings
    // the card of the script it references into view
    const bodyRef = React.useRef<HTMLDivElement>(null);
    const [inputOverlay, setInputOverlay] = React.useState<WorkbookInputOverlayTarget | null>(null);
    const closeInputOverlay = React.useCallback(() => setInputOverlay(null), []);
    const handleParameterClick = React.useCallback((scriptKey: number, click: DashQLParameterClick, view: EditorView) => {
        if (!click.table) {
            setInputOverlay({ name: click.name, view, from: click.from, to: click.to });
            return;
        }
        // Every use of a name references the same script
        const mark = readView('workbookDerived', workbookId)?.references.get(scriptKey)?.marks.find(m => m.parameter === click.name);
        const fileName = mark?.target ?? null;
        const target = fileName == null ? null : latest.current.workbookScripts.scriptRefs[fileName]?.scriptId;
        if (fileName == null || target == null || target === scriptKey) return;
        handleFocus(fileName);
        followAgentRef.current = false;
        followedRef.current = { scriptKey: target, target: 'script' };
        setFollowRequest(n => n + 1);
    }, [handleFocus, readView, workbookId]);

    const handleCreate = React.useCallback((index: number) => {
        const prev = latest.current.workbookScripts;
        // The outcome names the created script by its key, it is selected
        const outcome = modifyWorkbookScripts(createScriptAction(prev, { index }));
        if (!outcome.ok || typeof outcome.id !== 'number') return;
        const scriptKey = outcome.id;
        selection.select(prev.workbookId, scriptKey);
        // The created script stays in view like a followed one, until the user scrolls, clicks or types in the feed
        followAgentRef.current = false;
        followedRef.current = { scriptKey, target: 'script' };
        setFollowRequest(n => n + 1);
        const view = editorViewsRef.current.get(scriptKey);
        if (view != null) {
            view.focus();
        } else {
            pendingCreatedScriptKeyRef.current = scriptKey;
        }
    }, [modifyWorkbookScripts, selection]);

    // The agent of a session in the terminal answers questions in the scripts of the workbook, the prompt follows the
    // session and the feed shows the scripts of the agent
    const handleShowAgentScript = React.useCallback((scriptKey: number) => {
        const scriptData = readView('script', scriptKey);
        if (scriptData == null) return;
        handleFocus(scriptData.fileName);
        revealScript(scriptKey, 'script');
    }, [handleFocus, revealScript, readView]);
    React.useImperativeHandle(props.handleRef, () => ({
        follow: followAgentScript,
        show: handleShowAgentScript,
        // Every new question of the session follows the agent again
        followAgent: () => { followAgentRef.current = true; },
        // The appended script takes over the feed
        appended: () => {
            stopFollowingAgent();
            pendingScrollToEndRef.current = true;
        },
    }), [followAgentScript, handleShowAgentScript, stopFollowingAgent]);
    React.useEffect(() => {
        if (!pendingScrollToEndRef.current || entries.length === 0) return;
        pendingScrollToEndRef.current = false;
        feedListRef.current?.scrollToRow({ index: entries.length - 1, align: 'end' });
    }, [entries.length, feedListRef]);

    // The rows mount their editors once the list has a width. The list takes a width only after the size observer of
    // a container that was hidden reports, and a wrapped editor that measures at no width estimates the height of its
    // lines at a few characters per row, and gets no resize event to correct that.
    const rowsActive = props.active && feedLayout.listWidth > 0;
    // The commands of the feed for its cards, by file name. The models of the scripts run and rewrite them.
    const feedCommands = React.useMemo<ScriptFeedCommands>(() => ({
        create: handleCreate,
        focus: handleFocus,
        delete: handleDelete,
        rename: handleRename,
        pickConnection: pickScriptConnection,
        moveUp: handleMoveUp,
        moveDown: handleMoveDown,
        target: handleTargetScript,
        editorView: handleEditorView,
    }), [handleCreate, handleFocus, handleDelete, handleRename, pickScriptConnection, handleMoveUp, handleMoveDown, handleTargetScript, handleEditorView]);
    const fold = React.useMemo(() => ({
        toggle: handleToggleResultExpanded,
        autoCollapse: handleAutoCollapseResult,
        resetAutoCollapsed: handleResetAutoCollapsedResult,
    }), [handleToggleResultExpanded, handleAutoCollapseResult, handleResetAutoCollapsedResult]);
    const rowProps = React.useMemo<ScriptFeedRowProps>(() => ({
        workbookId,
        connections: scriptConnections,
        entries,
        storageReader: storageReader,
        scriptDebugMode,
        formattingDebugMode,
        keywordCase,
        active: rowsActive,
        collapsedResults,
        fold,
        feed: feedCommands,
        onParameterClick: handleParameterClick,
        topInset,
    }), [workbookId, entries, rowsActive, scriptConnections, storageReader, scriptDebugMode, formattingDebugMode, keywordCase, collapsedResults, fold, feedCommands, handleParameterClick, topInset]);

    const getScrollElement = React.useCallback(() => feedLayout.listRef.current?.element ?? null, [feedLayout.listRef]);
    // The sortable items keep their identity with the entries, every row reads them
    const sortableIds = React.useMemo(() => entries.map(entry => entry.scriptId), [entries]);

    // The head of the feed, the attachments and the parameters: above the greeting on the landing view, otherwise above
    // the first script, where they scroll away with the scripts
    const feedHead = (scriptsLabel: boolean) => (
        <>
            {/* The section appears with the first attachment, a file dropped on the page or picked in its menu */}
            {attachmentsVisible && attachments.length > 0 && (
                <StageSection label="Attachments" testId="workbook-attachments">
                    <div className={styles.feed_data_section}>
                        <div className={styles.feed_data_drawer}>
                            <div className={styles.feed_data_cards}>
                                {attachments.map(attachment => (
                                    <WorkbookDataCard key={`${workbookId}/${attachment.fileName}`} workbookId={workbookId}
                                        attachment={attachment} conn={props.conn} storageReader={storageReader}
                                        onRemove={() => attachmentCommands.detachFile(workbookId, attachment.fileName)}
                                        onMention={handleMentionAttachment}
                                        onRename={name => handleRenameAttachment(attachment.fileName, name)}
                                        collides={collidingAttachments.includes(attachment.fileName)} />
                                ))}
                            </div>
                        </div>
                    </div>
                    {attachmentError != null && <div className={styles.feed_data_error} role="alert">{attachmentError}</div>}
                </StageSection>
            )}
            <WorkbookInputStrip workbookId={workbookId} modifyWorkbookScripts={modifyWorkbookScripts} />
            {/* The scripts follow below the head, the first row of the list leaves the space below the label */}
            {scriptsLabel && <StageLabel label="Scripts" className={styles.feed_scripts_label} />}
        </>
    );
    return (
        <div
            ref={bodyRef}
            className={styles.feed_body_container}
            data-landing={landing ? '' : undefined}
            style={{
                '--feed-scrollbar-inset': `${feedLayout.listScrollbarInset}px`,
            } as React.CSSProperties}
        >
            {landing && <div className={`${styles.feed_head} ${styles.feed_top_strip}`} ref={landingHeadRef}>{feedHead(false)}</div>}
            {/* Hidden rather than unmounted on the landing view, the size observer binds to the element once */}
            <div className={styles.feed_list_container} ref={feedLayout.listContainerRef} hidden={landing} data-testid="feed-list"
                onWheel={stopFollowingAgent} onTouchMove={stopFollowingAgent} onPointerDown={stopFollowingAgent} onKeyDown={stopFollowingAgent}>
                <DndContext
                    sensors={dndSensors}
                    collisionDetection={closestCenter}
                    modifiers={DRAG_MODIFIERS}
                    onDragEnd={handleDragEnd}
                >
                    <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
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
                        >
                            <div className={styles.feed_inputs} ref={inputsRef}>
                                <div className={`${styles.feed_head} ${styles.feed_inputs_body}`}>{!landing && feedHead(true)}</div>
                            </div>
                        </List>
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
            <WorkbookInputOverlay
                workbookId={workbookId}
                modifyWorkbookScripts={modifyWorkbookScripts}
                target={inputOverlay}
                containerRef={bodyRef}
                getScrollElement={getScrollElement}
                onClose={closeInputOverlay}
            />
        </div>
    );
};
