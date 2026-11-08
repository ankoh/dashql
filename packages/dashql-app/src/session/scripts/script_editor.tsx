import * as React from 'react';
import * as styles from './script_editor.module.css';

import { EditorView } from '@codemirror/view';
import { ChangeSpec, EditorSelection, StateEffect, EditorState } from '@codemirror/state';

import { CodeMirror, createCodeMirrorExtensions } from '../editor/codemirror.js';
import { DashQLProcessorPlugin, DashQLProcessorUpdateOut, DashQLUpdateEffect } from '../editor/dashql_processor.js';
import { ScriptData, ANALYZE_OUTDATED_SCRIPT, UPDATE_FROM_PROCESSOR, SessionScripts, getSelectedScriptRef } from './session_scripts.js';
import { AppConfig, useAppConfig } from '../../config/app_config.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { ModifySessionScripts, useSessionScripts } from './session_scripts_registry.js';
import { Logger } from '../../platform/logger/logger.js';
import { getKeywordCase } from './script_format.js';
import { checkSessionScriptReferences } from './script_reference_reports.js';
import { applyScriptTextChanges } from './script_reference_check.js';
import { DashQLScriptReferencesEffect, shownScriptReferences } from '../editor/dashql_script_references.js';

const LOG_CTX = "session_editor";
/// Typing in one script marks all other scripts outdated.
/// Re-analyze the scripts in the background once the user pauses instead of on every keystroke.
const BACKGROUND_ANALYSIS_DELAY_MS = 150;
const WRITABLE_SESSION_VIEWS = new WeakMap<object, EditorView>();

function leaseWritableSession(scriptSession: object, view: EditorView): () => void {
    const current = WRITABLE_SESSION_VIEWS.get(scriptSession);
    if (current != null && current !== view) {
        throw new Error('A DashQLScriptSession can only be bound to one writable editor view');
    }
    WRITABLE_SESSION_VIEWS.set(scriptSession, view);
    return () => {
        if (WRITABLE_SESSION_VIEWS.get(scriptSession) === view) {
            WRITABLE_SESSION_VIEWS.delete(scriptSession);
        }
    };
}

export interface ScriptEditorProps {
    sessionId: string;
    scriptKey: number;
    className?: string;
    autoHeight?: boolean;
    lineWrapping?: boolean;
    setView?: (view: EditorView) => void;
    onFocus?: () => void;
    onNavigateToScript?: (scriptKey: number) => void;
    dependencies?: ScriptEditorDependencies;
}

export interface ScriptEditorDependencies {
    CodeMirror: typeof CodeMirror;
    createCodeMirrorExtensions: typeof createCodeMirrorExtensions;
    useSessionScripts: typeof useSessionScripts;
    useAppConfig: typeof useAppConfig;
    useLogger: typeof useLogger;
}

const DEFAULT_DEPENDENCIES: ScriptEditorDependencies = {
    CodeMirror,
    createCodeMirrorExtensions,
    useSessionScripts,
    useAppConfig,
    useLogger,
};

const LINE_WRAPPING_EXTENSIONS = [EditorView.lineWrapping];

