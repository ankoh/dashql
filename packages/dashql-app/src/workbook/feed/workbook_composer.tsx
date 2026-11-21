import * as React from 'react';
import * as core from '@akohn/dashql';
import * as styles from './workbook_composer.module.css';

import type { EditorView } from '@codemirror/view';

import { ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { TextArea } from '@akohn/dashql-react/components/text_input';
import { CopyToClipboardAction, TextInputAction } from '@akohn/dashql-react/components/text_input_action';
import { SegmentedControl, SegmentedControlSize } from '@akohn/dashql-react/components/segmented_control';
import { CodeIcon, PaperAirplaneIcon, SymbolIcon, SyncIcon } from '@akohn/dashql-react/components/symbol_icon';
import { agentConnectCommandLines, ComposerMode, type ConnectHarness } from '../../agent/agent_connect.js';
import type { AgentConnect } from '../../agent/agent_session_provider.js';
import type { AgentSessionOutdated } from '@akohn/dashql/platform/session/agent_session_protocol';
import { PromptEditor } from '../editor/prompt_editor.js';
import { DashQLCompletionAbortEffect } from '../editor/dashql_processor.js';
import { insertMentionAtCursor } from '../editor/editor_focus.js';
import { SCRIPT_REFERENCE_PREFIX } from './script_references.js';
import { harnessLabel, type AgentSession } from '../../agent/agent_session.js';
import { SnippetsOverlay } from '../snippets/snippets_overlay.js';
import { ExecuteConnectionGuard, WorkbookConnectionAttentionContext } from '../connections/workbook_connection_attention.js';
import { WorkbookInputCard } from '../inputs/workbook_input_card.js';
import { collectDraftInputs, sameInputs, workbookInputLiteral, type WorkbookInput } from '@akohn/dashql/platform/workbook/workbook_inputs';
import type { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import type { SnippetRegistry } from '../snippets/snippet_registry.js';

/// The table parameters of a workbook for a session that is no script of it
export interface WorkbookTableParameters {
    /// Give the table parameters to a session, returns whether its analysis is outdated by them
    attach(session: core.DashQLScriptSession): boolean;
}

/// A composer without workbook scripts
const NO_SCRIPT_NAMES: readonly string[] = [];

/// A draft without inputs
const NO_INPUTS: WorkbookInput[] = [];

const SparklesFillIcon = SymbolIcon('sparkles_fill_16');

/// The status of the line to connect while the page waits for the session. A server of another protocol answers: the
/// command runs an older dashql-cli, or the page is older than dashql-cli.
function connectStatus(outdated: AgentSessionOutdated | null): string {
    switch (outdated) {
        case 'server': return 'The session runs an older dashql-cli, stop it and run the command again';
        case 'client': return 'The session runs a newer dashql-cli than this page, reload the page';
        case null: return 'Run the command in the folder of your project, the session shows here';
    }
}

/// The harnesses of the line to connect, in the order of their switch
const CONNECT_HARNESSES: ConnectHarness[] = ['claude', 'codex'];

/// The parts of the prompt that handle a click themselves: the editor places its cursor, the controls act
const PROMPT_CONTROLS = '.cm-editor, button, a, input, select, textarea, [role="button"]';

/// Where the composer is shown
export enum WorkbookComposerVariant {
    /// Docked below the feed of a workbook with scripts
    Docked,
    /// Centered on the landing view of an empty workbook
    Hero,
}

export interface WorkbookComposerProps {
    /// The DashQL instance that creates the draft workbook
    instance: core.DashQL;
    /// The connection catalog the draft is analyzed and completed against
    catalog: core.DashQLCatalog;
    /// Where the composer is shown
    variant: WorkbookComposerVariant;
    /// The keyword case for completions
    keywordCase: core.buffers.formatting.KeywordCase;
    /// Is the agent working on a question of the workbook? The frame turns in the gradient of the agent then.
    agentWorking?: boolean;
    /// The session of an agent in the terminal that the page follows
    session?: AgentSession | null;
    /// The mode of the prompt and the line that connects an agent in the terminal, no switch to AI without
    connect?: AgentConnect | null;
    /// Called with the draft when the user sends it, the draft is cleared before
    onSend: (text: string) => void;
    /// Called with whether the draft is blank, once on mount and whenever that changes
    onDraftEmptyChange?: (empty: boolean) => void;
    /// The bar above the editor, e.g. the bar of Wobble. The inputs of a SQL draft follow it, the bar is hidden
    /// while it is empty.
    bar?: React.ReactNode;
    /// Receives the editor view once it is mounted
    setView?: (view: EditorView | null) => void;
    /// Receives the send function of the composer, e.g. for global key bindings
    submitRef?: React.RefObject<(() => void) | null>;
    /// The display names of the workbook scripts that the draft can reference
    scriptNames?: readonly string[];
    /// Receives the function that references a workbook script in the draft, by its display name
    targetScriptRef?: React.RefObject<((name: string) => void) | null>;
    /// The results of the workbook scripts, the table parameters of the draft read them
    tableParameters?: WorkbookTableParameters | null;
    /// Receives the function that renames the references to a workbook script in the draft, by display names
    renameScriptRef?: React.RefObject<((from: string, to: string) => void) | null>;
    /// Picks the connection that the draft runs on
    connectionPicker?: React.ReactNode;
    /// Picks the connections that the agent may use, in place of the connection picker in AI
    agentConnectionsPicker?: React.ReactNode;
    /// The workbook of the draft, set while the connection of the draft is not connected.
    /// A SQL draft is not sent then, the connections of the workbook ask for attention instead.
    offlineWorkbookId?: string | null;
    /// The connector of the draft, the composer offers the snippets that run on it
    snippetConnector?: ConnectorType;
    /// The snippets to browse, the bundled ones by default
    snippetRegistry?: SnippetRegistry;
}

/// A change of the text of a draft
type DraftChange = { from: number; to: number; insert: string };

/// The changes that rename the references to a script in a SQL draft: the table parameters of its analysis that find
/// the script among the names before the rename, like the planner does. String literals and comments keep their text.
/// `names` are the display names of the workbook scripts, before or after the rename.
export function renameSqlDraftReferences(workbook: core.DashQLScriptSession, names: readonly string[], from: string, to: string, instance: core.DashQL): DraftChange[] {
    const before = names.map(name => name === to ? from : name);
    if (!before.includes(from)) before.push(from);
    const renamed = before.indexOf(from);
    const insert = `${SCRIPT_REFERENCE_PREFIX}${instance.quoteIdentifier(to)}`;
    return workbook.findScriptReferences(before)
        .filter(reference => reference.script === renamed)
        .map(reference => ({ from: reference.from, to: reference.to, insert }));
}

/// Takes the draft out of a composer editor and clears it, returns null when the draft is blank
export function takeComposerDraft(view: EditorView): string | null {
    const text = view.state.doc.toString();
    if (text.trim().length === 0) {
        return null;
    }
    // Drop an open completion together with the text it points into
    view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: '' },
        effects: DashQLCompletionAbortEffect.of(null),
    });
    return text;
}

