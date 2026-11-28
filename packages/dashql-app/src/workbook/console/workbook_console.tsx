import * as React from 'react';
import * as styles from './workbook_console.module.css';
import type * as dashql from '@akohn/dashql';
import type { EditorView } from '@codemirror/view';

import { useOptionalRuntime, useScriptReferences, useViewSelector } from '@akohn/dashql-react/hooks';
import { useScriptModel } from '@akohn/dashql-react/models/script_model';
import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';
import type { ModifyWorkbookScripts, WorkbookDerived, WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { quoteIdentifier as quoteSqlIdentifier } from '@akohn/dashql/platform/utils/sql_quote';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { useAppConfig } from '../../config/app_config.js';
import { useLogger } from '../../host/logger_provider.js';
import { useStorageReader } from '../../storage/storage_provider.js';
import { renameAttachment, type RenameDraftReferences } from '../attachment_rename.js';
import { insertMentionAtCursor } from '../editor/editor_focus.js';
import { ScriptEntryHeader } from '../feed/script_entry_header.js';
import { WorkbookDataCard } from '../feed/workbook_data_card.js';
import { WorkbookInputStrip } from '../inputs/workbook_input_strip.js';
import { createScriptAction } from '../scripts/script_creation.js';
import { ScriptEditor } from '../scripts/script_editor.js';
import { deleteScript, useScriptSelection, useSelectedScriptKey } from '../scripts/script_selection.js';
import { StageSection } from '../stage_section.js';
import { useWorkbookReadOnly } from '../workbook_read_only.js';
import { ConsoleLayout, type ConsoleTab } from './console_layout.js';
import { SqlKeyBar } from '../editor/sql_key_bar.js';
import { ConsoleResults } from './console_results.js';

const LOG_CTX = 'workbook_console';
const NO_ATTACHMENTS: readonly dashql.WorkbookAttachmentView[] = [];
const NO_FILE_NAMES: readonly string[] = [];
const selectCollidingAttachments = (derived: WorkbookDerived | null) => derived?.collidingAttachments ?? NO_FILE_NAMES;

/// A script that the console shows, a new request shows it again
export interface ConsoleRevealRequest {
    scriptKey: number;
}

export interface WorkbookConsoleProps {
    workbookScripts: WorkbookScripts;
    modifyWorkbookScripts: ModifyWorkbookScripts;
    /// The connections that the scripts run on
    scriptConnections: ReadonlyMap<string, ConnectionState>;
    /// The connection that the next script runs on, it reads the attachments
    connection: ConnectionState | null;
    /// Renames the references in the draft of the composer, for renamed attachments
    draftRenameRef?: React.RefObject<RenameDraftReferences | null>;
    /// A script to show, e.g. one that the prompt created: its tab becomes the active one
    revealRequest?: ConsoleRevealRequest | null;
}

/// The console of a workbook: a tab per script, the active tab is the selected script of the workbook. The editor of
/// the script shows over the results of its latest query, the parameters and the attachments of the workbook in the
/// sidebar.
export function WorkbookConsole(props: WorkbookConsoleProps): React.ReactElement {
    const { workbookScripts, modifyWorkbookScripts, scriptConnections } = props;
    const workbookId = workbookScripts.workbookId;
    const selection = useScriptSelection();
    const selectedKey = useSelectedScriptKey(workbookId);
    const { scriptOrder, scriptKeys } = workbookScripts;
    const tabs = React.useMemo<ConsoleTab[]>(() => scriptOrder.flatMap((fileName, index) => {
        const scriptKey = scriptKeys[index];
        return scriptKey == null ? [] : [{ scriptKey, label: scriptDisplayName(fileName) }];
    }), [scriptOrder, scriptKeys]);
    const selectTab = React.useCallback((scriptKey: number) => selection.select(workbookId, scriptKey), [selection, workbookId]);
    // A script that the prompt appended becomes the active tab
    const revealRequest = props.revealRequest;
    React.useEffect(() => {
        if (revealRequest != null) selection.select(workbookId, revealRequest.scriptKey);
    }, [revealRequest, selection, workbookId]);

    // A read-only workbook adds no scripts and runs none
    const readOnly = useWorkbookReadOnly();
    // A created script is selected, its editor takes the focus once it is there
    const focusScript = React.useRef<number | null>(null);
    const addTab = React.useCallback(() => {
        const outcome = modifyWorkbookScripts(createScriptAction(workbookScripts, {}));
        if (!outcome.ok || typeof outcome.id !== 'number') return;
        focusScript.current = outcome.id;
        selection.select(workbookId, outcome.id);
    }, [modifyWorkbookScripts, workbookScripts, selection, workbookId]);

    const model = useScriptModel(workbookId, selectedKey);
    const scriptKey = model?.script.scriptKey ?? null;
    const references = useScriptReferences(workbookId, scriptKey);
    const [editorView, setEditorView] = React.useState<EditorView | null>(null);
    React.useEffect(() => {
        if (editorView == null || focusScript.current == null || focusScript.current !== scriptKey) return;
        focusScript.current = null;
        editorView.focus();
    }, [editorView, scriptKey]);
    const removeScript = React.useCallback((script: { fileName: string }) => {
        deleteScript(selection, workbookScripts, modifyWorkbookScripts, script.fileName);
    }, [selection, workbookScripts, modifyWorkbookScripts]);

    return (
        <ConsoleLayout
            tabs={tabs}
            activeTab={scriptKey}
            onSelectTab={selectTab}
            // A run of the script shows its results on a compact window
            runKey={model?.query?.queryId ?? null}
            onAddTab={readOnly ? undefined : addTab}
            header={() => scriptKey != null && (
                // The entry header hides its optional controls when it gets narrow
                <div className={styles.header_container}>
                    <ScriptEntryHeader
                        workbookScripts={workbookScripts}
                        modifyWorkbookScripts={modifyWorkbookScripts}
                        scriptKey={scriptKey}
                        scriptConnections={scriptConnections}
                        scriptReferences={references}
                        editorView={editorView}
                        onDelete={removeScript}
                        // The script runs from the bar of the workbook, with what it needs
                        execute={false}
                        className={styles.header}
                    />
                </div>
            )}
            editor={() => scriptKey != null && (
                <ScriptEditor
                    key={scriptKey}
                    workbookId={workbookId}
                    scriptKey={scriptKey}
                    className={styles.editor}
                    setView={setEditorView}
                    onNavigateToScript={selectTab}
                />
            )}
            results={() => model != null && <ConsoleResults model={model} />}
            keyBar={() => scriptKey != null && (
                <SqlKeyBar editor={editorView} onRun={readOnly || model == null ? undefined : () => void model.run()} />
            )}
            sidebar={() => (
                <>
                    <WorkbookInputStrip workbookId={workbookId} modifyWorkbookScripts={modifyWorkbookScripts} className={styles.inputs} />
                    <ConsoleAttachments
                        workbookScripts={workbookScripts}
                        connection={props.connection}
                        editorView={editorView}
                        draftRenameRef={props.draftRenameRef}
                    />
                </>
            )}
        />
    );
}

interface ConsoleAttachmentsProps {
    workbookScripts: WorkbookScripts;
    connection: ConnectionState | null;
    /// The editor of the active script, a mention of an attachment writes its table parameter there
    editorView: EditorView | null;
    draftRenameRef?: React.RefObject<RenameDraftReferences | null>;
}

/// The attachments of the workbook in the sidebar of the console. The feed attaches the files, dropped on the page or
/// picked in its menu, the section appears with the first one.
function ConsoleAttachments(props: ConsoleAttachmentsProps): React.ReactElement | null {
    const { workbookScripts, editorView, draftRenameRef } = props;
    const workbookId = workbookScripts.workbookId;
    const visible = useAppConfig()?.settings?.experimental_file_attachments === true;
    const attachments = workbookScripts.attachments ?? NO_ATTACHMENTS;
    const colliding = useViewSelector('workbookDerived', workbookId, selectCollidingAttachments);
    const runtime = useOptionalRuntime();
    const storageReader = useStorageReader();
    const logger = useLogger();
    const [error, setError] = React.useState<string | null>(null);
    const mention = React.useCallback((name: string) => {
        if (editorView == null) return;
        insertMentionAtCursor(editorView, `:${runtime?.core?.quoteIdentifier(name) ?? quoteSqlIdentifier(name)}`);
    }, [editorView, runtime]);
    // An attachment renames like a script, the scripts and the draft that read it follow
    const rename = React.useCallback((fileName: string, name: string) => {
        if (runtime == null) return;
        setError(null);
        void renameAttachment(runtime, workbookScripts, fileName, name, draftRenameRef?.current).catch(e => {
            setError('Renaming attachment failed');
            logger.error('Renaming workbook attachment failed', { workbookId, error: stringifyError(e) }, LOG_CTX);
        });
    }, [runtime, workbookScripts, draftRenameRef, logger, workbookId]);
    if (!visible || attachments.length === 0) return null;
    return (
        <StageSection label="Attachments" testId="console-attachments" className={styles.attachments}>
            <div className={styles.attachment_cards}>
                {attachments.map(attachment => (
                    <WorkbookDataCard key={`${workbookId}/${attachment.fileName}`} workbookId={workbookId}
                        attachment={attachment} conn={props.connection} storageReader={storageReader}
                        onRemove={async () => { await runtime?.detachFile(workbookId, attachment.fileName); }}
                        onMention={mention}
                        onRename={name => rename(attachment.fileName, name)}
                        collides={colliding.includes(attachment.fileName)} />
                ))}
            </div>
            {error != null && <div className={styles.attachment_error} role="alert">{error}</div>}
        </StageSection>
    );
}
