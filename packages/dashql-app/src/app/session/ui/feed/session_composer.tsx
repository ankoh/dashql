import * as React from 'react';
import * as core from '@ankoh/dashql-core';
import * as styles from './session_composer.module.css';

import type { EditorView } from '@codemirror/view';

import { ButtonSize, ButtonVariant, IconButton } from '../../../../ui/foundations/button.js';
import { SegmentedControl, SegmentedControlSize } from '../../../../ui/foundations/segmented_control.js';
import { CodeIcon, PaperAirplaneIcon, SymbolIcon } from '../../../../ui/foundations/symbol_icon.js';
import { PromptEditor } from '../../scripts/editor/prompt_editor.js';
import { DashQLCompletionAbortEffect } from '../../scripts/editor/dashql_processor.js';
import { ComposerInputMode } from '../../ai/input_mode.js';
import { useComposerInputMode } from '../../ai/use_composer_input_mode.js';
import { SnippetsOverlay } from '../snippets/snippets_overlay.js';
import { AgentPromptPanel, isAgentWorking, type ComposerAgent } from '../../ai/ui/agent_prompt_panel.js';
import type { ConnectorType } from '../../../connections/connector_info.js';
import type { SnippetRegistry } from '../../snippets/snippet_registry.js';

const SparklesFillIcon = SymbolIcon('sparkles_fill_16');

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
    /// The agent access of the session, next to the connection picker
    agentControl?: React.ReactNode;
    /// The agent of a session with agent access, shown on top of the prompt
    agent?: ComposerAgent | null;
    /// Called with the draft and its input mode when the user sends it, the draft is cleared before
    onSend: (text: string, mode: ComposerInputMode) => void;
    /// Receives the editor view once it is mounted
    setView?: (view: EditorView | null) => void;
    /// Receives the send function of the composer, e.g. for global key bindings
    submitRef?: React.RefObject<(() => void) | null>;
    /// Picks the connection that the draft runs on
    connectionPicker?: React.ReactNode;
    /// The connector of the draft, the landing view offers the snippets that run on it
    snippetConnector?: ConnectorType;
    /// The snippets to browse, the bundled ones by default
    snippetRegistry?: SnippetRegistry;
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

    const [view, setView] = React.useState<EditorView | null>(null);
    const [empty, setEmpty] = React.useState(true);
    const handleView = React.useCallback((next: EditorView | null) => {
        setView(next);
        props.setView?.(next);
    }, [props.setView]);

    // The draft is SQL or natural language
    const input = useComposerInputMode(props.catalog, props.aiAvailable);
    const handleTextChange = React.useCallback((text: string) => {
        setEmpty(text.trim().length === 0);
        input.onTextChange(text);
    }, [input.onTextChange]);
    const handleModeChange = React.useCallback((index: number) => {
        input.pick(index === 0 ? ComposerInputMode.Sql : ComposerInputMode.Ai);
    }, [input.pick]);

    const send = React.useCallback(() => {
        if (view == null) return;
        const mode = input.resolveSendMode();
        const text = takeComposerDraft(view);
        if (text != null) {
            props.onSend(text, mode);
        }
    }, [props.onSend, view, input.resolveSendMode]);
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
    if (props.submitRef) {
        props.submitRef.current = send;
    }

    // The landing view is all about the prompt, focus it right away
    const hero = props.variant === SessionComposerVariant.Hero;
    React.useEffect(() => {
        if (hero) view?.focus();
    }, [view]);

    const naturalLanguage = input.mode === ComposerInputMode.Ai;
    const agent = props.agent ?? null;
    const placeholder = naturalLanguage
        ? 'Ask a question about your data'
        : (hero ? 'select * from ...' : 'Write a query, press Enter to run it');
    return (
        <div
            className={styles.composer}
            data-variant={hero ? 'hero' : 'docked'}
            data-agent={agent == null ? undefined : (isAgentWorking(agent) ? 'working' : 'ready')}
        >
            {agent != null && <AgentPromptPanel agent={agent} />}
            <PromptEditor
                className={styles.composer_editor}
                scriptSession={scriptSession}
                placeholder={placeholder}
                keywordCase={props.keywordCase}
                assist={input.assist}
                onSubmit={send}
                onTextChange={handleTextChange}
                onEditorUpdate={input.onEditorUpdate}
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
                        title={props.aiAvailable ? undefined : 'Turn on agent access and connect the agent server to ask questions'}
                    >
                        AI
                    </SegmentedControl.Button>
                </SegmentedControl>
                <div className={styles.composer_trailing_actions}>
                    {props.agentControl}
                    {props.connectionPicker}
                    {hero && props.snippetConnector != null && (
                        <SnippetsOverlay
                            scriptName="the prompt"
                            connectorType={props.snippetConnector}
                            disabled={view == null}
                            onApply={applySnippet}
                            registry={props.snippetRegistry}
                            testId="composer-snippets"
                        />
                    )}
                    <IconButton
                        variant={hero ? ButtonVariant.Primary : ButtonVariant.Default}
                        size={ButtonSize.Small}
                        aria-label={naturalLanguage ? 'Ask the agent' : 'Run query'}
                        data-testid="composer-send"
                        disabled={empty}
                        onClick={handleSendClick}
                    >
                        <PaperAirplaneIcon />
                    </IconButton>
                </div>
            </div>
        </div>
    );
};
