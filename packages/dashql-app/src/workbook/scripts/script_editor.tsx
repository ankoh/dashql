import * as React from 'react';
import * as styles from './script_editor.module.css';

import { EditorView } from '@codemirror/view';
import { ChangeSpec, Compartment, EditorSelection, StateEffect, EditorState } from '@codemirror/state';

import { CodeMirror, createCodeMirrorExtensions } from '../editor/codemirror.js';
import { DashQLProcessorPlugin, DashQLProcessorUpdateOut, DashQLUpdateEffect } from '../editor/dashql_processor.js';
import { isCloudPreview, type ModifyWorkbookScripts, type ScriptData } from '@ankoh/dashql-platform/workbook/scripts/workbook_scripts';
import type { Runtime } from '@ankoh/dashql-runtime/runtime';
import { useSelectedScriptRef } from './script_selection.js';
import { AppConfig, useAppConfig } from '../../config/app_config.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useDispatch, useOptionalRuntime, useScript, useWorkbook, useWorkbookDerived } from '../../runtime/runtime_hooks.js';
import { Logger } from '@ankoh/dashql-platform/platform/logger/logger';
import { getKeywordCase } from './script_format.js';
import { applyScriptTextChanges } from '@ankoh/dashql-platform/workbook/scripts/script_reference_check';
import { DashQLScriptReferencesEffect, shownScriptReferences } from '../editor/dashql_script_references.js';

const LOG_CTX = "workbook_editor";
/// Typing in one script marks all other scripts outdated.
/// Re-analyze the scripts in the background once the user pauses instead of on every keystroke.
const BACKGROUND_ANALYSIS_DELAY_MS = 150;
const WRITABLE_WORKBOOK_VIEWS = new WeakMap<object, EditorView>();

function leaseWritableSession(scriptSession: object, view: EditorView): () => void {
    const current = WRITABLE_WORKBOOK_VIEWS.get(scriptSession);
    if (current != null && current !== view) {
        throw new Error('A DashQLScriptSession can only be bound to one writable editor view');
    }
    WRITABLE_WORKBOOK_VIEWS.set(scriptSession, view);
    return () => {
        if (WRITABLE_WORKBOOK_VIEWS.get(scriptSession) === view) {
            WRITABLE_WORKBOOK_VIEWS.delete(scriptSession);
        }
    };
}

export interface ScriptEditorProps {
    workbookId: string;
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
    useWorkbook: typeof useWorkbook;
    useScript: typeof useScript;
    useWorkbookDerived: typeof useWorkbookDerived;
    useAppConfig: typeof useAppConfig;
    useLogger: typeof useLogger;
}

const DEFAULT_DEPENDENCIES: ScriptEditorDependencies = {
    CodeMirror,
    createCodeMirrorExtensions,
    useWorkbook,
    useScript,
    useWorkbookDerived,
    useAppConfig,
    useLogger,
};

const LINE_WRAPPING_EXTENSIONS = [EditorView.lineWrapping];
/// The editor of a script of a cloud preview is read-only, importing the preview makes it editable
const READ_ONLY = new Compartment();