export const ScriptEditor: React.FC<ScriptEditorProps> = (props) => {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const extraExtensions = props.lineWrapping ? LINE_WRAPPING_EXTENSIONS : undefined;
    const logger = dependencies.useLogger();
    const config = dependencies.useAppConfig();
    const [scripts, modifyScripts] = dependencies.useSessionScripts(props.sessionId);

    const scriptData = scripts?.scripts[props.scriptKey] ?? null;

    // Update outdated scripts that are displayed in the editor.
    // The selected script is analyzed right away, all others are deferred.
    // Deferring is safe since the script stays marked as outdated until the analysis ran,
    // and anything that needs the analysis analyzes it on demand (see ensureSessionScriptAnalyzed).
    React.useEffect(() => {
        if (scripts == null || !scriptData?.analysisOutdated) {
            return;
        }
        const scriptKey = scriptData.scriptKey;
        if (getSelectedScriptRef(scripts)?.scriptId === scriptKey) {
            modifyScripts({ type: ANALYZE_OUTDATED_SCRIPT, value: scriptKey });
            return;
        }
        const timeout = setTimeout(() => {
            modifyScripts({ type: ANALYZE_OUTDATED_SCRIPT, value: scriptKey });
        }, BACKGROUND_ANALYSIS_DELAY_MS);
        return () => clearTimeout(timeout);
    }, [scriptData]);

    // Track the current CodeMirror view
    const [view, setViewState] = React.useState<EditorView | null>(null);
    React.useEffect(() => {
        if (view == null || scriptData == null) return;
        return leaseWritableSession(scriptData.scriptSession, view);
    }, [view, scriptData?.scriptSession]);
    // Effect to update the editor script whenever the script changes
    React.useEffect(() => {
        if (config == null || view == null || scriptData == null || scripts == null) return;
        // Binding a script replaces the editor state, which has to keep the extensions of the mount
        const createExtensions = () => [...dependencies.createCodeMirrorExtensions(), ...(extraExtensions ?? [])];
        updateEditor(view, scripts, scriptData, modifyScripts, logger, config, createExtensions, props.onNavigateToScript);
    }, [
        config,
        view,
        scriptData?.scriptSession,
        scriptData?.editorUpdate,
        scriptData?.pendingDiff,
        scripts?.semanticUserFocus,
        scriptData?.connection.catalog,
        props.onNavigateToScript,
    ]);
    // The checked script references of the script, the check covers every script of the session
    const references = React.useMemo(
        () => scripts == null || scriptData == null ? null : checkSessionScriptReferences(scripts).get(scriptData.scriptKey) ?? null,
        [scripts],
    );
    // After the effect above, which may replace the editor state
    React.useEffect(() => {
        if (view == null || shownScriptReferences(view.state) === references) return;
        view.dispatch({ effects: DashQLScriptReferencesEffect.of(references) });
    }, [view, references, scriptData?.editorUpdate, scriptData?.scriptSession]);
    // Forward the view ref, if requested
    React.useEffect(() => {
        if (props.setView && view != null) {
            props.setView(view);
        }
    }, [view, props.setView]);

    // The CodeMirror view only reads the initial document when mounting, don't copy the text on every render
    const initialDoc = React.useMemo(() => scriptData?.scriptSession.getText() ?? '', [scriptData?.scriptSession]);

    const containerClass = [
        props.autoHeight ? styles.auto_height_editor : styles.editor,
        props.className,
    ].filter(Boolean).join(' ');

    return (
        <div className={containerClass} onFocusCapture={props.onFocus}>
            <dependencies.CodeMirror
                ref={setViewState}
                initialDoc={initialDoc}
                extraExtensions={extraExtensions}
                style={props.autoHeight ? { height: 'auto' } : undefined}
            />
        </div>
    );
};

