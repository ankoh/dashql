import * as React from 'react';
import * as core from '../../../core/index.js';
import * as styles from './notebook_shell.module.css';

import { EditorSelection, EditorState, Extension, Prec } from '@codemirror/state';
import { EditorView, drawSelection, keymap } from '@codemirror/view';
import { cursorLineEnd, cursorLineStart, defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { List, useListRef } from 'react-window';
import type { RowComponentProps } from 'react-window';

import type { ConnectionState } from '../../../connection/connection_state.js';
import { ConnectionHealth } from '../../../connection/connection_state.js';
import { QueryType, queryIsDone } from '../../../connection/query_execution_state.js';
import { useCancelQuery, useQueryExecutor, useQueryState } from '../../../connection/query_executor.js';
import { resolveVisualizeQuery } from '../../../connection/visualize_executor.js';
import type { NotebookScripts } from '../../../scripts/notebook_scripts.js';
import { makeScriptLookup } from '../../../scripts/notebook_scripts.js';
import { projectionForVisualizeQuery, type ResolvedVisualizeQuery } from '../../../scripts/script_types.js';
import { useLogger } from '../../../platform/logger/logger_provider.js';
import { executeShellCommand, parseShellCommand } from './notebook_shell_commands.js';
import { useCatalogLoaderQueue } from '../../../connection/catalog_loader.js';
import { isCatalogRefreshRunning } from '../../../connection/catalog_update_state.js';
import { NotebookViewMode, useNotebookViewMode } from '../../../scripts/notebook_commands.js';
import { DashQLShellExtensions } from '../../editor/dashql_extension.js';
import {
    DashQLCompletionStatus,
    DashQLProcessorPlugin,
    DashQLProcessorUpdateOut,
    DashQLScriptBuffers,
    DashQLUpdateEffect,
    analyzeScript,
} from '../../editor/dashql_processor.js';
import * as themes from '../../editor/themes/index.js';
import { EntryStatusBar } from '../entry_status_bar.js';
import { deriveEntryStatus } from '../entry_status_model.js';
import { observeSize } from '../../foundations/size_observer.js';
import { FeedEntryFooter } from '../feed/feed_entry_footer.js';
import { createShellPromptGutter } from './shell_prompt_gutter.js';
import { ShellQueryPreview } from './shell_query_preview.js';
import { ShellCommandCompletionExtension } from './shell_command_completion.js';
import { getShellConnectionDetails, type ShellConnectionDetail } from './notebook_shell_preamble.js';
import { ShellResultDetails } from './shell_result_details.js';

const LOG_CTX = 'notebook_shell';
const ESTIMATED_ENTRY_HEIGHT = 280;
const ESTIMATED_INPUT_HEIGHT = 80;
const ROW_HEIGHT_EPSILON = 1;
const PREAMBLE_ROW_KEY = 'preamble';
const INPUT_ROW_KEY = 'input';

export const enum ShellInputState {
    Empty,
    Incomplete,
    Complete,
    Multiple,
}

interface ShellEntry {
    entryId: number;
    sourceText: string;
    queryId: number;
    visualizeQuery: ResolvedVisualizeQuery | null;
}

export interface ShellHistoryEntry {
    sourceText: string;
}

interface ShellProcessorState {
    buffers: DashQLScriptBuffers;
    cursor: core.FlatBufferPtr<core.buffers.cursor.ScriptCursor> | null;
    completion: DashQLProcessorUpdateOut['scriptCompletion'];
}

interface Props {
    notebookScripts: NotebookScripts;
    connection: ConnectionState | null;
    active: boolean;
    openConnectionOverlay: () => void;
    openCatalog: (target: 'relations' | 'functions') => void;
}

function destroyProcessorState(state: ShellProcessorState): void {
    state.buffers.destroy(state.buffers);
    state.cursor?.destroy();
    state.completion?.buffer.destroy();
}

function byteAt(text: string, offset: number): number | null {
    const bytes = new TextEncoder().encode(text);
    return offset >= 0 && offset < bytes.length ? bytes[offset] : null;
}

export function classifyShellInput(text: string, buffers: DashQLScriptBuffers): ShellInputState {
    if (text.trim().length === 0) return ShellInputState.Empty;
    if (buffers.parsed == null) return ShellInputState.Incomplete;

    const parsed = buffers.parsed.read();
    if (parsed.scannerErrorsLength() > 0 || parsed.parserErrorsLength() > 0) {
        return ShellInputState.Incomplete;
    }
    if (parsed.statementsLength() > 1) return ShellInputState.Multiple;
    if (parsed.statementsLength() !== 1) return ShellInputState.Incomplete;

    const tokens = parsed.tokens();
    const offsets = tokens?.tokenOffsetsArray() ?? null;
    const lengths = tokens?.tokenLengthsArray() ?? null;
    const types = tokens?.tokenTypesArray() ?? null;
    if (offsets == null || lengths == null || types == null) return ShellInputState.Incomplete;
    for (let i = offsets.length - 1; i >= 0; --i) {
        if (types[i] === core.buffers.parser.ScannerTokenType.COMMENT) continue;
        return byteAt(text, offsets[i] + lengths[i] - 1) === 59
            ? ShellInputState.Complete
            : ShellInputState.Incomplete;
    }
    return ShellInputState.Incomplete;
}

export function getShellInputError(text: string, buffers: DashQLScriptBuffers): string | null {
    if (text.trim().length === 0 || buffers.parsed == null) return null;
    const parsed = buffers.parsed.read();
    if (parsed.scannerErrorsLength() > 0) {
        return parsed.scannerErrors(0)?.message() ?? 'DashQL scanner error';
    }
    if (parsed.parserErrorsLength() > 0) {
        return parsed.parserErrors(0)?.message() ?? 'DashQL parser error';
    }
    return null;
}

function replaceEditorText(view: EditorView, text: string): void {
    view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: EditorSelection.cursor(text.length),
        scrollIntoView: true,
    });
}

