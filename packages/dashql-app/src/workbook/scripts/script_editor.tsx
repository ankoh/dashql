import * as React from 'react';
import * as styles from './script_editor.module.css';

import { EditorView } from '@codemirror/view';
import { ChangeSpec, Compartment, EditorSelection, StateEffect, EditorState } from '@codemirror/state';

import { CodeMirror, createCodeMirrorExtensions } from '../editor/codemirror.js';
import { DashQLProcessorPlugin, DashQLUpdateEffect, type DashQLParameterClick } from '../editor/dashql_processor.js';
import { DashQLProcessorUpdateOut } from '../editor/completion/dashql_completion_state.js';
import { isCloudPreview, type ModifyWorkbookScripts, type ScriptData } from '@akohn/dashql/platform/workbook/workbook_scripts';
import type { Runtime } from '@akohn/dashql/runtime/runtime';
import { useIsScriptSelected } from './script_selection.js';
import { useAgentHasControl } from '../../agent/agent_provider.js';
import { AppConfig, useAppConfig } from '../../config/app_config.js';
import { useLogger } from '../../host/logger_provider.js';
import { useDispatch, useOptionalRuntime, useScript, useScriptReferences, useWorkbook } from '@akohn/dashql-react/hooks';
import { Logger } from '@akohn/dashql/platform/logger/logger';
import { getKeywordCase } from './script_format.js';
import { applyScriptTextChanges } from '@akohn/dashql/platform/workbook/script_reference_check';
import { DashQLScriptReferencesEffect, shownScriptReferences } from '../editor/dashql_script_references.js';

const LOG_CTX = "workbook_editor";

export interface ScriptEditorProps {
    workbookId: string;
    scriptKey: number;
    className?: string;
    autoHeight?: boolean;
    lineWrapping?: boolean;
    setView?: (view: EditorView) => void;
    onFocus?: () => void;
    onNavigateToScript?: (scriptKey: number) => void;
    /// A click on a named parameter of the script, `:min` or `from :orders`
    onParameterClick?: (click: DashQLParameterClick, view: EditorView) => void;
    dependencies?: ScriptEditorDependencies;
}

export interface ScriptEditorDependencies {
    CodeMirror: typeof CodeMirror;
    createCodeMirrorExtensions: typeof createCodeMirrorExtensions;
    useWorkbook: typeof useWorkbook;
    useScript: typeof useScript;
    useScriptReferences: typeof useScriptReferences;
    useIsScriptSelected: typeof useIsScriptSelected;
    useAppConfig: typeof useAppConfig;
    useLogger: typeof useLogger;
}

const DEFAULT_DEPENDENCIES: ScriptEditorDependencies = {
    CodeMirror,
    createCodeMirrorExtensions,
    useWorkbook,
    useScript,
    useScriptReferences,
    useIsScriptSelected,
    useAppConfig,
    useLogger,
};

const LINE_WRAPPING_EXTENSIONS = [EditorView.lineWrapping];
/// The editor of a script of a cloud preview is read-only, importing the preview makes it editable. So is the editor of
/// every script while the agent of a session has the workbooks, the user switches the prompt to SQL to edit.
const READ_ONLY = new Compartment();

