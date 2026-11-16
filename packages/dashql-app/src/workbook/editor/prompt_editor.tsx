import * as React from 'react';
import * as dashql from '@akohn/dashql';
import * as themes from './themes/index.js';

import { Compartment, EditorState, Extension, Prec } from '@codemirror/state';
import { EditorView, drawSelection, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, insertNewlineAndIndent } from '@codemirror/commands';

import { CodeMirrorSearchExtensions } from './codemirror.js';
import { DashQLExtensions, DashQLFocusCompletionEffect } from './dashql_extension.js';
import { DashQLCompletionAbortEffect, DashQLProcessorPlugin, DashQLProcessorUpdateOut, DashQLUpdateEffect } from './dashql_processor.js';

/// Callbacks of the prompt editor, read through a ref so the editor extensions are built only once.
interface PromptEditorCallbacks {
    /// Called with the current text when the user submits the prompt
    onSubmit?: (text: string) => void;
    /// Called with the current text whenever the document changes
    onTextChange?: (text: string) => void;
    /// Called with every editor update of the script session
    onEditorUpdate?: (update: dashql.buffers.editor.EditorUpdateT) => void;
}

/// The SQL assistance: completion, highlighting and auto-closing.
/// An empty prompt shows its placeholder rather than a completion hint.
const SQL_ASSIST_EXTENSIONS = DashQLExtensions.filter(extension => extension !== DashQLFocusCompletionEffect && extension !== DashQLProcessorPlugin);

/// Create CodeMirror extensions for a prompt editor.
/// This is a minimal setup without line numbers and gutters that grows with its content.
/// Long lines wrap, the prompt scrolls beyond its maximum height without showing scrollbars.
/// Enter submits, Shift+Enter inserts a newline.
function createPromptExtensions(configurable: Extension[], callbacks: React.RefObject<PromptEditorCallbacks>): Extension[] {
    const submit = (view: EditorView) => {
        const text = view.state.doc.toString();
        if (text.trim().length > 0) {
            callbacks.current?.onSubmit?.(text);
        }
        return true;
    };
    return [
        themes.xcode,
        drawSelection(),
        history(),
        // The processor keeps running with any assistance, the editor updates of the script session are reported
        DashQLProcessorPlugin,
        ...CodeMirrorSearchExtensions,
        // Below the completion keymap (Prec.highest), above the default Enter binding
        Prec.high(keymap.of([
            { key: 'Enter', run: submit },
            { key: 'Mod-Enter', run: submit },
            { key: 'Shift-Enter', run: insertNewlineAndIndent },
        ])),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        ...configurable,
        EditorView.updateListener.of(update => {
            if (update.docChanged) {
                callbacks.current?.onTextChange?.(update.state.doc.toString());
            }
        }),
        EditorView.lineWrapping,
        EditorView.theme({
            '&': { minHeight: '24px', backgroundColor: 'transparent' },
            '&.cm-focused': { outline: 'none' },
            // The lines have no padding and the cursor sits slightly left of its position.
            // The scroller reaches 1px further out, it would clip the cursor at the start of a line otherwise.
            '.cm-scroller': { overflow: 'auto', maxHeight: 'var(--prompt_editor_max_height, 40vh)', scrollbarWidth: 'none', paddingLeft: '1px', marginLeft: '-1px' },
            '.cm-content': { minHeight: '24px', padding: '0' },
            '.cm-line': { padding: '0' },
            '.cm-gutters': { display: 'none' },
        }),
    ];
}

export interface PromptEditorProps {
    /// The script session that backs analysis and completion, null while it is being set up
    scriptSession: dashql.DashQLScriptSession | null;
    /// The text shown while the prompt is empty
    placeholder: string;
    /// The keyword case for completions
    keywordCase?: dashql.buffers.formatting.KeywordCase;
    /// The class name of the container
    className?: string;
    /// Called with the current text when the user submits the prompt
    onSubmit?: (text: string) => void;
    /// Called with the current text whenever the document changes
    onTextChange?: (text: string) => void;
    /// Called with every editor update of the script session, e.g. to tell SQL from natural language
    onEditorUpdate?: (update: dashql.buffers.editor.EditorUpdateT) => void;
    /// Replaces the SQL assistance, e.g. to assist natural language
    assist?: Extension;
    /// Receives the CodeMirror view once it is mounted
    setView?: (view: EditorView | null) => void;
    /// Does the prompt refuse edits? It keeps its text and doesn't take the focus then.
    readOnly?: boolean;
}