interface ShellInputProps {
    notebookScripts: NotebookScripts;
    prompt: string;
    active: boolean;
    history: readonly ShellHistoryEntry[];
    onSubmit: (text: string, buffers: DashQLScriptBuffers) => boolean;
    onInput: (text: string, buffers: DashQLScriptBuffers) => void;
    setFocusInput: (focus: (() => void) | null) => void;
}

const ShellInput: React.FC<ShellInputProps> = (props) => {
    const scriptRef = React.useRef<core.DashQLScript | null>(null);
    const processorStateRef = React.useRef<ShellProcessorState | null>(null);
    const historyIndexRef = React.useRef(props.history.length);
    const historyDraftRef = React.useRef('');
    const recallingHistoryRef = React.useRef(false);
    const [node, setNode] = React.useState<HTMLDivElement | null>(null);
    const viewRef = React.useRef<EditorView | null>(null);
    const submitRef = React.useRef(props.onSubmit);
    const inputRef = React.useRef(props.onInput);
    const historyRef = React.useRef(props.history);
    submitRef.current = props.onSubmit;
    inputRef.current = props.onInput;
    historyRef.current = props.history;

    const installProcessorState = React.useCallback((view: EditorView, next: ShellProcessorState) => {
        const script = scriptRef.current;
        if (script == null) return;
        processorStateRef.current = next;
        view.dispatch({
            effects: DashQLUpdateEffect.of({
                config: {
                    shouldProcessText: text => parseShellCommand(text) == null,
                },
                scriptRegistry: props.notebookScripts.scriptRegistry,
                scriptKey: script.getCatalogEntryId(),
                script,
                scriptBuffers: next.buffers,
                scriptCursor: next.cursor,
                scriptCompletion: next.completion,
                scriptPendingDiff: null,
                derivedFocus: null,
                onUpdate: (update) => {
                    if (update.script !== scriptRef.current) return;
                    const previous = processorStateRef.current;
                    const updated = {
                        buffers: update.scriptBuffers,
                        cursor: update.scriptCursor,
                        completion: update.scriptCompletion,
                    };
                    processorStateRef.current = updated;
                    if (previous != null) {
                        if (previous.buffers !== updated.buffers) previous.buffers.destroy(previous.buffers);
                        if (previous.cursor !== updated.cursor) previous.cursor?.destroy();
                        if (previous.completion?.buffer !== updated.completion?.buffer) previous.completion?.buffer.destroy();
                    }
                    if (recallingHistoryRef.current) {
                        recallingHistoryRef.current = false;
                    } else {
                        historyIndexRef.current = historyRef.current.length;
                    }
                    inputRef.current(view.state.doc.toString(), update.scriptBuffers);
                },
            }),
        });
    }, [props.notebookScripts.scriptRegistry]);

    React.useEffect(() => {
        if (node == null) return;

        const script = props.notebookScripts.instance.createScript(props.notebookScripts.connectionCatalog);
        scriptRef.current = script;
        const initialState: ShellProcessorState = {
            buffers: analyzeScript(script),
            cursor: null,
            completion: null,
        };

        const moveHistory = (view: EditorView, direction: -1 | 1): boolean => {
            const historyEntries = historyRef.current;
            const selection = view.state.selection.main;
            if (!selection.empty) return false;
            const line = view.state.doc.lineAt(selection.head);
            if (direction < 0 && line.number !== 1) return false;
            if (direction > 0 && line.number !== view.state.doc.lines) return false;
            if (historyEntries.length === 0) return false;

            if (historyIndexRef.current === historyEntries.length) {
                historyDraftRef.current = view.state.doc.toString();
            }
            const nextIndex = Math.max(0, Math.min(historyEntries.length, historyIndexRef.current + direction));
            if (nextIndex === historyIndexRef.current) return true;
            historyIndexRef.current = nextIndex;
            recallingHistoryRef.current = true;
            replaceEditorText(view, nextIndex === historyEntries.length ? historyDraftRef.current : historyEntries[nextIndex].sourceText);
            return true;
        };

        const submit = (view: EditorView): boolean => {
            const processor = view.state.field(DashQLProcessorPlugin);
            if (processor.scriptCompletion?.status === DashQLCompletionStatus.AVAILABLE && !processor.scriptCompletion.passiveHint) {
                return false;
            }
            const text = view.state.doc.toString();
            if (parseShellCommand(text) != null) {
                if (!submitRef.current(text, processor.scriptBuffers)) return true;
                historyIndexRef.current = historyRef.current.length + 1;
                historyDraftRef.current = '';
                replaceEditorText(view, '');
                return true;
            }
            const inputState = classifyShellInput(text, processor.scriptBuffers);
            if (inputState !== ShellInputState.Complete && inputState !== ShellInputState.Multiple) return false;
            if (!submitRef.current(text, processor.scriptBuffers)) return true;

            historyIndexRef.current = historyRef.current.length + 1;
            historyDraftRef.current = '';
            replaceEditorText(view, '');
            return true;
        };

        const shellKeys = Prec.high(keymap.of([
            { key: 'Enter', run: submit },
            { key: 'Ctrl-a', run: cursorLineStart },
            { key: 'Ctrl-e', run: cursorLineEnd },
            { key: 'ArrowUp', run: view => moveHistory(view, -1) },
            { key: 'ArrowDown', run: view => moveHistory(view, 1) },
        ]));
        const extensions: Extension[] = [
            themes.xcode.xcodeLightInit({
                settings: {
                    background: 'transparent',
                    gutterBackground: 'transparent',
                    lineHighlight: 'transparent',
                },
            }),
            drawSelection(),
            history(),
            createShellPromptGutter(props.prompt),
            ShellCommandCompletionExtension,
            ...DashQLShellExtensions,
            shellKeys,
            keymap.of([...defaultKeymap, ...historyKeymap]),
            EditorView.contentAttributes.of({
                'aria-label': 'DashQL shell input',
                'aria-multiline': 'true',
                spellcheck: 'false',
            }),
            EditorView.theme({
                '&': { backgroundColor: 'transparent' },
                '.cm-scroller': { overflow: 'visible' },
                '.cm-content': { minHeight: '24px', padding: '0' },
                '.cm-line': { padding: '0' },
                '.cm-gutters': { paddingLeft: '0', backgroundColor: 'transparent', border: 'none' },
            }),
        ];
        const view = new EditorView({
            state: EditorState.create({ extensions }),
            parent: node,
        });
        viewRef.current = view;
        props.setFocusInput(() => view.focus());
        installProcessorState(view, initialState);
        if (props.active) view.focus();

        return () => {
            props.setFocusInput(null);
            view.destroy();
            viewRef.current = null;
            const current = processorStateRef.current;
            processorStateRef.current = null;
            if (current != null) destroyProcessorState(current);
            script.destroy();
            scriptRef.current = null;
        };
    }, [node, props.notebookScripts.instance, props.notebookScripts.connectionCatalog, props.prompt, props.setFocusInput, installProcessorState]);

    React.useEffect(() => {
        if (props.active) viewRef.current?.focus();
    }, [props.active]);

    React.useEffect(() => {
        historyIndexRef.current = props.history.length;
    }, [props.history.length]);

    return (
        <div className={styles.input_editor} ref={setNode} />
    );
};