/// A chat-like input that turns its SQL draft into a new workbook script.
///
/// The draft lives in its own script session on the connection catalog. It provides completion and tells SQL
/// from natural language, but it is not a workbook script: it is neither persisted nor loaded into the catalog.
export const WorkbookComposer: React.FC<WorkbookComposerProps> = (props) => {
    // The draft workbook is created while rendering: the editor binds a new workbook in a layout effect,
    // before the effect below destroys the previous one.
    const scriptSession = React.useMemo(() => props.instance.createScriptSession(props.catalog), [props.instance, props.catalog]);
    React.useEffect(() => () => scriptSession.destroy(), [scriptSession]);
    // The draft reads the results of the workbook scripts, its next analysis completes their names after `:`.
    // Attaching the current results is cheap, the results change with any workbook script.
    React.useEffect(() => {
        props.tableParameters?.attach(scriptSession);
    });

    const [view, setView] = React.useState<EditorView | null>(null);
    const [empty, setEmpty] = React.useState(true);
    const { setView: forwardView, onDraftEmptyChange, onSend } = props;
    const handleView = React.useCallback((next: EditorView | null) => {
        setView(next);
        forwardView?.(next);
    }, [forwardView]);

    const scriptNames = props.scriptNames ?? NO_SCRIPT_NAMES;
    const handleTextChange = React.useCallback((text: string) => {
        setEmpty(text.trim().length === 0);
    }, []);
    React.useEffect(() => onDraftEmptyChange?.(empty), [empty, onDraftEmptyChange]);
    // The inputs of the draft follow its analysis, a cursor move changes nothing
    const [draftInputs, setDraftInputs] = React.useState(NO_INPUTS);
    const handleEditorUpdate = React.useCallback((update: core.buffers.editor.EditorUpdateT) => {
        if (!update.analysisUpdated) return;
        const next = collectDraftInputs(props.instance, scriptSession, props.catalog);
        setDraftInputs(previous => sameInputs(previous, next) ? previous : next);
    }, [props.instance, props.catalog, scriptSession]);
    // The value of an input of the draft is a `@param` tag of the draft like in a script, it goes along when the draft
    // is sent. Nothing runs before that.
    const literalOfDraftInput = React.useCallback((draftInput: WorkbookInput, value: string) => workbookInputLiteral(props.instance, draftInput.type, value), [props.instance]);
    const commitDraftInput = React.useCallback((name: string, literal: string) => {
        if (view == null) return;
        const from = view.state.doc.toString();
        let to: string;
        try {
            to = scriptSession.rewriteParamTag(name, literal);
        } catch (e) {
            console.warn('cannot write the value of an input of the draft', e);
            return;
        }
        if (to === from) return;
        view.dispatch({ changes: props.instance.textChange(from, to), effects: DashQLCompletionAbortEffect.of(null) });
    }, [view, scriptSession, props.instance]);

    // The connection of a SQL draft has to be connected first, the draft stays until it is
    const connectionAttention = React.useContext(WorkbookConnectionAttentionContext);
    const offlineWorkbookId = props.offlineWorkbookId ?? null;
    const inputsRef = React.useRef<HTMLDivElement>(null);
    // In AI, the agent in the terminal writes the scripts: the prompt keeps its draft but takes nothing
    const ai = props.connect?.mode === ComposerMode.Ai;
    const send = React.useCallback(() => {
        if (view == null || ai) return;
        if (offlineWorkbookId != null) {
            connectionAttention?.request();
            return;
        }
        // A card writes a typed value when it loses the focus, the value goes along
        const active = document.activeElement;
        if (active instanceof HTMLElement && inputsRef.current?.contains(active)) active.blur();
        const text = takeComposerDraft(view);
        if (text != null) {
            onSend(text);
        }
    }, [onSend, view, ai, offlineWorkbookId, connectionAttention]);
    // A snippet replaces the draft right away, there is no script yet whose text could be compared
    const applySnippet = React.useCallback((text: string) => {
        if (view == null) return;
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: text },
            selection: { anchor: text.length },
            effects: DashQLCompletionAbortEffect.of(null),
        });
        view.focus();
    }, [view]);
    const handleSendClick = React.useCallback(() => {
        send();
        view?.focus();
    }, [send, view]);
    // The prompt looks like one input, a click on its background focuses the editor and keeps the cursor where it is
    const handlePromptMouseDown = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target;
        if (view == null || event.button !== 0 || !(target instanceof Element)) return;
        // The overlays of the controls are portals, their events still bubble through here
        if (!event.currentTarget.contains(target)) return;
        if (target.closest(PROMPT_CONTROLS) != null) {
            // A card writes a typed value when it loses the focus. The tag can grow the draft and move the control away
            // from under the pointer before the button is released, which would lose the click: the card keeps the focus.
            if (target.closest('.cm-editor') == null && inputsRef.current?.contains(document.activeElement)) event.preventDefault();
            return;
        }
        // The browser would move the focus to the body after this event
        event.preventDefault();
        view.focus();
    }, [view]);
    if (props.submitRef) {
        props.submitRef.current = send;
    }
    // A script reference goes into the SQL of the draft as a table parameter
    const targetScript = React.useCallback((name: string) => {
        if (view == null) return;
        insertMentionAtCursor(view, `${SCRIPT_REFERENCE_PREFIX}${props.instance.quoteIdentifier(name)}`);
        view.focus();
    }, [view, props.instance]);
    if (props.targetScriptRef) {
        props.targetScriptRef.current = targetScript;
    }
    // The references of the draft follow a renamed script, through its analysis
    const renameScript = React.useCallback((from: string, to: string) => {
        if (view == null) return;
        const changes = renameSqlDraftReferences(scriptSession, scriptNames, from, to, props.instance);
        if (changes.length > 0) {
            view.dispatch({ changes, effects: DashQLCompletionAbortEffect.of(null), userEvent: 'input' });
        }
    }, [view, scriptSession, scriptNames, props.instance]);
    if (props.renameScriptRef) {
        props.renameScriptRef.current = renameScript;
    }

    // The landing view is all about the prompt, focus it right away
    const hero = props.variant === WorkbookComposerVariant.Hero;
    const focusHero = React.useEffectEvent((view: EditorView | null) => {
        if (hero) view?.focus();
    });
    React.useEffect(() => focusHero(view), [view]);

    const session = props.session != null && props.session.connected ? props.session : null;
    const showDraftInputs = !ai && draftInputs.length > 0;
    const blockedWorkbookId = offlineWorkbookId;
    const blocked = blockedWorkbookId != null;
    // A blocked button stays clickable, it pulses the connections that are not connected
    const sendButton = (
        <IconButton
            variant={hero && !blocked ? ButtonVariant.Primary : ButtonVariant.Default}
            size={ButtonSize.Small}
            aria-label={blocked ? 'Connect to run' : 'Run query'}
            data-testid="composer-send"
            tooltipDirection="n"
            data-connect={blocked ? '' : undefined}
            disabled={empty && !blocked}
            onClick={handleSendClick}
        >
            <PaperAirplaneIcon />
        </IconButton>
    );
    const placeholder = hero ? 'select * from ...' : 'Write a query, press Enter to run it and Shift+Enter for a new line';
    const connect = props.connect ?? null;
    const handleModeChange = React.useCallback((index: number) => {
        connect?.setMode(index === 0 ? ComposerMode.Sql : ComposerMode.Ai);
    }, [connect]);
    const handleHarnessChange = React.useCallback((index: number) => {
        connect?.setHarness(CONNECT_HARNESSES[index]);
    }, [connect]);
    // Shown with every option on an indented line of its own, continued with backslashes so that a selection pastes
    // into a POSIX shell, the copy button copies one line
    const commandLines = ai && connect?.target != null ? agentConnectCommandLines(connect.harness, connect.target) : null;
    const command = commandLines?.join(' ') ?? null;
    const commandText = commandLines?.map((line, i) => i == 0 ? line : `  ${line}`).join(' \\\n') ?? '';
    // The port and secret of the command, for the page tests that connect without reading the text
    const connectPort = connect?.target != null ? new URL(connect.target.endpoint).port : undefined;
    const statusId = React.useId();
    return (
        <div
            className={styles.composer}
            data-variant={hero ? 'hero' : 'docked'}
            data-mode={ai ? 'ai' : 'sql'}
            data-agent={props.agentWorking ? 'working' : undefined}
        >
            {/* Empty without the bar of Wobble and inputs of the draft, the stylesheet hides it then */}
            <div className={styles.composer_bar} data-testid="composer-bar">
                {props.bar}
                {showDraftInputs && (
                    <div ref={inputsRef} className={styles.composer_inputs} role="group" aria-label="Inputs of the prompt" data-testid="composer-inputs">
                        {draftInputs.map(draftInput => (
                            <WorkbookInputCard key={draftInput.name} input={draftInput} literalOf={literalOfDraftInput} onCommit={commitDraftInput} />
                        ))}
                    </div>
                )}
            </div>
            <div className={styles.composer_prompt} onMouseDown={ai ? undefined : handlePromptMouseDown}>
                {/* The line of the agent takes the place of the editor in AI, the editor keeps the draft for SQL */}
                <div hidden={ai}>
                    <PromptEditor
                        className={styles.composer_editor}
                        scriptSession={scriptSession}
                        placeholder={placeholder}
                        keywordCase={props.keywordCase}
                        readOnly={ai}
                        onSubmit={send}
                        onTextChange={handleTextChange}
                        onEditorUpdate={handleEditorUpdate}
                        setView={handleView}
                    />
                </div>
                {ai && connect != null && (
                    <div className={styles.composer_connect} role="group" aria-label="Connect an agent in the terminal" data-testid="composer-connect" data-port={connectPort} data-secret={connect.target?.token}>
                        <div id={statusId} className={styles.composer_connect_status} role="status" data-testid="composer-connect-status">
                            {session != null
                                ? `${harnessLabel(session.harness)} works on this workbook in the terminal, switch to SQL to edit the scripts yourself`
                                : connectStatus(connect.outdated)}
                        </div>
                        {/* The command is only copied, the buttons stay usable */}
                        <TextArea
                            className={styles.composer_connect_command}
                            block
                            disabled
                            rows={commandLines?.length ?? 1}
                            value={commandText}
                            aria-label="Command"
                            aria-describedby={statusId}
                            data-testid="composer-connect-command"
                            leadingAction={
                                <TextInputAction aria-label="Use a new port" aria-labelledby="" data-testid="composer-connect-renew" onClick={connect.renewTarget}>
                                    <SyncIcon />
                                </TextInputAction>
                            }
                            trailingAction={<CopyToClipboardAction value={command ?? ''} logContext="composer" ariaLabel="Copy the command" testId="composer-connect-copy" />}
                        />
                    </div>
                )}
                <div className={styles.composer_action_bar}>
                    {connect != null && (
                        <SegmentedControl aria-label="Input mode" size={SegmentedControlSize.Small} onChange={handleModeChange}>
                            <SegmentedControl.Button leadingVisual={CodeIcon} selected={!ai} data-testid="composer-mode" data-mode="sql">
                                SQL
                            </SegmentedControl.Button>
                            <SegmentedControl.Button leadingVisual={SparklesFillIcon} selected={ai} data-testid="composer-mode" data-mode="ai">
                                AI
                            </SegmentedControl.Button>
                        </SegmentedControl>
                    )}
                    {/* In AI the switch of the harness takes the place of the snippets and Run, the connections stay left of it */}
                    {ai && connect != null ? (
                        <div className={styles.composer_trailing_actions}>
                            {props.agentConnectionsPicker ?? props.connectionPicker}
                            <SegmentedControl aria-label="Harness" size={SegmentedControlSize.Small} onChange={handleHarnessChange}>
                                <SegmentedControl.Button selected={connect.harness === 'claude'} data-testid="composer-connect-harness" data-harness="claude">
                                    Claude Code
                                </SegmentedControl.Button>
                                <SegmentedControl.Button selected={connect.harness === 'codex'} data-testid="composer-connect-harness" data-harness="codex">
                                    Codex
                                </SegmentedControl.Button>
                            </SegmentedControl>
                        </div>
                    ) : (
                        <div className={styles.composer_trailing_actions}>
                            {props.connectionPicker}
                            {props.snippetConnector != null && (
                                <SnippetsOverlay
                                    scriptName="the prompt"
                                    connectorType={props.snippetConnector}
                                    disabled={view == null}
                                    onApply={applySnippet}
                                    registry={props.snippetRegistry}
                                    testId="composer-snippets"
                                />
                            )}
                            {blockedWorkbookId != null
                                ? <ExecuteConnectionGuard blocked>{sendButton}</ExecuteConnectionGuard>
                                : sendButton}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
