import * as React from 'react';
import type { EditorView } from '@codemirror/view';
import * as styles from './script_editor_dialog.module.css';

import { type ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { useCancelQuery, useQueryState } from '../../connections/query_executor.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { ButtonGroup } from '../../ui/foundations/button_group.js';
import { Overlay, OverlaySize } from '../../ui/foundations/overlay.js';
import { IndicatorStatus } from '../../ui/foundations/status_indicator.js';
import { CheckIcon, ScreenFullIcon, ScreenNormalIcon, XIcon } from '../../ui/foundations/symbol_icon.js';
import { DashQLCompletionAbortEffect, DashQLCompletionStatus, DashQLProcessorPlugin } from '../editor/dashql_processor.js';
import { acceptPendingDiff, rejectPendingDiff } from '../editor/dashql_diff_hint.js';
import { EntryStatusBar } from '../entry_status_bar.js';
import { deriveEntryStatus, EntryStatusKind } from '../entry_status_model.js';
import { ScriptEntryHeader } from '../feed/script_entry_header.js';
import { ACCEPT_PENDING_DIFF, REJECT_PENDING_DIFF, type ScriptData, type WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import { deleteScript, useScriptSelection } from './script_selection.js';
import type { ModifyWorkbookScripts } from './workbook_scripts_registry.js';
import { ScriptEditor } from './script_editor.js';
import { checkWorkbookScriptReferences } from './script_reference_reports.js';
import type { RenameDraftReferences } from '@ankoh/dashql-runtime/workbook/scripts/script_rename';
import { scriptDisplayName } from '@ankoh/dashql-runtime/workbook/scripts/script_types';
import { useWorkbookExecution } from './use_workbook_execution.js';

export interface ScriptEditorDialogProps {
    workbookScripts: WorkbookScripts;
    modifyWorkbookScripts: ModifyWorkbookScripts;
    scriptKey: number;
    /// The connections that the scripts run on
    scriptConnections: ReadonlyMap<string, ConnectionState>;
    /// The function that renames the references in the draft of the composer
    draftRenameRef?: React.RefObject<RenameDraftReferences | null>;
    /// Delete the script, the workbook deletes it by default. The dialog closes.
    onDelete?: (script: ScriptData) => void;
    /// Open another script, e.g. one that the script references
    onNavigateToScript?: (scriptKey: number) => void;
    onClose: () => void;
}

/// A script in a dialog over a view without editors, e.g. the dataflow: the header of the feed entry next to the
/// expand and close buttons, the editor and the status of the last run. A staged rewrite shows as a diff in the
/// editor, accepted or rejected over it.
export function ScriptEditorDialog(props: ScriptEditorDialogProps): React.ReactElement | null {
    const { workbookScripts, modifyWorkbookScripts, scriptKey, onClose } = props;
    const script = workbookScripts.scripts[scriptKey];
    const workbookId = workbookScripts.workbookId;
    const [editorView, setEditorView] = React.useState<EditorView | null>(null);
    // An expanded dialog fills the window
    const [expanded, setExpanded] = React.useState(false);
    const scriptReferences = React.useMemo(
        () => checkWorkbookScriptReferences(workbookScripts).get(scriptKey) ?? null,
        [workbookScripts, scriptKey],
    );
    const queryState = useQueryState(workbookId, script?.latestQueryId ?? null);
    const status = deriveEntryStatus(queryState);
    const cancelQuery = useCancelQuery();
    const workbookExecution = useWorkbookExecution(workbookId);
    const cancel = React.useCallback(() => {
        if (script?.latestQueryId == null) return;
        if (workbookExecution.busy) workbookExecution.stop();
        else cancelQuery(script.connection.connectionId, script.latestQueryId);
    }, [script, workbookExecution.busy, workbookExecution.stop, cancelQuery]);

    // Escape closes an open completion first, then the dialog
    const onEscape = React.useCallback(() => {
        const processor = editorView?.state.field(DashQLProcessorPlugin, false);
        if (editorView != null && processor?.scriptCompletion?.status === DashQLCompletionStatus.AVAILABLE) {
            editorView.dispatch({ effects: DashQLCompletionAbortEffect.of(null) });
            return;
        }
        onClose();
    }, [editorView, onClose]);
    // The menus of the header open outside of the dialog, a click outside keeps it open
    const ignoreOutsideClick = React.useCallback(() => {}, []);
    const selection = useScriptSelection();
    const remove = React.useCallback((target: ScriptData) => {
        if (props.onDelete != null) props.onDelete(target);
        else void deleteScript(selection, workbookScripts, modifyWorkbookScripts, target.fileName);
        onClose();
    }, [props.onDelete, selection, workbookScripts, modifyWorkbookScripts, onClose]);
    // The editor accepts or rejects a diff itself and clears the staged rewrite through the workbook
    const acceptDiff = React.useCallback(() => {
        if (editorView != null) acceptPendingDiff(editorView);
        else modifyWorkbookScripts({ type: ACCEPT_PENDING_DIFF, value: scriptKey });
    }, [editorView, modifyWorkbookScripts, scriptKey]);
    const rejectDiff = React.useCallback(() => {
        if (editorView != null) rejectPendingDiff(editorView);
        else modifyWorkbookScripts({ type: REJECT_PENDING_DIFF, value: scriptKey });
    }, [editorView, modifyWorkbookScripts, scriptKey]);
    // The editor takes the focus once it is there
    React.useEffect(() => {
        if (editorView == null) return;
        const frame = requestAnimationFrame(() => editorView.focus());
        return () => cancelAnimationFrame(frame);
    }, [editorView]);

    if (script == null) return null;
    const displayName = scriptDisplayName(script.fileName);
    return (
        <Overlay
            centered
            width={OverlaySize.XXL}
            // No max height, the overlay keeps the dialog inside a short window
            height={OverlaySize.XL}
            expanded={expanded}
            onEscape={onEscape}
            onClickOutside={ignoreOutsideClick}
        >
            <section
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-label={`Edit ${displayName}`}
                data-expanded={expanded || undefined}
                data-testid="script-editor-dialog"
            >
                <div className={styles.titlebar}>
                    {/* The entry header hides its optional controls when it gets narrow, the window controls stay */}
                    <div className={styles.header_container}>
                        <ScriptEntryHeader
                            workbookScripts={workbookScripts}
                            modifyWorkbookScripts={modifyWorkbookScripts}
                            scriptKey={scriptKey}
                            scriptConnections={props.scriptConnections}
                            scriptReferences={scriptReferences}
                            draftRenameRef={props.draftRenameRef}
                            editorView={editorView}
                            onDelete={remove}
                            className={styles.header}
                        />
                    </div>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label={expanded ? 'Restore size' : 'Expand'}
                        aria-pressed={expanded}
                        data-testid="script-editor-dialog-expand"
                        onClick={() => setExpanded(e => !e)}
                    >
                        {expanded ? <ScreenNormalIcon size={16} /> : <ScreenFullIcon size={16} />}
                    </IconButton>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label={`Close ${displayName}`}
                        data-testid="script-editor-dialog-close"
                        onClick={onClose}
                    >
                        <XIcon size={16} />
                    </IconButton>
                </div>
                <div className={styles.body}>
                    <ScriptEditor
                        key={scriptKey}
                        workbookId={workbookId}
                        scriptKey={scriptKey}
                        className={styles.editor}
                        setView={setEditorView}
                        onNavigateToScript={props.onNavigateToScript}
                    />
                    {script.pendingDiff != null && (
                        <ButtonGroup className={styles.diff_actions} aria-label="Accept or reject the rewrite">
                            <IconButton variant={ButtonVariant.Default} size={ButtonSize.Small} aria-label="Accept rewrite" data-testid="diff-accept" onClick={acceptDiff}>
                                <CheckIcon size={14} />
                            </IconButton>
                            <IconButton variant={ButtonVariant.Default} size={ButtonSize.Small} aria-label="Reject rewrite" data-testid="diff-reject" onClick={rejectDiff}>
                                <XIcon size={14} />
                            </IconButton>
                        </ButtonGroup>
                    )}
                </div>
                {status.kind !== EntryStatusKind.Idle && (
                    <div className={styles.status}>
                        <EntryStatusBar
                            status={status}
                            onCancel={status.indicator === IndicatorStatus.Running ? cancel : undefined}
                            cancelLabel="Cancel query"
                            compact
                        />
                    </div>
                )}
            </section>
        </Overlay>
    );
}