const ShellResultCard: React.FC<{
    notebookId: string;
    entry: ShellEntry;
    onShowTable: (queryId: number) => void;
}> = ({ notebookId, entry, onShowTable }) => {
    const query = useQueryState(notebookId, entry.queryId);
    const cancelQuery = useCancelQuery();
    const traceId = query?.traceId ?? null;
    const status = deriveEntryStatus(null, query);
    const active = query != null && !queryIsDone(query.status);
    const [logRequest, setLogRequest] = React.useState(0);

    return (
        <div className={styles.result_card} aria-live="polite" onClick={event => event.stopPropagation()}>
            <EntryStatusBar
                status={status}
                onClick={traceId != null ? () => setLogRequest(value => value + 1) : undefined}
                onCancel={active ? () => cancelQuery(notebookId, entry.queryId) : undefined}
                cancelLabel="Cancel query"
            />
            {query != null && <FeedEntryFooter
                notebookId={notebookId}
                queryState={query}
                agentTraceId={null}
                visualizeQuery={entry.visualizeQuery}
                logRequest={{ nonce: logRequest, traceId }}
                onShowTable={() => onShowTable(entry.queryId)}
            />}
        </div>
    );
};

interface ShellRowProps {
    notebookId: string;
    notebookScripts: NotebookScripts;
    entries: readonly ShellEntry[];
    connectionDetails: readonly ShellConnectionDetail[];
    prompt: string;
    active: boolean;
    history: readonly ShellHistoryEntry[];
    error: string | null;
    onSubmit: (sourceText: string, buffers: DashQLScriptBuffers) => boolean;
    onInput: (text: string, buffers: DashQLScriptBuffers) => void;
    onHeightMeasured: (rowKey: string, height: number) => void;
    setFocusInput: (focus: (() => void) | null) => void;
    onShowTable: (queryId: number) => void;
}