function updateEditor(view: EditorView, scripts: SessionScripts, scriptData: ScriptData, modifyScripts: ModifySessionScripts, logger: Logger, config: AppConfig, createExtensions: typeof createCodeMirrorExtensions, onNavigateToScript?: (scriptKey: number) => void) {
    const state = view.state.field(DashQLProcessorPlugin);
    const changes: ChangeSpec[] = [];
    const effects: StateEffect<any>[] = [];

    // Script does not belong here?
    // Create a new editor state and update the view.
    // XXX Here's the place where we would restore a previous state, if one exists.
    if (state.scriptSession !== scriptData.scriptSession) {
        const scriptText = scriptData.scriptSession.getText();
        logger.debug("Resetting editor for a different native session", {
            sessionId: scripts.sessionId,
            scriptKey: scriptData.scriptKey.toString(),
            editorHadSession: (state.scriptSession != null).toString(),
            nativeTextVersion: scriptData.scriptSession.getTextVersion().toString(),
            projectedTextVersion: scriptData.editorUpdate?.textVersion.toString(),
        }, LOG_CTX);
        // When that happens we have to reset the editor state.
        // It means that someone gave us a new session script that requires a state update
        const extensions = createExtensions();
        const newState = EditorState.create({ doc: scriptText, extensions });
        view.setState(newState);
    }

    // Initial setup or unexpected script buffers?
    // Then we reset everything to make sure the script is ok.
    // Only replace if the doc content actually differs — the editor may already have the
    // correct text from its own transaction (e.g. autoclose inserting brackets).
    let mapsSelection = false;
    if (state.editorUpdate?.stateRevision !== scriptData.editorUpdate?.stateRevision) {
        const scriptText = scriptData.scriptSession.getText();
        const editorText = view.state.doc.toString();
        const external = scriptData.externalChanges;
        // The changes apply only to the text they were made for and only if they yield the text of the session
        if (scriptText !== editorText && external != null && external.fromText === editorText
            && applyScriptTextChanges(editorText, external.changes) === scriptText) {
            // A change of the app that the editor did not see, e.g. a renamed script reference.
            // Applied as changes, the editor keeps the cursor and can undo them.
            changes.push(...external.changes);
            mapsSelection = true;
        } else if (scriptText !== editorText) {
            logger.warn("Replacing CodeMirror text from native editor session", {
                sessionId: scripts.sessionId,
                scriptKey: scriptData.scriptKey.toString(),
                editorTextLength: editorText.length.toString(),
                scriptTextLength: scriptText.length.toString(),
                editorStateRevision: state.editorUpdate?.stateRevision.toString(),
                projectedStateRevision: scriptData.editorUpdate?.stateRevision.toString(),
            }, LOG_CTX);
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
    if (!mapsSelection && state.editorUpdate?.stateRevision !== scriptData.editorUpdate?.stateRevision && state.scriptSession === scriptData.scriptSession) {
        const mainSel = view.state.selection.main;
        if (mainSel.empty) {
            const nextCursorOffset = scriptData.editorUpdate?.primaryCursorState?.textOffset == null
                ? null
                : Number(scriptData.editorUpdate.primaryCursorState.textOffset);
            if (nextCursorOffset != null && nextCursorOffset !== mainSel.head) {
                const clampedOffset = Math.max(0, Math.min(nextCursorOffset, view.state.doc.length));
                selection = EditorSelection.create([EditorSelection.cursor(clampedOffset)]);
                logger.debug("Projecting external cursor into CodeMirror", {
                    sessionId: scripts.sessionId,
                    scriptKey: scriptData.scriptKey.toString(),
                    currentCursorOffset: mainSel.head.toString(),
                    nextCursorOffset: clampedOffset.toString(),
                }, LOG_CTX);
            }
        }
    }

    // XXX Detect invalid selections

    // Helper to update a script.
    // Called when the script gets updated by the CodeMirror extension.
    // Note that this is also called when the state is set up initially.
    const updateScript = (update: DashQLProcessorUpdateOut) => {
        logger.debug("Dispatching editor processor update", {
            sessionId: scripts.sessionId,
            scriptKey: update.scriptKey.toString(),
            textVersion: update.editorUpdate?.textVersion.toString(),
            stateRevision: update.editorUpdate?.stateRevision.toString(),
            cursorOffset: update.editorUpdate?.primaryCursorState?.textOffset?.toString(),
        }, LOG_CTX);
        modifyScripts({
            type: UPDATE_FROM_PROCESSOR,
            value: update,
        });
    };


    // Notify the CodeMirror extension
    effects.push(
        DashQLUpdateEffect.of({
            scriptKey: scriptData.scriptKey,
            scriptSession: scriptData.scriptSession,
            editorUpdate: scriptData.editorUpdate,
            scriptBuffers: null,
            scriptCompletion: scriptData.completion,
            scriptPendingDiff: scriptData.pendingDiff,

            derivedFocus: scripts.semanticUserFocus,
            keywordCase: getKeywordCase(config.settings),

            lookupScriptSession: (scriptKey) => scripts.scripts[scriptKey]?.scriptSession ?? null,
            onNavigateToScript,

            onUpdate: updateScript,
        }),
    );
    view.dispatch({ changes, effects, selection: selection ?? undefined });
}
