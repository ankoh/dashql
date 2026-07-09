import * as React from 'react';
import * as styles from './script_editor.module.css';

import { EditorView } from '@codemirror/view';
import { ChangeSpec, EditorSelection, StateEffect, EditorState } from '@codemirror/state';

import { CodeMirror, createCodeMirrorExtensions } from '../editor/codemirror.js';
import { DashQLProcessorPlugin, DashQLProcessorUpdateOut, DashQLUpdateEffect } from '../editor/dashql_processor.js';
import { ScriptData, ANALYZE_OUTDATED_SCRIPT, UPDATE_FROM_PROCESSOR, NotebookState } from '../../notebook/notebook_state.js';
import { AppConfig, useAppConfig } from '../../app_config.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { ModifyNotebook, useNotebookState } from '../../notebook/notebook_state_registry.js';
import { Logger } from '../../platform/logger/logger.js';

const LOG_CTX = "notebook_editor";

export interface ScriptEditorProps {
    sessionId: string;
    scriptKey: number;
    className?: string;
    autoHeight?: boolean;
    setView?: (view: EditorView) => void;
}

export const ScriptEditor: React.FC<ScriptEditorProps> = (props) => {
    const logger = useLogger();
    const config = useAppConfig();
    const [notebook, modifyNotebook] = useNotebookState(props.sessionId);

    const scriptData = notebook?.scripts[props.scriptKey] ?? null;

    // Update outdated scripts that are displayed in the editor
    React.useEffect(() => {
        if (scriptData?.scriptAnalysis.outdated) {
            modifyNotebook({ type: ANALYZE_OUTDATED_SCRIPT, value: scriptData.scriptKey });
        }
    }, [scriptData]);

    // Track the current CodeMirror view
    const [view, setViewState] = React.useState<EditorView | null>(null);
    // Effect to update the editor script whenever the script changes
    React.useEffect(() => {
        if (config == null || view == null || scriptData == null || notebook == null) return;
        updateEditor(view, notebook, scriptData, modifyNotebook, logger, config);
    }, [
        config,
        view,
        scriptData?.script,
        scriptData?.scriptAnalysis.buffers,
        scriptData?.pendingDiff,
        notebook?.semanticUserFocus,
        notebook?.connectionCatalog,
    ]);
    // Forward the view ref, if requested
    React.useEffect(() => {
        if (props.setView && view != null) {
            props.setView(view);
        }
    }, [view, props.setView]);

    const containerClass = [
        props.autoHeight ? styles.uncommitted_editor : styles.editor,
        props.className,
    ].filter(Boolean).join(' ');

    return (
        <div className={containerClass}>
            <CodeMirror ref={setViewState} style={props.autoHeight ? { height: 'auto' } : undefined} />
        </div>
    );
};

function updateEditor(view: EditorView, notebook: NotebookState, scriptData: ScriptData, modifyNotebook: ModifyNotebook, logger: Logger, _config: AppConfig) {
    const state = view.state.field(DashQLProcessorPlugin);
    const changes: ChangeSpec[] = [];
    const effects: StateEffect<any>[] = [];

    // Script does not belong here?
    // Create a new editor state and update the view.
    // XXX Here's the place where we would restore a previous state, if one exists.
    if (state.script != scriptData.script) {
        // When that happens we have to reset the editor state.
        // It means that someone gave us a new notebook script that requires a state update
        const extensions = createCodeMirrorExtensions();
        const newState = EditorState.create({ extensions });
        view.setState(newState);
    }

    // Initial setup or unexpected script buffers?
    // Then we reset everything to make sure the script is ok.
    // Only replace if the doc content actually differs — the editor may already have the
    // correct text from its own transaction (e.g. autoclose inserting brackets).
    if (state.scriptBuffers !== scriptData.scriptAnalysis.buffers) {
        const scriptText = scriptData.script.toString();
        const editorText = view.state.doc.toString();
        if (scriptText !== editorText) {
            logger.debug("Replacing editor script", {}, LOG_CTX);
            changes.push({
                from: 0,
                to: view.state.doc.length,
                insert: scriptText,
            });
        }
    }

    // Did the cursor change externally (not from the editor itself)?
    // Only override the selection if the cursor was set from outside (e.g. clicking a table ref).
    // Never override when the cursor update originated from the editor's own selection changes,
    // as that would collapse an in-progress text selection.
    let selection: EditorSelection | null = null;
    if (state.scriptCursor !== scriptData.cursor && state.script === scriptData.script) {
        const mainSel = view.state.selection.main;
        if (mainSel.empty) {
            const nextCursorOffset = scriptData.cursor?.read().textOffset();
            if (nextCursorOffset != null && nextCursorOffset !== mainSel.head) {
                const clampedOffset = Math.max(0, Math.min(nextCursorOffset, view.state.doc.length));
                selection = EditorSelection.create([EditorSelection.cursor(clampedOffset)]);
            }
        }
    }

    // XXX Detect invalid selections

    // Helper to update a script.
    // Called when the script gets updated by the CodeMirror extension.
    // Note that this is also called when the state is set up initially.
    const updateScript = (update: DashQLProcessorUpdateOut) => {
        modifyNotebook({
            type: UPDATE_FROM_PROCESSOR,
            value: update,
        });
    };


    // Notify the CodeMirror extension
    effects.push(
        DashQLUpdateEffect.of({
            config: {
            },

            scriptRegistry: notebook.scriptRegistry,
            scriptKey: scriptData.scriptKey,
            script: scriptData.script,
            scriptBuffers: scriptData.scriptAnalysis.buffers,
            scriptCursor: scriptData.cursor,
            scriptCompletion: scriptData.completion,
            scriptPendingDiff: scriptData.pendingDiff,

            derivedFocus: notebook?.semanticUserFocus ?? null,

            onUpdate: updateScript,
        }),
    );
    view.dispatch({ changes, effects, selection: selection ?? undefined });
}