export const ScriptEditor: React.FC<ScriptEditorProps> = (props) => {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const logger = dependencies.useLogger();
    const config = dependencies.useAppConfig();
    const scripts = dependencies.useWorkbook(props.workbookId);
    const modifyScripts = useDispatch({ workbook: props.workbookId });
    const runtime = useOptionalRuntime();
    const agentHasControl = useAgentHasControl(props.workbookId);
    const readOnly = (scripts != null && isCloudPreview(scripts)) || agentHasControl;
    const extraExtensions = React.useMemo(() => [
        ...(props.lineWrapping ? LINE_WRAPPING_EXTENSIONS : []),
        READ_ONLY.of(EditorState.readOnly.of(readOnly)),
    ], [props.lineWrapping, readOnly]);

    const scriptData = dependencies.useScript(props.scriptKey);
    // Only the editor of the selected script shows a semantic focus, the selection of another script leaves it alone
    const selected = dependencies.useIsScriptSelected(props.workbookId, props.scriptKey);

    // The runtime analyzes the outdated scripts that the editors show: the selected one right away, the others once
    // the changes pause (`visible_scripts` of the runtime crate)
    React.useEffect(() => {
        if (runtime == null) return;
        const scriptKey = props.scriptKey;
        modifyScripts({ kind: 'showScript', value: { scriptKey, selected } });
        return () => { modifyScripts({ kind: 'hideScript', value: { scriptKey, selected } }); };
    }, [runtime, modifyScripts, props.scriptKey, selected]);

    // Track the current CodeMirror view. The session of the script only reads, the events of the editor go to the
    // runtime, so several editors may show the same script.
    const [view, setViewState] = React.useState<EditorView | null>(null);
    // Update the editor script whenever the script changes: its session, its analysis, its diff or its connection, a
    // new script object alone (e.g. a new cached result) doesn't bind it again, nor does a change of the extensions
    const bindScript = React.useEffectEvent(() => {
        if (config == null || view == null || scriptData == null) return;
        // Binding a script replaces the editor state, which has to keep the extensions of the mount
        const createExtensions = () => [...dependencies.createCodeMirrorExtensions(), ...extraExtensions];
        updateEditor(view, runtime, scriptData, selected, modifyScripts, logger, config, createExtensions, props.onNavigateToScript, props.onParameterClick);
    });
    React.useEffect(() => bindScript(), [
        config,
        view,
        scriptData?.scriptSession,
        scriptData?.editorUpdate,
        scriptData?.pendingDiff,
        selected,
        scriptData?.connectionId,
        props.onNavigateToScript,
        props.onParameterClick,
    ]);
    // The editor follows an import of the preview and the switch between the agent and the user
    React.useEffect(() => {
        if (view == null || view.state.readOnly === readOnly) return;
        view.dispatch({ effects: READ_ONLY.reconfigure(EditorState.readOnly.of(readOnly)) });
    }, [view, readOnly]);
    // The checked script references of the script, the runtime checks every script of the workbook. The editor renders
    // again when the report of its script changes, not with the reports of the others.
    const references = dependencies.useScriptReferences(props.workbookId, props.scriptKey);
    // After the effect above, which may replace the editor state
    React.useEffect(() => {
        if (view == null || shownScriptReferences(view.state) === references) return;
        view.dispatch({ effects: DashQLScriptReferencesEffect.of(references) });
    }, [view, references, scriptData?.editorUpdate, scriptData?.scriptSession]);
    // Forward the view ref, if requested
    const { setView } = props;
    React.useEffect(() => {
        if (setView && view != null) {
            setView(view);
        }
    }, [view, setView]);

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

/// Bring the editor up to date with a script. `resync` compares the document with the text of the session also when the
/// update of the script didn't move, e.g. after an event of the editor was stale.
function updateEditor(view: EditorView, runtime: Runtime | null, scriptData: ScriptData, selected: boolean, modifyScripts: ModifyWorkbookScripts, logger: Logger, config: AppConfig, createExtensions: typeof createCodeMirrorExtensions, onNavigateToScript?: (scriptKey: number) => void, onParameterClick?: (click: DashQLParameterClick, view: EditorView) => void, resync = false) {
    const state = view.state.field(DashQLProcessorPlugin);
    const changes: ChangeSpec[] = [];
    const effects: StateEffect<unknown>[] = [];
    // The text version that the document shows after the update, if it takes the text of the session
    let textVersion: bigint | undefined = undefined;

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
        textVersion = scriptData.scriptSession.getTextVersion();
    }

    // Initial setup or unexpected script buffers?
    // Then we reset everything to make sure the script is ok.
    // Only replace if the doc content actually differs — the editor may already have the
    // correct text from its own transaction (e.g. autoclose inserting brackets).
    let mapsSelection = false;
    if (resync || state.editorUpdate?.stateRevision !== scriptData.editorUpdate?.stateRevision) {
        const scriptText = scriptData.scriptSession.getText();
        const editorText = view.state.doc.toString();
        textVersion = scriptData.scriptSession.getTextVersion();
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

    // The events of the editor go to the runtime, which applies them to the session of the script and writes the text.
    // An update of the CodeMirror extension tells the workbook that the editor accepted the staged rewrite.
    const updateScript = (update: DashQLProcessorUpdateOut) => {
        if (update.scriptSession != null && update.scriptSession !== scriptData.scriptSession) {
            logger.warn("Dropping editor update of a stale session", {
                workbookId: scriptData.workbookId,
                scriptKey: update.scriptKey.toString(),
            }, LOG_CTX);
            return;
        }
        if (update.scriptPendingDiff == null && scriptData.pendingDiff != null) {
            // The editor accepted the staged rewrite, a rejection restored the text already
            modifyScripts({ kind: 'acceptPendingDiff', value: { scriptKey: scriptData.scriptKey } });
        }
    };
    // An event that was stale: the session changed without the editor, the document shows its text again
    const resyncScript = () => queueMicrotask(() => {
        if (view.state.field(DashQLProcessorPlugin).scriptSession !== scriptData.scriptSession) return;
        const latest = runtime?.store.get('script', scriptData.scriptKey) ?? scriptData;
        if (latest.scriptSession !== scriptData.scriptSession) return;
        updateEditor(view, runtime, latest, selected, modifyScripts, logger, config, createExtensions, onNavigateToScript, onParameterClick, true);
    });


    // Notify the CodeMirror extension
    effects.push(
        DashQLUpdateEffect.of({
            scriptKey: scriptData.scriptKey,
            scriptSession: scriptData.scriptSession,
            editorUpdate: scriptData.editorUpdate,
            // The editor keeps its own completion, see DashQLProcessorPlugin
            scriptCompletion: null,
            scriptPendingDiff: scriptData.pendingDiff,
            textVersion,
            applyEvent: runtime == null ? undefined : (event, known) => runtime.applyEditorEvent(scriptData, event, known),
            onStaleText: runtime == null ? undefined : resyncScript,

            selected,
            keywordCase: getKeywordCase(config.settings),

            lookupScriptSession: (scriptKey) => runtime?.store.get('script', scriptKey)?.scriptSession ?? null,
            onNavigateToScript,
            onParameterClick,

            onUpdate: updateScript,
        }),
    );
    view.dispatch({ changes, effects, selection: selection ?? undefined });
}