export const ScriptEditor: React.FC<ScriptEditorProps> = (props) => {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const logger = dependencies.useLogger();
    const config = dependencies.useAppConfig();
    const scripts = dependencies.useWorkbook(props.workbookId);
    const modifyScripts = useDispatch({ workbook: props.workbookId });
    const runtime = useOptionalRuntime();
    const readOnly = scripts != null && isCloudPreview(scripts);
    const extraExtensions = React.useMemo(() => [
        ...(props.lineWrapping ? LINE_WRAPPING_EXTENSIONS : []),
        READ_ONLY.of(EditorState.readOnly.of(readOnly)),
    ], [props.lineWrapping, readOnly]);

    const scriptData = dependencies.useScript(props.scriptKey);
    // Only the editor of the selected script shows a semantic focus
    const selected = useSelectedScriptRef(scripts)?.scriptId === props.scriptKey;

    // Update outdated scripts that are displayed in the editor.
    // The selected script is analyzed right away, all others are deferred.
    // Deferring is safe since the script stays marked as outdated until the analysis ran,
    // and anything that needs the analysis analyzes it on demand, e.g. a run of the script (`Runtime.runScript`).
    React.useEffect(() => {
        if (scripts == null || !scriptData?.analysisOutdated) {
            return;
        }
        const scriptKey = scriptData.scriptKey;
        if (selected) {
            modifyScripts({ kind: 'analyzeOutdatedScript', value: { scriptKey } });
            return;
        }
        const timeout = setTimeout(() => {
            modifyScripts({ kind: 'analyzeOutdatedScript', value: { scriptKey } });
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
        if (config == null || view == null || scriptData == null) return;
        // Binding a script replaces the editor state, which has to keep the extensions of the mount
        const createExtensions = () => [...dependencies.createCodeMirrorExtensions(), ...extraExtensions];
        updateEditor(view, runtime, scriptData, selected, modifyScripts, logger, config, createExtensions, props.onNavigateToScript);
    }, [
        config,
        view,
        scriptData?.scriptSession,
        scriptData?.editorUpdate,
        scriptData?.pendingDiff,
        selected,
        scriptData?.connectionId,
        props.onNavigateToScript,
    ]);
    // The editor follows an import of the preview
    React.useEffect(() => {
        if (view == null || view.state.readOnly === readOnly) return;
        view.dispatch({ effects: READ_ONLY.reconfigure(EditorState.readOnly.of(readOnly)) });
    }, [view, readOnly]);
    // The checked script references of the script, the runtime checks every script of the workbook
    const derived = dependencies.useWorkbookDerived(props.workbookId);
    const references = derived?.references.get(props.scriptKey) ?? null;
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

function updateEditor(view: EditorView, runtime: Runtime | null, scriptData: ScriptData, selected: boolean, modifyScripts: ModifyWorkbookScripts, logger: Logger, config: AppConfig, createExtensions: typeof createCodeMirrorExtensions, onNavigateToScript?: (scriptKey: number) => void) {
    const state = view.state.field(DashQLProcessorPlugin);
    const changes: ChangeSpec[] = [];
    const effects: StateEffect<any>[] = [];

    // Script does not belong here?
    // Create a new editor state and update the view.
    // XXX Here's the place where we would restore a previous state, if one exists.
    if (state.scriptSession !== scriptData.scriptSession) {
        const scriptText = scriptData.scriptSession.getText();
        logger.debug("Resetting editor for a different native workbook", {
            workbookId: scriptData.workbookId,
            scriptKey: scriptData.scriptKey.toString(),
            editorHadSession: (state.scriptSession != null).toString(),
            nativeTextVersion: scriptData.scriptSession.getTextVersion().toString(),
            projectedTextVersion: scriptData.editorUpdate?.textVersion.toString(),
        }, LOG_CTX);
        // When that happens we have to reset the editor state.
        // It means that someone gave us a new workbook script that requires a state update
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
        // The changes apply only to the text they were made for and only if they yield the text of the workbook
        if (scriptText !== editorText && external != null && external.fromText === editorText
            && applyScriptTextChanges(editorText, external.changes) === scriptText) {
            // A change of the app that the editor did not see, e.g. a renamed script reference.
            // Applied as changes, the editor keeps the cursor and can undo them.
            changes.push(...external.changes);
            mapsSelection = true;
        } else if (scriptText !== editorText) {
            logger.warn("Replacing CodeMirror text from native editor workbook", {
                workbookId: scriptData.workbookId,
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
                    workbookId: scriptData.workbookId,
                    scriptKey: scriptData.scriptKey.toString(),
                    currentCursorOffset: mainSel.head.toString(),
                    nextCursorOffset: clampedOffset.toString(),
                }, LOG_CTX);
            }
        }
    }

    // XXX Detect invalid selections

    // Report an update of the CodeMirror extension to the workbook, also when the state is set up initially. An
    // update of a session that the script no longer holds is dropped.
    const updateScript = (update: DashQLProcessorUpdateOut) => {
        if (update.scriptSession != null && update.scriptSession !== scriptData.scriptSession) {
            logger.warn("Dropping editor update of a stale session", {
                workbookId: scriptData.workbookId,
                scriptKey: update.scriptKey.toString(),
            }, LOG_CTX);
            return;
        }
        if (update.editorUpdate != null) {
            runtime?.reportEditorUpdate(scriptData, update.editorUpdate, update.scriptPendingDiff != null);
        } else if (update.scriptPendingDiff == null && scriptData.pendingDiff != null) {
            // The editor accepted the staged rewrite, a rejection restored the text already
            modifyScripts({ kind: 'acceptPendingDiff', value: { scriptKey: scriptData.scriptKey } });
        }
    };


    // Notify the CodeMirror extension
    effects.push(
        DashQLUpdateEffect.of({
            scriptKey: scriptData.scriptKey,
            scriptSession: scriptData.scriptSession,
            editorUpdate: scriptData.editorUpdate,
            scriptBuffers: null,
            // The editor keeps its own completion, see DashQLProcessorPlugin
            scriptCompletion: null,
            scriptPendingDiff: scriptData.pendingDiff,

            selected,
            keywordCase: getKeywordCase(config.settings),

            lookupScriptSession: (scriptKey) => runtime?.store.get('script', scriptKey)?.scriptSession ?? null,
            onNavigateToScript,

            onUpdate: updateScript,
        }),
    );
    view.dispatch({ changes, effects, selection: selection ?? undefined });
}