function ShellRow(props: RowComponentProps<ShellRowProps>) {
    const rowRef = React.useRef<HTMLDivElement>(null);
    const isPreamble = props.index === 0;
    const isInput = props.index === props.entries.length + 1;
    const entry = isPreamble || isInput ? null : props.entries[props.index - 1];
    const rowKey = isPreamble ? PREAMBLE_ROW_KEY : isInput ? INPUT_ROW_KEY : `entry:${entry!.entryId}`;

    React.useLayoutEffect(() => {
        const element = rowRef.current;
        if (element == null) return;
        const measure = () => {
            const height = element.getBoundingClientRect().height;
            if (height > 0) props.onHeightMeasured(rowKey, height);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [props.onHeightMeasured, rowKey]);

    if (isPreamble) {
        return (
            <div ref={rowRef} style={{ ...props.style, height: 'auto' }} className={styles.preamble}>
                <div className={styles.preamble_title}>DashQL Shell</div>
                <dl className={styles.connection_details} aria-label="Connection details">
                    {props.connectionDetails.map(detail => (
                        <React.Fragment key={detail.label}>
                            <dt>{detail.label}:</dt>
                            <dd>{detail.value}</dd>
                        </React.Fragment>
                    ))}
                </dl>
                <div>Enter &quot;.&quot; for Shell commands; terminate SQL with &quot;;&quot;.</div>
            </div>
        );
    }

    if (isInput) {
        return (
            <div ref={rowRef} style={{ ...props.style, height: 'auto' }} className={styles.input_row}>
                <ShellInput
                    notebookScripts={props.notebookScripts}
                    prompt={props.prompt}
                    active={props.active}
                    history={props.history}
                    onSubmit={props.onSubmit}
                    onInput={props.onInput}
                    setFocusInput={props.setFocusInput}
                />
                {props.error != null && <div className={styles.input_error} role="alert">{props.error}</div>}
            </div>
        );
    }

    if (entry == null) return null;

    return (
        <div ref={rowRef} style={{ ...props.style, height: 'auto' }}>
            <article className={styles.entry}>
                <ShellQueryPreview
                    notebookScripts={props.notebookScripts}
                    sourceText={entry.sourceText}
                    prompt={props.prompt}
                />
                <ShellResultCard notebookId={props.notebookId} entry={entry} onShowTable={props.onShowTable} />
            </article>
        </div>
    );
}

export const NotebookShell: React.FC<Props> = (props) => {
    const logger = useLogger();
    const executeQuery = useQueryExecutor();
    const cancelQuery = useCancelQuery();
    const refreshCatalog = useCatalogLoaderQueue();
    const { setMode: setNotebookMode } = useNotebookViewMode();
    const [entries, setEntries] = React.useState<ShellEntry[]>([]);
    const [history, setHistory] = React.useState<ShellHistoryEntry[]>([]);
    const [error, setError] = React.useState<string | null>(null);
    const [detailsQueryId, setDetailsQueryId] = React.useState<number | null>(null);
    const detailsQuery = useQueryState(props.notebookScripts.notebookId, detailsQueryId);
    const detailsEntry = detailsQueryId == null
        ? null
        : entries.find(entry => entry.queryId === detailsQueryId) ?? null;
    const listContainerRef = React.useRef<HTMLDivElement>(null);
    const listRef = useListRef(null);
    const listSize = observeSize(listContainerRef);
    const rowHeightsRef = React.useRef<Map<string, number>>(new Map());
    const [rowHeightsVersion, setRowHeightsVersion] = React.useState(0);
    const focusInputRef = React.useRef<(() => void) | null>(null);
    const focusInputPendingRef = React.useRef(false);
    const nextEntryId = React.useRef(1);
    const entriesRef = React.useRef(entries);
    entriesRef.current = entries;
    const prompt = props.connection?.connectorInfo.names.displayShort.toLowerCase()
        ?? props.notebookScripts.connectorInfo.names.displayShort.toLowerCase();
    const connectionDetails = React.useMemo(
        () => getShellConnectionDetails(props.connection),
        [props.connection],
    );
    const handleHeightMeasured = React.useCallback((rowKey: string, height: number) => {
        const previous = rowHeightsRef.current.get(rowKey);
        if (previous != null && Math.abs(previous - height) < ROW_HEIGHT_EPSILON) return;
        rowHeightsRef.current.set(rowKey, height);
        setRowHeightsVersion(version => version + 1);
    }, []);
    const setFocusInput = React.useCallback((focus: (() => void) | null) => {
        focusInputRef.current = focus;
        if (focus != null && focusInputPendingRef.current) {
            focusInputPendingRef.current = false;
            focus();
        }
    }, []);
    const focusInput = React.useCallback(() => {
        focusInputPendingRef.current = true;
        listRef.current?.scrollToRow({ index: entriesRef.current.length + 1, align: 'end' });
        requestAnimationFrame(() => {
            const focus = focusInputRef.current;
            if (focus == null) return;
            focusInputPendingRef.current = false;
            focus();
        });
    }, [listRef]);
    const handleShellClick = React.useCallback((event: React.MouseEvent<HTMLElement>) => {
        const target = event.target as HTMLElement;
        if (target.closest('button, a, input, textarea, select, [contenteditable="true"], [tabindex]') != null) return;
        focusInput();
    }, [focusInput]);

    React.useEffect(() => () => {
        for (const entry of entriesRef.current) {
            cancelQuery(props.notebookScripts.notebookId, entry.queryId);
        }
    }, [cancelQuery, props.notebookScripts.notebookId]);

    const clearEntries = React.useCallback(() => {
        for (const entry of entriesRef.current) {
            cancelQuery(props.notebookScripts.notebookId, entry.queryId);
            rowHeightsRef.current.delete(`entry:${entry.entryId}`);
        }
        setEntries([]);
        setError(null);
    }, [cancelQuery, props.notebookScripts.notebookId]);

    const commandContext = React.useMemo(() => ({
        clearEntries,
        openCatalog: props.openCatalog,
        refreshCatalog: (): string | null => {
            if (props.connection == null
                || props.connection.connectionHealth !== ConnectionHealth.ONLINE
                || !props.connection.connectorInfo.features.refreshSchemaAction) {
                return 'Catalog refresh requires a connected catalog-capable connector.';
            }
            if (isCatalogRefreshRunning(props.connection)) {
                return 'Catalog refresh is already running.';
            }
            refreshCatalog(props.notebookScripts.notebookId, true);
            return null;
        },
        openConnection: props.openConnectionOverlay,
        showNotebook: () => setNotebookMode(NotebookViewMode.Notebook),
    }), [
        clearEntries,
        props.connection,
        props.notebookScripts.notebookId,
        props.openCatalog,
        props.openConnectionOverlay,
        refreshCatalog,
        setNotebookMode,
    ]);

    const submit = React.useCallback((sourceText: string, buffers: DashQLScriptBuffers): boolean => {
        setError(null);
        if (parseShellCommand(sourceText) != null) {
            const commandError = executeShellCommand(sourceText, commandContext);
            if (commandError != null) {
                setError(commandError);
                return false;
            }
            setHistory(current => [...current, { sourceText }]);
            return true;
        }
        if (props.connection == null
            || props.connection.connectionHealth !== ConnectionHealth.ONLINE
            || !props.connection.connectorInfo.features.executeQueryAction) {
            setError('Connect this notebook before executing a Shell statement.');
            props.openConnectionOverlay();
            return false;
        }

        const inputState = classifyShellInput(sourceText, buffers);
        if (inputState === ShellInputState.Multiple) {
            setError('Shell accepts one statement at a time.');
            return false;
        }
        if (inputState !== ShellInputState.Complete) return false;

        const visualizeQuery = resolveVisualizeQuery(
            buffers,
            sourceText,
            makeScriptLookup(props.notebookScripts.scripts),
            logger,
        );
        const parsed = buffers.parsed?.read() ?? null;
        const firstStatement = parsed?.statements(0, new core.buffers.parser.Statement()) ?? null;
        const isVisualize = firstStatement?.statementType() === core.buffers.parser.StatementType.VIS_VISUALISE
            || /^\s*visualize\b/i.test(sourceText);
        if (isVisualize && visualizeQuery == null) {
            setError('Could not resolve the VISUALIZE source query.');
            return false;
        }

        const queryText = visualizeQuery?.sql ?? sourceText;
        const [queryId] = executeQuery(props.notebookScripts.notebookId, {
            query: queryText,
            analyzeResults: true,
            cacheable: false,
            projection: projectionForVisualizeQuery(visualizeQuery),
            metadata: {
                queryType: QueryType.USER_PROVIDED,
                title: 'Shell Query',
                description: null,
                issuer: 'DashQL Shell',
                userProvided: true,
            },
        });
        setEntries(current => [...current, {
            entryId: nextEntryId.current++,
            sourceText,
            queryId,
            visualizeQuery,
        }]);
        setHistory(current => [...current, { sourceText }]);
        return true;
    }, [commandContext, executeQuery, logger, props.connection, props.notebookScripts, props.openConnectionOverlay]);

    React.useEffect(() => {
        if (listRef.current == null) return;
        listRef.current.scrollToRow({ index: entries.length + 1, align: 'end' });
    }, [entries.length, listRef]);

    const rowProps = React.useMemo<ShellRowProps>(() => ({
        notebookId: props.notebookScripts.notebookId,
        notebookScripts: props.notebookScripts,
        entries,
        connectionDetails,
        prompt,
        active: props.active,
        history,
        error,
        onSubmit: submit,
        onInput: (text, buffers) => setError(getShellInputError(text, buffers)),
        onHeightMeasured: handleHeightMeasured,
        setFocusInput,
        onShowTable: setDetailsQueryId,
    }), [props.notebookScripts, entries, connectionDetails, prompt, props.active, history, error, submit, handleHeightMeasured, setFocusInput]);

    if (detailsQuery != null) {
        return (
            <ShellResultDetails
                query={detailsQuery}
                visualizeQuery={detailsEntry?.visualizeQuery ?? null}
                onCancel={() => cancelQuery(props.notebookScripts.notebookId, detailsQuery.queryId)}
                onClose={() => setDetailsQueryId(null)}
            />
        );
    }

    return (
        <section className={styles.shell} aria-label="DashQL Shell" onClick={handleShellClick}>
            <div className={styles.list_container} ref={listContainerRef}>
                <List
                    listRef={listRef}
                    style={{
                        width: listSize?.width ?? 0,
                        height: listSize?.height ?? 0,
                        overflowX: 'hidden',
                    }}
                    rowCount={entries.length + 2}
                    rowHeight={(rowIndex) => {
                        void rowHeightsVersion;
                        const entry = entries[rowIndex - 1];
                        const rowKey = rowIndex === 0
                            ? PREAMBLE_ROW_KEY
                            : rowIndex === entries.length + 1
                                ? INPUT_ROW_KEY
                                : `entry:${entry.entryId}`;
                        return rowHeightsRef.current.get(rowKey)
                            ?? (rowIndex === 0
                                ? ESTIMATED_INPUT_HEIGHT * 2
                                : rowIndex <= entries.length
                                    ? ESTIMATED_ENTRY_HEIGHT
                                    : ESTIMATED_INPUT_HEIGHT);
                    }}
                    rowComponent={ShellRow}
                    rowProps={rowProps}
                />
            </div>
        </section>
    );
};
