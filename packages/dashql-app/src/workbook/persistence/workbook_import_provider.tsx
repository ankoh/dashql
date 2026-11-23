import * as React from 'react';
import type * as core from '@akohn/dashql';

import type { ImportSource } from '@akohn/dashql/runtime/runtime';
import { StorageBackendType, type WorkbookData, type WorkbookEntry } from '@akohn/dashql/platform/storage/storage_backend';
import { findWorkbookQueries, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { displayPath, locationFromEntry } from '@akohn/dashql/platform/storage/workbook_locator';
import { useStorageReader } from '../../storage/storage_provider.js';
import { useLogger } from '../../host/logger_provider.js';
import type { WorkbookImportCardDependencies } from './workbook_import_card.js';
import { WorkbookImportConflictDialog } from './workbook_import_conflict_dialog.js';
import { WorkbookConnectionImportDialog } from './workbook_connection_import_dialog.js';
import { AppHost, getAppHost } from '@akohn/dashql-react/dom/app_host';
import { useRuntime } from '@akohn/dashql-react/hooks';

// The imports of workbooks in the app. The runtime reads a source (a `.dashql` archive, a workbook folder or the
// workbook tables of a cloud) into an import of its own, maps its connections to the connections of the app and writes
// it (docs/design/dashql_runtime.md). The provider asks the user what the runtime can't decide: whether to replace a
// registered workbook with the same id, and which existing connections the connections of the workbook use.

type ImportPresentation =
    | { mode: 'centered' }
    | {
        mode: 'anchored';
        anchorRef: React.RefObject<Element | null>;
        returnFocusRef: React.RefObject<HTMLElement | null>;
    };

/// A step of an import, in order: the connections are resolved, the query results go to the cache, the workbook is saved
/// with its scripts and attachments and opened
export type WorkbookImportProgress =
    | { step: 'connections' }
    /// The query results of the workbook, with the outcome once they are added. Only reported if the workbook has some.
    | { step: 'results'; total: number; outcome: core.ImportedResults | null }
    | { step: 'workbook' }
    /// The parts of the saved workbook, reported by a fresh import only
    | { step: 'scripts' | 'attachments' }
    /// The saved workbook is restored into the app, reported by a fresh import only
    | { step: 'open' };

export type WorkbookImportProgressConsumer = (progress: WorkbookImportProgress) => void;

/// The options of an import
export interface WorkbookImportOptions {
    presentation: ImportPresentation;
    /// Reload the app after the import instead of restoring the workbook into it
    reloadAfterSuccess?: boolean;
    /// Follow the steps of the import, e.g. to show the query results that weren't added
    onProgress?: WorkbookImportProgressConsumer;
    /// How the connections of the workbook map to the connections of the app. `ask` asks about the connections that
    /// may consolidate with existing ones. `preview` asks nothing: such a connection uses the first existing one, a
    /// preview of a published workbook is imported again with the questions when the user imports it.
    connections?: 'ask' | 'preview';
    /// The mapping of the connections, once the workbook is written
    onConnections?: (mapping: WorkbookImportConnectionMapping) => void;
    /// The id of the written workbook, the id of the source by default, e.g. a fresh one for a version of a cloud
    workbookId?: string;
    /// The metadata of the written workbook, the metadata of the source by default, e.g. with the link of a cloud
    metadata?: WorkbookData['metadata'];
    /// Add the cached query results of the workbook to the cache, true by default. A link never does.
    results?: boolean;
}

/// How the connections of an imported workbook were mapped
export interface WorkbookImportConnectionMapping {
    /// The connections that the import registered, the app didn't have them
    registered: string[];
    /// Did a connection use an existing one that the user would have been asked about?
    unasked: boolean;
}

/// A registered workbook with the id of an imported one
export interface WorkbookImportConflict {
    /// The id of the registered workbook
    workbookId: string;
    displayLocation: string;
    isNative: boolean;
}

/// The registered workbook with the id of an imported one, null if there is none
export function importConflictOf(preview: core.ImportPreview): WorkbookImportConflict | null {
    const conflict = preview.conflict;
    if (conflict == null) return null;
    const entry = conflict.entry as WorkbookEntry;
    return {
        workbookId: conflict.workbookId,
        displayLocation: displayPath(conflict.workbookId, locationFromEntry(entry)),
        isNative: entry.storageType === StorageBackendType.Native,
    };
}

/// The workbook file of a read import
export function importedWorkbook(preview: core.ImportPreview): WorkbookData {
    return preview.workbook as WorkbookData;
}

/// The name of an imported workbook for display
export function importedWorkbookName(preview: core.ImportPreview): string {
    const workbook = importedWorkbook(preview);
    return workbook.name?.trim() || workbook.metadata.originalFileName || 'Unnamed workbook';
}

/// An import whose decisions about the connections are made, nothing is written yet
export interface PreparedImport {
    /// The import that the runtime read
    preview: core.ImportPreview;
    /// The answers about the connections, by the id of the connection in the workbook
    connections: Record<string, core.ImportChoice>;
    /// Were the questions answered with the first candidates, without asking?
    unasked: boolean;
    /// The registered workbook with the same id, the import replaces it or creates a new workbook
    conflict: WorkbookImportConflict | null;
}

/// What a commit does besides the choice of a conflict
export type WorkbookCommitOptions = Pick<WorkbookImportOptions, 'onProgress' | 'onConnections' | 'workbookId' | 'metadata' | 'results' | 'reloadAfterSuccess'>;

export type ConflictChoice = 'replace' | 'create-new';

interface WorkbookImportContextValue {
    /// Read a source into an import of the runtime, nothing is written. Rejects if the source is no workbook.
    readImport(source: ImportSource): Promise<core.ImportPreview>;
    /// Ask about the connections of a read import, null if the user cancelled. A cancelled import is dropped.
    prepareImport(preview: core.ImportPreview, options?: Pick<WorkbookImportOptions, 'connections' | 'onProgress'>): Promise<PreparedImport | null>;
    /// Write a prepared import, the choice decides a conflict. Resolves with the id of the written workbook. A
    /// replacement and a native folder reload the app.
    commitImport(prepared: PreparedImport, choice: ConflictChoice | null, options?: WorkbookCommitOptions): Promise<string>;
    /// Let go of a read import
    dropImport(preview: core.ImportPreview): void;
    /// Read a source, ask about a conflict and the connections and write it. Null if the user cancelled.
    importWorkbook(source: ImportSource, options: WorkbookImportOptions): Promise<string | null>;
}

interface ConflictDialogState {
    preview: core.ImportPreview;
    existingDisplayLocation: string;
    presentation: ImportPresentation;
    busy: boolean;
    /// Run the import with the choice, null if the user cancelled it while choosing connections
    run(choice: ConflictChoice): Promise<string | null>;
    resolve(value: string | null): void;
}

/// The question whether imported connections should use existing connections
interface ConnectionDialogState {
    /// The name of the imported workbook
    workbookName: string;
    /// The connections that may consolidate
    questions: core.ImportQuestion[];
    /// Resolve with the choices, null if the import was cancelled
    resolve(choices: Map<string, core.ImportChoice> | null): void;
}

const WORKBOOK_IMPORT_CTX = React.createContext<WorkbookImportContextValue | null>(null);

export function useWorkbookImport(): WorkbookImportContextValue {
    const value = React.useContext(WORKBOOK_IMPORT_CTX);
    if (value == null) throw new Error('useWorkbookImport must be used within WorkbookImportProvider');
    return value;
}

/// What the provider needs from the page, tests replace it
export interface WorkbookImportDependencies {
    /// Reload the app, an import that changes registered workbooks runs the restoration again
    reload: () => void;
    /// The dependencies of the card of the conflict dialog
    card?: WorkbookImportCardDependencies;
}

const DEFAULT_DEPENDENCIES: WorkbookImportDependencies = {
    reload: () => globalThis.location.reload(),
};

export function WorkbookImportProvider(props: React.PropsWithChildren<{ dependencies?: WorkbookImportDependencies }>) {
    const { reload, card } = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const logger = useLogger();
    const reader = useStorageReader();
    // The connections are read from the store when importing instead of re-creating the import context for every query
    // event
    const runtime = useRuntime();
    const [dialog, setDialog] = React.useState<ConflictDialogState | null>(null);
    const [connectionDialog, setConnectionDialog] = React.useState<ConnectionDialogState | null>(null);

    const backend = reader.workbookFolders;

    const readImport = React.useCallback(async (source: ImportSource): Promise<core.ImportPreview> => {
        if (backend == null) throw new Error('Workbook imports require composite storage');
        return await runtime.readImport(source);
    }, [backend, runtime]);

    const dropImport = React.useCallback((preview: core.ImportPreview) => {
        runtime.dropImport(preview.importId);
    }, [runtime]);

    /// Map the connections of an imported workbook to the connections of the app. Connections that may consolidate
    /// with existing ones are decided by the user, null if the user cancelled the import.
    const prepareImport = React.useCallback(async (
        preview: core.ImportPreview,
        options: Pick<WorkbookImportOptions, 'connections' | 'onProgress'> = {},
    ): Promise<PreparedImport | null> => {
        options.onProgress?.({ step: 'connections' });
        const questions = preview.questions;
        const prepared = (connections: Record<string, core.ImportChoice>, unasked: boolean): PreparedImport =>
            ({ preview, connections, unasked, conflict: importConflictOf(preview) });
        // A preview asks nothing, the import of the preview asks
        if (options.connections === 'preview' || questions.length === 0) return prepared({}, questions.length > 0);
        // Like the question for a registered workbook, a second import while the question is open is cancelled
        let asked: ConnectionDialogState | null = null;
        const chosen = await new Promise<Map<string, core.ImportChoice> | null>(resolve => {
            const next: ConnectionDialogState = { workbookName: importedWorkbookName(preview), questions, resolve };
            setConnectionDialog(current => {
                if (current != null && current !== next) {
                    resolve(null);
                    logger.warn('ignored workbook import while another connection decision is pending', {}, 'workbook_import');
                    return current;
                }
                asked = next;
                return next;
            });
        });
        setConnectionDialog(current => current === asked ? null : current);
        if (chosen == null) {
            dropImport(preview);
            return null;
        }
        return prepared(Object.fromEntries(chosen), false);
    }, [dropImport, logger]);

    /// Cancel the queries of a workbook before a replacement. The runtime holds the writes while it imports.
    const stopWorkbookWork = React.useCallback(async (workbookId: string) => {
        const databases = (runtime.store.get('workbook', workbookId)?.connectionIds ?? [])
            .map(connectionId => runtime.store.get('connection', connectionId) as ConnectionState | null)
            .filter((database): database is ConnectionState => database != null);
        const readQuery = (queryId: number) => runtime.store.get('query', queryId);
        // Connections may be shared, only the queries of the workbook are cancelled
        await Promise.all(databases.flatMap(database => findWorkbookQueries(database, workbookId, readQuery, false).map(queryId =>
            runtime.cancel(queryId)
        )));
    }, [runtime]);

    const commitImport = React.useCallback(async (
        prepared: PreparedImport,
        choice: ConflictChoice | null,
        options: WorkbookCommitOptions = {},
    ): Promise<string> => {
        if (backend == null) throw new Error('Workbook imports require composite storage');
        const { preview } = prepared;
        // The registered workbooks may have changed since the import was read, the runtime checks again
        const replaces = prepared.conflict != null && choice === 'replace';
        // A replacement and a native folder change registered workbooks, the app restores them again after a reload
        const reloads = replaces || preview.nativePath != null || (options.reloadAfterSuccess ?? false);
        if (replaces) await stopWorkbookWork(prepared.conflict!.workbookId);
        const report = options.onProgress;
        try {
            const outcome = await runtime.commitImport(preview.importId, {
                connections: prepared.connections,
                preview: prepared.unasked,
                conflict: choice ?? undefined,
                workbookId: options.workbookId,
                metadata: options.metadata,
                results: options.results,
                restore: !reloads,
            }, (step, results) => {
                if (step === 'results') report?.({ step, total: preview.results.count, outcome: results });
                else report?.({ step });
            });
            options.onConnections?.({ registered: outcome.registered, unasked: outcome.unasked });
            if (reloads) reload();
            return outcome.workbookId;
        } catch (error) {
            logger.warn('Importing a workbook failed', { workbookId: importedWorkbook(preview).workbookId, error: String(error) }, 'workbook_import');
            throw error;
        }
    }, [backend, runtime, logger, reload, stopWorkbookWork]);

    const requestConflictChoice = React.useCallback((
        preview: core.ImportPreview,
        existingDisplayLocation: string,
        presentation: ImportPresentation,
        run: (choice: ConflictChoice) => Promise<string | null>,
    ): Promise<string | null> => {
        return new Promise<string | null>(resolve => {
            setDialog(current => {
                if (current != null) {
                    resolve(null);
                    logger.warn('ignored workbook import while another decision is pending', {}, 'workbook_import');
                    return current;
                }
                return { preview, existingDisplayLocation, presentation, busy: false, run, resolve };
            });
        });
    }, [logger]);

    const importWorkbook = React.useCallback(async (
        source: ImportSource,
        options: WorkbookImportOptions,
    ): Promise<string | null> => {
        const preview = await readImport(source);
        // Whether the workbook is registered already is asked before the connections
        const conflict = options.workbookId == null ? importConflictOf(preview) : null;
        const run = async (choice: ConflictChoice | null): Promise<string | null> => {
            const prepared = await prepareImport(preview, options);
            if (prepared == null) return null;
            return await commitImport(prepared, choice, options);
        };
        if (conflict == null) {
            try {
                return await run(null);
            } catch (error) {
                dropImport(preview);
                throw error;
            }
        }
        const imported = await requestConflictChoice(preview, conflict.displayLocation, options.presentation, run);
        if (imported == null) dropImport(preview);
        return imported;
    }, [commitImport, dropImport, prepareImport, readImport, requestConflictChoice]);

    const handleChoice = React.useCallback(async (choice: ConflictChoice) => {
        const current = dialog;
        if (current == null || current.busy) return;
        setDialog({ ...current, busy: true });
        try {
            const result = await current.run(choice);
            setDialog(null);
            current.resolve(result);
        } catch (error) {
            logger.error('workbook import failed', { error: String(error) }, 'workbook_import');
            setDialog({ ...current, busy: false });
        }
    }, [dialog, logger]);

    const cancelDialog = React.useCallback(() => {
        if (dialog == null || dialog.busy) return;
        setDialog(null);
        dialog.resolve(null);
    }, [dialog]);

    const value = React.useMemo<WorkbookImportContextValue>(() => ({
        readImport,
        prepareImport,
        commitImport,
        dropImport,
        importWorkbook,
    }), [commitImport, dropImport, importWorkbook, prepareImport, readImport]);

    return (
        <WORKBOOK_IMPORT_CTX.Provider value={value}>
            <div
                aria-hidden={dialog?.presentation.mode === 'centered' || undefined}
                style={{ display: dialog?.presentation.mode === 'centered' ? 'none' : 'contents' }}
            >
                {props.children}
            </div>
            {/* The connections are asked after the conflict choice, the conflict dialog waits behind them */}
            {connectionDialog == null && dialog != null && renderConflictDialog(dialog, handleChoice, cancelDialog, card)}
            {connectionDialog != null && (
                <WorkbookConnectionImportDialog
                    workbookName={connectionDialog.workbookName}
                    questions={connectionDialog.questions}
                    busy={false}
                    onConfirm={choices => connectionDialog.resolve(choices)}
                    onCancel={() => connectionDialog.resolve(null)}
                />
            )}
        </WORKBOOK_IMPORT_CTX.Provider>
    );
}

function renderConflictDialog(
    dialog: ConflictDialogState,
    handleChoice: (choice: ConflictChoice) => Promise<void>,
    onCancel: () => void,
    dependencies: WorkbookImportCardDependencies | undefined,
): React.ReactElement {
    const common = {
        workbookName: importedWorkbookName(dialog.preview),
        workbookUuid: importedWorkbook(dialog.preview).workbookId,
        folderCount: 0,
        scriptCount: dialog.preview.scriptCount,
        existingDisplayLocation: dialog.existingDisplayLocation,
        existingIsNative: getAppHost() === AppHost.ELECTRON && dialog.existingDisplayLocation.startsWith('fs://'),
        busy: dialog.busy,
        onReplace: () => void handleChoice('replace'),
        onCreateNew: () => void handleChoice('create-new'),
        onCancel,
        dependencies,
    };
    return dialog.presentation.mode === 'centered'
        ? <WorkbookImportConflictDialog mode="centered" {...common} />
        : <WorkbookImportConflictDialog
            mode="anchored"
            anchorRef={dialog.presentation.anchorRef}
            returnFocusRef={dialog.presentation.returnFocusRef}
            {...common}
        />;
}
