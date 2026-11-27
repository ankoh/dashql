import * as React from 'react';
import type * as dashql from '@akohn/dashql';

import type { EditorView, KeyBinding } from '@codemirror/view';
import { insertNewlineAndIndent } from '@codemirror/commands';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { classNames } from '@akohn/dashql-react/dom/classnames';

import { DashQLShellRecordKind, type DashQLShell, type DashQLShellRecord } from '../terminal/api.js';
import { PromptEditor } from '../../workbook/editor/prompt_editor.js';
import { DashQLCompletionAbortEffect, DashQLCompletionStartEffect } from '../../workbook/editor/dashql_processor.js';
import { ReadonlySqlView } from '../../workbook/editor/readonly_sql_view.js';
import * as styles from './shell_view.module.css';

/// The entries of the feed that stay at most, the oldest go first
export const SHELL_FEED_LIMIT = 500;
/// The tables of results are at least this many characters wide, a narrow shell scrolls them sideways
const MIN_TABLE_COLUMNS = 80;
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 80;
/// The SQL assistance of a dot command: none
const NO_ASSIST: never[] = [];

/// An entry of the feed of a shell
type ShellFeedEntry =
    | { id: number; type: 'statement'; prompt: string; text: string; editorUpdate: dashql.buffers.editor.EditorUpdateT | null }
    | { id: number; type: 'record'; kind: DashQLShellRecordKind; text: string }
    | { id: number; type: 'progress'; message: string };

/// What a page does with the shell view of its shell
export interface ShellViewController {
    focus(): void;
    /// Add a status line to the feed
    writeStatus(message: string): void;
    /// Offer prompts one after another, each submit fills in the next one
    queuePrompts(prompts: readonly string[]): void;
}

export interface ShellViewProps {
    /// The shell, null while it is set up. A new shell continues the feed.
    shell: DashQLShell | null;
    /// The lines atop the feed until it is cleared, the first one is the title
    greeter?: readonly string[];
    /// The prompt, e.g. `hyperdb> `
    prompt: string;
    /// The accessible name of the prompt
    inputAriaLabel: string;
    /// The keyword case of completions
    keywordCase?: dashql.buffers.formatting.KeywordCase;
    /// A query has a result with columns, `inFeed` if the feed shows it as a table
    onQueryResult?: (queryId: number, inFeed: boolean) => void;
    /// Escape, or Ctrl+D on an empty prompt, leaves the shell
    onExit?: () => void;
    /// May the prompt take the focus once the shell is ready? A page that went to the background must not.
    mayFocus?: () => boolean;
    /// Receives the controller of the view
    controller?: React.RefObject<ShellViewController | null>;
    /// The class name of the container
    className?: string;
}