/// The extensions of a prompt that refuses edits or takes them
function editability(readOnly: boolean): Extension {
    return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

/// A minimal SQL prompt backed by CodeMirror and wired with a DashQL script session.
///
/// The workbook belongs to the caller, a replaced workbook can be destroyed in an effect. It is not a
/// workbook script, so analysis results are kept local to the editor and never loaded into the catalog.
export const PromptEditor: React.FC<PromptEditorProps> = (props) => {
    const callbacks = React.useRef<PromptEditorCallbacks>({});
    callbacks.current = { onSubmit: props.onSubmit, onTextChange: props.onTextChange, onEditorUpdate: props.onEditorUpdate };

    // Create the CodeMirror view when the DOM node is mounted
    const [editorNode, setEditorNode] = React.useState<HTMLDivElement | null>(null);
    const [editorView, setEditorView] = React.useState<EditorView | null>(null);
    const compartments = React.useMemo(() => ({
        placeholder: new Compartment(),
        assist: new Compartment(),
        editability: new Compartment(),
    }), []);
    React.useEffect(() => {
        if (editorNode == null) {
            return;
        }
        const configurable = [
            compartments.placeholder.of(placeholder(props.placeholder)),
            compartments.assist.of(props.assist ?? SQL_ASSIST_EXTENSIONS),
            compartments.editability.of(editability(props.readOnly ?? false)),
        ];
        const view = new EditorView({
            state: EditorState.create({ extensions: createPromptExtensions(configurable, callbacks) }),
            parent: editorNode,
        });
        setEditorView(view);
        return () => {
            view.destroy();
            setEditorView(null);
        };
    }, [editorNode]);

    // Swap the placeholder, the assistance and the editability without recreating the view
    React.useEffect(() => {
        editorView?.dispatch({ effects: compartments.placeholder.reconfigure(placeholder(props.placeholder)) });
    }, [editorView, props.placeholder]);
    React.useEffect(() => {
        if (editorView == null || editorView.state.readOnly === (props.readOnly ?? false)) return;
        editorView.dispatch({
            effects: [
                compartments.editability.reconfigure(editability(props.readOnly ?? false)),
                // An open completion would still apply to a prompt that refuses edits
                DashQLCompletionAbortEffect.of(null),
            ],
        });
    }, [editorView, props.readOnly]);
    React.useEffect(() => {
        if (editorView == null) return;
        const next = props.assist ?? SQL_ASSIST_EXTENSIONS;
        if (compartments.assist.get(editorView.state) === next) return;
        editorView.dispatch({
            effects: [
                compartments.assist.reconfigure(next),
                // A SQL completion makes no sense with a different assistance
                ...(props.assist != null ? [DashQLCompletionAbortEffect.of(null)] : []),
            ],
        });
    }, [editorView, props.assist]);

    // Forward the view
    React.useEffect(() => {
        props.setView?.(editorView);
    }, [editorView, props.setView]);

    // Bind the script session to the editor.
    // A new workbook (e.g. after the connection catalog changed) takes over the current text. The
    // binding is a layout effect, the caller may destroy the previous workbook in a regular effect.
    React.useLayoutEffect(() => {
        const scriptSession = props.scriptSession;
        if (editorView == null || scriptSession == null) {
            return;
        }
        const text = editorView.state.doc.toString();
        // The draft session is the editor's own, no workbook holds it
        if (scriptSession.getText() !== text) {
            const replaced = scriptSession.replaceText(scriptSession.getTextVersion(), text);
            if (replaced.status !== dashql.buffers.editor.EditorUpdateStatus.OK) {
                throw new Error(`Failed to replace the text of the draft: ${replaced.statusMessage ?? replaced.status}`);
            }
        }
        const onUpdate = (update: DashQLProcessorUpdateOut) => {
            if (update.editorUpdate != null) {
                callbacks.current?.onEditorUpdate?.(update.editorUpdate);
            }
        };
        editorView.dispatch({
            effects: DashQLUpdateEffect.of({
                scriptKey: scriptSession.getCatalogEntryId(),
                scriptSession,
                editorUpdate: scriptSession.analyze(),
                scriptBuffers: null,
                scriptCompletion: null,
                scriptPendingDiff: null,
                keywordCase: props.keywordCase,
                onUpdate,
            }),
        });
    }, [editorView, props.scriptSession, props.keywordCase]);

    return <div className={props.className} ref={setEditorNode} />;
};
