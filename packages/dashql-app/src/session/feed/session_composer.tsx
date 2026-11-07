import * as React from 'react';
import * as core from '@ankoh/dashql-core';
import * as styles from './session_composer.module.css';

import { createPortal } from 'react-dom';
import type { EditorView } from '@codemirror/view';

import { ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { SegmentedControl, SegmentedControlSize } from '../../ui/foundations/segmented_control.js';
import { CodeIcon, PaperAirplaneIcon, SymbolIcon } from '../../ui/foundations/symbol_icon.js';
import { PromptEditor } from '../editor/prompt_editor.js';
import { DashQLCompletionAbortEffect } from '../editor/dashql_processor.js';
import { insertMentionAtCursor } from '../editor/editor_focus.js';
import { ComposerInputMode } from '../../agent/input_mode.js';
import { useComposerInputMode } from '../../agent/use_composer_input_mode.js';
import { findScriptReferences, renderScriptReference, SCRIPT_REFERENCE_PREFIX } from '../../agent/script_references.js';
import { SnippetsOverlay } from '../snippets/snippets_overlay.js';
import { AgentPromptPanel, isAgentWorking, type ComposerAgent } from '../../agent/agent_prompt_panel.js';
import { ExecuteConnectionGuard, SessionConnectionAttentionContext } from '../session_connection_attention.js';
import { SessionInputCard } from '../inputs/session_input_card.js';
import { collectDraftInputs, sameInputs, sessionInputLiteral, type SessionInput } from '../inputs/session_inputs.js';
import { textChange } from '../scripts/session_scripts.js';
import type { ConnectorType } from '../../connections/connector_info.js';
import type { SnippetRegistry } from '../snippets/snippet_registry.js';

const SparklesFillIcon = SymbolIcon('sparkles_fill_16');

/// A composer without session scripts
const NO_SCRIPT_NAMES: readonly string[] = [];

/// A draft without inputs
const NO_INPUTS: SessionInput[] = [];

/// The parts of the prompt that handle a click themselves: the editor places its cursor, the controls act
const PROMPT_CONTROLS = '.cm-editor, button, a, input, select, textarea, [role="button"]';

/// Where the composer is shown
export enum SessionComposerVariant {
    /// Docked below the feed of a session with scripts
    Docked,
    /// Centered on the landing view of an empty session
    Hero,
}

export interface SessionComposerProps {
    /// The DashQL instance that creates the draft session
    instance: core.DashQL;
    /// The connection catalog the draft is analyzed and completed against
    catalog: core.DashQLCatalog;
    /// Where the composer is shown
    variant: SessionComposerVariant;
    /// The keyword case for completions
    keywordCase: core.buffers.formatting.KeywordCase;
    /// Can the session ask the agent? Without agent access, the composer only takes SQL.
    aiAvailable: boolean;
    /// The agent of a session with agent access, shown on top of the prompt
    agent?: ComposerAgent | null;
    /// Called with the draft and its input mode when the user sends it, the draft is cleared before
    onSend: (text: string, mode: ComposerInputMode) => void;
    /// Called with whether the draft is blank, once on mount and whenever that changes
    onDraftEmptyChange?: (empty: boolean) => void;
    /// The element that shows the cards of the inputs of a SQL draft, the composer shows no cards without it
    inputsContainer?: HTMLElement | null;
    /// Receives the editor view once it is mounted
    setView?: (view: EditorView | null) => void;
    /// Receives the send function of the composer, e.g. for global key bindings
    submitRef?: React.RefObject<(() => void) | null>;
    /// The display names of the session scripts that a question can reference
    scriptNames?: readonly string[];
    /// Receives the function that references a session script in a question, by its display name
    targetScriptRef?: React.RefObject<((name: string) => void) | null>;
    /// The results of the session scripts, the table parameters of the draft read them
    tableParameters?: core.DashQLTableParameters | null;
    /// Receives the function that renames the references to a session script in the draft, by display names
    renameScriptRef?: React.RefObject<((from: string, to: string) => void) | null>;
    /// Picks the connection that the draft runs on
    connectionPicker?: React.ReactNode;
    /// The session of the draft, set while the connection of the draft is not connected.
    /// A SQL draft is not sent then, the connections of the session ask for attention instead.
    offlineSessionId?: string | null;
    /// The connector of the draft, the composer offers the snippets that run on it
    snippetConnector?: ConnectorType;
    /// The snippets to browse, the bundled ones by default
    snippetRegistry?: SnippetRegistry;
}

/// A change of the text of a draft
type DraftChange = { from: number; to: number; insert: string };

/// The changes that rename the references to a script in a SQL draft: the table parameters of its analysis that find
/// the script among the names before the rename, like the planner does. String literals and comments keep their text.
/// `names` are the display names of the session scripts, before or after the rename.
export function renameSqlDraftReferences(session: core.DashQLScriptSession, names: readonly string[], from: string, to: string, instance: core.DashQL): DraftChange[] {
    const before = names.map(name => name === to ? from : name);
    if (!before.includes(from)) before.push(from);
    const renamed = before.indexOf(from);
    const insert = `${SCRIPT_REFERENCE_PREFIX}${instance.quoteIdentifier(to)}`;
    return session.findScriptReferences(before)
        .filter(reference => reference.script === renamed)
        .map(reference => ({ from: reference.from, to: reference.to, insert }));
}

/// The changes that rename the references to a script in a question, `:from` becomes `:to`
export function renameQuestionReferences(text: string, from: string, to: string): DraftChange[] {
    return findScriptReferences([from], text).map(reference => ({ from: reference.from, to: reference.to, insert: renderScriptReference(to) }));
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

/// A chat-like input that turns its draft into a new session script.
///
/// The draft is either SQL or a question in natural language that the agent answers in SQL,
/// see useComposerInputMode.
///
/// The draft lives in its own script session on the connection catalog. It provides completion and tells SQL
/// from natural language, but it is not a session script: it is neither persisted nor loaded into the catalog.
export const SessionComposer: React.FC<SessionComposerProps> = (props) => {
    // The draft session is created while rendering: the editor binds a new session in a layout effect,
    // before the effect below destroys the previous one.
    const scriptSession = React.useMemo(() => props.instance.createScriptSession(props.catalog), [props.instance, props.catalog]);
    React.useEffect(() => () => scriptSession.destroy(), [scriptSession]);
    // The draft reads the results of the session scripts, its next analysis completes their names after `:`.
    // Attaching the current results is cheap, the results change with any session script.
    React.useEffect(() => {
        props.tableParameters?.attach(scriptSession);
    });

    const [view, setView] = React.useState<EditorView | null>(null);
    const [empty, setEmpty] = React.useState(true);
    const handleView = React.useCallback((next: EditorView | null) => {
        setView(next);
        props.setView?.(next);
    }, [props.setView]);

    // The draft is SQL or natural language
    const scriptNames = props.scriptNames ?? NO_SCRIPT_NAMES;
    const input = useComposerInputMode(props.catalog, props.aiAvailable, scriptNames);
    const handleTextChange = React.useCallback((text: string) => {
        setEmpty(text.trim().length === 0);
        input.onTextChange(text);
    }, [input.onTextChange]);
    React.useEffect(() => props.onDraftEmptyChange?.(empty), [empty, props.onDraftEmptyChange]);
    // The inputs of the draft follow its analysis, a cursor move changes nothing
    const [draftInputs, setDraftInputs] = React.useState(NO_INPUTS);
    const handleEditorUpdate = React.useCallback((update: core.buffers.editor.EditorUpdateT) => {
        input.onEditorUpdate(update);
        if (!update.analysisUpdated) return;
        const next = collectDraftInputs(props.instance, scriptSession, props.catalog);
        setDraftInputs(previous => sameInputs(previous, next) ? previous : next);
    }, [input.onEditorUpdate, props.instance, props.catalog, scriptSession]);
    // The value of an input of the draft is a `@param` tag of the draft like in a script, it goes along when the draft
    // is sent. Nothing runs before that.
    const literalOfDraftInput = React.useCallback((draftInput: SessionInput, value: string) => sessionInputLiteral(props.instance, draftInput.type, value), [props.instance]);
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
        view.dispatch({ changes: textChange(from, to), effects: DashQLCompletionAbortEffect.of(null) });
    }, [view, scriptSession]);
    const handleModeChange = React.useCallback((index: number) => {
        input.pick(index === 0 ? ComposerInputMode.Sql : ComposerInputMode.Ai);
    }, [input.pick]);

    // The connection of a SQL draft has to be connected first, the draft stays until it is
    const connectionAttention = React.useContext(SessionConnectionAttentionContext);
    const offlineSessionId = props.offlineSessionId ?? null;
    const inputsRef = React.useRef<HTMLDivElement>(null);
    const send = React.useCallback(() => {
        if (view == null) return;
        const mode = input.resolveSendMode();
        if (mode === ComposerInputMode.Sql && offlineSessionId != null) {
            connectionAttention?.request(offlineSessionId);
            return;
        }
        // A card writes a typed value when it loses the focus, the value goes along
        const active = document.activeElement;
        if (active instanceof HTMLElement && inputsRef.current?.contains(active)) active.blur();
        const text = takeComposerDraft(view);
        if (text != null) {
            props.onSend(text, mode);
        }
    }, [props.onSend, view, input.resolveSendMode, offlineSessionId, connectionAttention]);
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
    // A script reference turns the draft into a question if the agent is available, a script that the question
    // references already is not repeated. Without the agent, the reference goes into the SQL of the draft.
    const targetScript = React.useCallback((name: string) => {
        if (view == null) return;
        if (props.aiAvailable) {
            input.pick(ComposerInputMode.Ai);
            if (findScriptReferences([name], view.state.doc.toString()).length === 0) {
                insertMentionAtCursor(view, renderScriptReference(name));
            }
        } else {
            insertMentionAtCursor(view, `:${props.instance.quoteIdentifier(name)}`);
        }
        view.focus();
    }, [view, props.aiAvailable, props.instance, input.pick]);
    if (props.targetScriptRef) {
        props.targetScriptRef.current = targetScript;
    }
    // The references of the draft follow a renamed script. A question has no syntax tree, SQL is renamed through its
    // analysis.
    const renameScript = React.useCallback((from: string, to: string) => {
        if (view == null) return;
        const changes = input.mode === ComposerInputMode.Ai
            ? renameQuestionReferences(view.state.doc.toString(), from, to)
            : renameSqlDraftReferences(scriptSession, scriptNames, from, to, props.instance);
        if (changes.length > 0) {
            view.dispatch({ changes, effects: DashQLCompletionAbortEffect.of(null), userEvent: 'input' });
        }
    }, [view, input.mode, scriptSession, scriptNames, props.instance]);
    if (props.renameScriptRef) {
        props.renameScriptRef.current = renameScript;
    }

    // The landing view is all about the prompt, focus it right away
    const hero = props.variant === SessionComposerVariant.Hero;
    React.useEffect(() => {
        if (hero) view?.focus();
    }, [view]);

    const naturalLanguage = input.mode === ComposerInputMode.Ai;
    // Only SQL has inputs, `:name` in a question references a script
    const inputsContainer = naturalLanguage ? null : props.inputsContainer ?? null;
    const blockedSessionId = naturalLanguage ? null : offlineSessionId;
    const blocked = blockedSessionId != null;
    // A blocked button stays clickable, it pulses the connections that are not connected
    const sendButton = (
        <IconButton
            variant={hero && !blocked ? ButtonVariant.Primary : ButtonVariant.Default}
            size={ButtonSize.Small}
            aria-label={naturalLanguage ? 'Ask the agent' : blocked ? 'Connect to run' : 'Run query'}
            data-testid="composer-send"
            data-connect={blocked ? '' : undefined}
            disabled={empty && !blocked}
            onClick={handleSendClick}
        >
            <PaperAirplaneIcon />
        </IconButton>
    );
    const agent = props.agent ?? null;
    const placeholder = naturalLanguage
        ? 'Ask a question about your data, Shift+Enter for a new line'
        : (hero ? 'select * from ...' : 'Write a query, press Enter to run it and Shift+Enter for a new line');
    return (
        <div
            className={styles.composer}
            data-variant={hero ? 'hero' : 'docked'}
            data-agent={agent == null ? undefined : (isAgentWorking(agent) ? 'working' : 'ready')}
        >
            {inputsContainer != null && draftInputs.length > 0 && createPortal(
                <div ref={inputsRef} className={styles.composer_inputs} role="group" aria-label="Inputs of the prompt" data-testid="composer-inputs">
                    {draftInputs.map(draftInput => (
                        <SessionInputCard key={draftInput.name} input={draftInput} literalOf={literalOfDraftInput} onCommit={commitDraftInput} />
                    ))}
                </div>,
                inputsContainer,
            )}
            {agent != null && <AgentPromptPanel agent={agent} />}
            <div className={styles.composer_prompt} onMouseDown={handlePromptMouseDown}>
                <PromptEditor
                    className={styles.composer_editor}
                    scriptSession={scriptSession}
                    placeholder={placeholder}
                    keywordCase={props.keywordCase}
                    assist={input.assist}
                    onSubmit={send}
                    onTextChange={handleTextChange}
                    onEditorUpdate={handleEditorUpdate}
                    setView={handleView}
                />
                <div className={styles.composer_action_bar}>
                    <SegmentedControl aria-label="Input mode" size={SegmentedControlSize.Small} onChange={handleModeChange}>
                        <SegmentedControl.Button leadingVisual={CodeIcon} selected={!naturalLanguage} data-testid="composer-mode" data-mode="sql">
                            SQL
                        </SegmentedControl.Button>
                        <SegmentedControl.Button
                            leadingVisual={SparklesFillIcon}
                            selected={naturalLanguage}
                            disabled={!props.aiAvailable}
                            data-testid="composer-mode"
                            data-mode="ai"
                            title={props.aiAvailable ? undefined : 'Start an agent session in the header and connect the agent server to ask questions'}
                        >
                            AI
                        </SegmentedControl.Button>
                    </SegmentedControl>
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
                        {blockedSessionId != null
                            ? <ExecuteConnectionGuard sessionId={blockedSessionId} blocked>{sendButton}</ExecuteConnectionGuard>
                            : sendButton}
                    </div>
                </div>
            </div>
        </div>
    );
};