/// The view of a shell: a feed of the statements and their output from the top, and a prompt after its last entry.
/// The prompt is a CodeMirror editor with the SQL assistance of the editors, so the text of the prompt is native
/// text: it takes paste, selection and the cursor gestures of touch screens. The shell decides what a prompt does.
export function ShellView(props: ShellViewProps): React.ReactElement {
    const { shell } = props;
    const [entries, setEntries] = React.useState<ShellFeedEntry[]>([]);
    const [cleared, setCleared] = React.useState(false);
    const nextEntryId = React.useRef(1);
    const [running, setRunning] = React.useState(false);
    const [isCommand, setIsCommand] = React.useState(false);
    const [view, setView] = React.useState<EditorView | null>(null);

    // The handlers of the keys are created once, they read the current state through refs
    const shellRef = React.useRef(shell);
    shellRef.current = shell;
    const viewRef = React.useRef(view);
    viewRef.current = view;
    const propsRef = React.useRef(props);
    propsRef.current = props;
    const activeQuery = React.useRef<AbortController | null>(null);
    const pendingPrompts = React.useRef<string[]>([]);
    const editorUpdate = React.useRef<dashql.buffers.editor.EditorUpdateT | null>(null);

    // The prompt is a script session on the catalog of the shell, it is no script of a workbook
    const scriptSession = React.useMemo(() => shell?.core.createScriptSession(shell.catalog) ?? null, [shell]);
    React.useEffect(() => () => scriptSession?.destroy(), [scriptSession]);

    /// Append entries to the feed, returns their ids
    const append = React.useCallback((added: readonly ShellFeedEntryInput[]): number[] => {
        if (added.length === 0) return [];
        const withIds = added.map(entry => ({ ...entry, id: nextEntryId.current++ }) as ShellFeedEntry);
        setEntries(current => {
            const next = [...current, ...withIds];
            return next.length > SHELL_FEED_LIMIT ? next.slice(next.length - SHELL_FEED_LIMIT) : next;
        });
        return withIds.map(entry => entry.id);
    }, []);

    /// The records of an operation: a clear drops what came before
    const appendRecords = React.useCallback((records: readonly DashQLShellRecord[]) => {
        let clear = -1;
        records.forEach((record, i) => { if (record.kind === DashQLShellRecordKind.CLEAR) clear = i; });
        if (clear >= 0) {
            setEntries([]);
            setCleared(true);
        }
        append(records.slice(clear + 1).map(record => ({ type: 'record', kind: record.kind, text: record.text })));
    }, [append]);

    /// Replace the text of the prompt, a completion of the previous text ends
    const setPromptText = React.useCallback((text: string) => {
        const editor = viewRef.current;
        if (editor == null) return;
        editor.dispatch({
            changes: { from: 0, to: editor.state.doc.length, insert: text },
            selection: { anchor: text.length },
            effects: DashQLCompletionAbortEffect.of(null),
            scrollIntoView: true,
        });
    }, []);

    // Inserting a queued prompt never submits it, the user runs each with Enter
    const fillNextPrompt = React.useCallback(() => {
        if (activeQuery.current != null) return;
        const next = pendingPrompts.current.shift();
        if (next != null) setPromptText(next);
    }, [setPromptText]);

    const submit = React.useCallback(async (text: string) => {
        const executingShell = shellRef.current;
        if (executingShell == null || activeQuery.current != null || text.trim().length === 0) return;
        const command = executingShell.promptInfo(text).isCommand;
        append([{ type: 'statement', prompt: propsRef.current.prompt, text, editorUpdate: command ? null : editorUpdate.current }]);
        setPromptText('');
        const abort = new AbortController();
        activeQuery.current = abort;
        setRunning(true);
        const stillCurrent = () => shellRef.current === executingShell && activeQuery.current === abort;
        let progressId: number | null = null;
        const onProgress = (message: string) => {
            if (!stillCurrent()) return;
            if (progressId == null) {
                [progressId] = append([{ type: 'progress', message }]);
            } else {
                const id = progressId;
                setEntries(current => current.map(entry => entry.id === id && entry.type === 'progress' ? { ...entry, message } : entry));
            }
        };
        let result: { queryId: number; inFeed: boolean } | null = null;
        let records: DashQLShellRecord[];
        try {
            records = await executingShell.submit(text, abort.signal, onProgress, (queryId, _rowCount, inFeed) => {
                if (stillCurrent()) result = { queryId, inFeed };
            });
        } catch (error) {
            records = [{ kind: DashQLShellRecordKind.ERROR, text: stringifyError(error) }];
        }
        const current = stillCurrent();
        if (activeQuery.current === abort) activeQuery.current = null;
        setRunning(activeQuery.current != null);
        if (progressId != null) {
            const id = progressId;
            setEntries(entries => entries.filter(entry => entry.id !== id));
        }
        if (!current) return;
        appendRecords(records);
        const reported = result as { queryId: number; inFeed: boolean } | null;
        if (reported != null) propsRef.current.onQueryResult?.(reported.queryId, reported.inFeed);
        fillNextPrompt();
    }, [append, appendRecords, fillNextPrompt, setPromptText]);

    // A new shell continues the feed, a query of the old one ends
    React.useEffect(() => () => {
        activeQuery.current?.abort();
        activeQuery.current = null;
        pendingPrompts.current = [];
        setRunning(false);
    }, [shell]);

    // Fit the tables of results to the width of the feed
    const feedRef = React.useRef<HTMLDivElement>(null);
    const measureRef = React.useRef<HTMLSpanElement>(null);
    React.useEffect(() => {
        const feed = feedRef.current;
        const measure = measureRef.current;
        if (shell == null || feed == null || measure == null) return;
        const resize = () => {
            const characterWidth = measure.getBoundingClientRect().width / 10;
            if (characterWidth <= 0 || feed.clientWidth === 0) return;
            shell.resize(Math.max(MIN_TABLE_COLUMNS, Math.floor(feed.clientWidth / characterWidth) - 2));
        };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(feed);
        return () => observer.disconnect();
    }, [shell]);

    // The feed and the prompt below it stick to the end unless the user scrolled up
    const feedContentRef = React.useRef<HTMLDivElement>(null);
    const atEnd = React.useRef(true);
    const onScroll = () => {
        const feed = feedRef.current;
        if (feed != null) atEnd.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 8;
    };
    const stickToEnd = React.useCallback(() => {
        const feed = feedRef.current;
        if (feed != null && atEnd.current) feed.scrollTop = feed.scrollHeight;
    }, []);
    React.useLayoutEffect(stickToEnd, [entries, stickToEnd]);
    // A keyboard that opens shrinks the feed, a prompt of several lines grows it
    React.useEffect(() => {
        const feed = feedRef.current;
        const content = feedContentRef.current;
        if (feed == null || content == null) return;
        const observer = new ResizeObserver(stickToEnd);
        observer.observe(feed);
        observer.observe(content);
        return () => observer.disconnect();
    }, [stickToEnd]);

    // The keys of the shell, below the keys of a completion
    const keys = React.useMemo<KeyBinding[]>(() => {
        const text = (editor: EditorView) => editor.state.doc.toString();
        const browse = (editor: EditorView, direction: 'previous' | 'next') => {
            const current = shellRef.current;
            const selection = editor.state.selection.main;
            if (current == null || !selection.empty) return false;
            const line = editor.state.doc.lineAt(selection.head);
            if (direction === 'previous' ? line.number !== 1 : line.number !== editor.state.doc.lines) return false;
            const entry = direction === 'previous' ? current.historyPrevious(text(editor)) : current.historyNext(text(editor));
            if (entry != null) setPromptText(entry);
            return true;
        };
        const exit = () => {
            const onExit = propsRef.current.onExit;
            if (onExit == null) return false;
            onExit();
            return true;
        };
        return [
            {
                key: 'Enter',
                run: editor => {
                    const current = shellRef.current;
                    if (current == null) return true;
                    // While a query runs the next prompt can be written, not run
                    if (activeQuery.current != null) return true;
                    const prompt = text(editor);
                    if (current.promptInfo(prompt).isComplete) {
                        void submit(prompt);
                        return true;
                    }
                    return prompt.trim().length === 0 ? true : insertNewlineAndIndent(editor);
                },
            },
            { key: 'Mod-Enter', run: editor => { void submit(text(editor)); return true; } },
            { key: 'ArrowUp', run: editor => browse(editor, 'previous') },
            { key: 'ArrowDown', run: editor => browse(editor, 'next') },
            { key: 'Ctrl-p', run: editor => browse(editor, 'previous') || true },
            { key: 'Ctrl-n', run: editor => browse(editor, 'next') || true },
            {
                key: 'Tab',
                run: editor => {
                    const current = shellRef.current;
                    const prompt = text(editor);
                    if (current == null || !current.promptInfo(prompt).isCommand) return false;
                    const completion = current.completeCommand(prompt);
                    if (completion.text !== prompt) setPromptText(completion.text);
                    if (completion.candidates.length > 0) {
                        append([{ type: 'record', kind: DashQLShellRecordKind.STATUS, text: completion.candidates.join('  ') }]);
                    }
                    return true;
                },
            },
            {
                // Ctrl+C copies a selection, otherwise it cancels the query or clears the prompt like in a terminal
                key: 'Ctrl-c',
                run: editor => {
                    if (activeQuery.current != null) {
                        activeQuery.current.abort();
                        return true;
                    }
                    if (!editor.state.selection.main.empty) return false;
                    pendingPrompts.current = [];
                    setPromptText('');
                    return true;
                },
            },
            {
                key: 'Ctrl-l',
                run: () => {
                    setEntries([]);
                    setCleared(true);
                    return true;
                },
            },
            { key: 'Ctrl-d', run: editor => editor.state.doc.length === 0 ? exit() : false },
            { key: 'Escape', run: () => exit() },
        ];
    }, [append, setPromptText, submit]);

    // The prompt of a dot command gets no SQL assistance
    const onTextChange = React.useCallback((text: string) => {
        setIsCommand(shellRef.current?.promptInfo(text).isCommand ?? false);
    }, []);
    const onEditorUpdate = React.useCallback((update: dashql.buffers.editor.EditorUpdateT) => {
        editorUpdate.current = update;
    }, []);

    React.useImperativeHandle(props.controller, () => ({
        focus: () => viewRef.current?.focus(),
        writeStatus: message => append([{ type: 'record', kind: DashQLShellRecordKind.STATUS, text: message }]),
        queuePrompts: prompts => {
            pendingPrompts.current = [...prompts];
            fillNextPrompt();
        },
    }), [append, fillNextPrompt]);

    // The prompt shows once the shell is ready, with a prompt that was queued before
    React.useEffect(() => {
        if (view != null && view.state.doc.length === 0) fillNextPrompt();
    }, [view, fillNextPrompt]);

    // The prompt takes the focus once the shell is ready. Not on a touch screen, the keyboard would cover the feed.
    React.useEffect(() => {
        if (shell == null || view == null || window.matchMedia?.('(pointer: coarse)').matches) return;
        if (propsRef.current.mayFocus?.() ?? true) view.focus();
    }, [shell, view]);

    // A click into the feed that selects nothing goes to the prompt. A touch doesn't, it would open the keyboard.
    const lastPointer = React.useRef('mouse');
    const focusPrompt = (event: React.MouseEvent) => {
        if (lastPointer.current === 'touch' || viewRef.current?.dom.contains(event.target as Node)) return;
        if (window.getSelection()?.isCollapsed ?? true) viewRef.current?.focus();
    };

    // The editable element of CodeMirror is the input of the shell
    React.useEffect(() => {
        view?.contentDOM.setAttribute('aria-label', props.inputAriaLabel);
    }, [view, props.inputAriaLabel]);

    // The keys of the key bar act on the prompt like the keys of a keyboard
    const press = (key: 'Tab' | 'ArrowUp' | 'ArrowDown' | 'Ctrl-c' | 'Mod-Enter') => {
        const editor = viewRef.current;
        if (editor == null) return;
        if (key === 'Tab') {
            const handled = keys.find(binding => binding.key === 'Tab')?.run?.(editor) ?? false;
            if (!handled) editor.dispatch({ effects: DashQLCompletionStartEffect.of(null) });
        } else {
            keys.find(binding => binding.key === key)?.run?.(editor);
        }
        editor.focus();
    };
    // A key of the key bar keeps the focus in the prompt, the keyboard of a touch screen stays open
    const keepFocus = (event: React.PointerEvent) => event.preventDefault();

    return (
        <div className={classNames(styles.root, props.className)}>
            <div
                ref={feedRef}
                className={styles.feed}
                onScroll={onScroll}
                onPointerDown={event => { lastPointer.current = event.pointerType; }}
                onClick={focusPrompt}
            >
                <div ref={feedContentRef} className={styles.feed_content}>
                    <div className={styles.feed_entries} role="log" aria-label="Shell output">
                        {!cleared && props.greeter != null && props.greeter.length > 0 && (
                            <div className={styles.greeter}>
                                {props.greeter.map((line, i) => i === 0 ? <strong key={i}>{line}</strong> : <div key={i}>{line}</div>)}
                            </div>
                        )}
                        {entries.map(entry => <ShellFeedRow key={entry.id} entry={entry} />)}
                    </div>
                    {shell != null && <div className={styles.prompt_bar} data-running={running || undefined}>
                        <span className={styles.prompt_label} aria-hidden="true">{props.prompt.trimEnd()}</span>
                        <div className={styles.prompt_input} data-testid="shell-prompt">
                            <PromptEditor
                                className={styles.prompt_editor}
                                scriptSession={scriptSession}
                                placeholder=""
                                keywordCase={props.keywordCase}
                                assist={isCommand ? NO_ASSIST : undefined}
                                keys={keys}
                                onTextChange={onTextChange}
                                onEditorUpdate={onEditorUpdate}
                                setView={setView}
                            />
                        </div>
                    </div>}
                </div>
                <span ref={measureRef} className={styles.measure} aria-hidden="true">0000000000</span>
            </div>
            {shell != null && <div className={styles.key_bar} role="toolbar" aria-label="Shell keys">
                <button type="button" onPointerDown={keepFocus} onClick={() => press('Tab')}>Tab</button>
                <button type="button" onPointerDown={keepFocus} onClick={() => press('ArrowUp')} aria-label="Previous prompt">↑</button>
                <button type="button" onPointerDown={keepFocus} onClick={() => press('ArrowDown')} aria-label="Next prompt">↓</button>
                <button type="button" onPointerDown={keepFocus} onClick={() => press('Ctrl-c')} aria-label="Cancel">^C</button>
                <button type="button" className={styles.key_run} onPointerDown={keepFocus} onClick={() => press('Mod-Enter')}>Run</button>
            </div>}
        </div>
    );
}

/// An entry of the feed without its id
type ShellFeedEntryInput = ShellFeedEntry extends infer E ? E extends ShellFeedEntry ? Omit<E, 'id'> : never : never;

const ShellFeedRow = React.memo(function ShellFeedRow({ entry }: { entry: ShellFeedEntry }) {
    switch (entry.type) {
        case 'statement':
            return (
                <div className={styles.statement} data-testid="shell-statement">
                    <span className={styles.prompt_label}>{entry.prompt.trimEnd()}</span>
                    <div className={styles.statement_text}>
                        {entry.editorUpdate == null
                            ? <pre>{entry.text}</pre>
                            : <ReadonlySqlView text={entry.text} editorUpdate={entry.editorUpdate} lineWrapping autoHeight textOnly />}
                    </div>
                </div>
            );
        case 'progress':
            return <ShellProgress message={entry.message} />;
        case 'record':
            return (
                <pre
                    className={classNames(styles.record, {
                        [styles.record_status]: entry.kind === DashQLShellRecordKind.STATUS,
                        [styles.record_error]: entry.kind === DashQLShellRecordKind.ERROR,
                        [styles.record_table]: entry.kind === DashQLShellRecordKind.TABLE,
                    })}
                    data-kind={DashQLShellRecordKind[entry.kind].toLowerCase()}
                >
                    {entry.text}
                </pre>
            );
    }
});

/// The progress of a running query with a spinner
function ShellProgress({ message }: { message: string }) {
    const [frame, setFrame] = React.useState(0);
    React.useEffect(() => {
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        const timer = setInterval(() => setFrame(f => (f + 1) % SPINNER_FRAMES.length), SPINNER_INTERVAL_MS);
        return () => clearInterval(timer);
    }, []);
    return (
        <pre className={classNames(styles.record, styles.record_progress)} data-kind="progress">
            {SPINNER_FRAMES[frame]} {message}
        </pre>
    );
}
