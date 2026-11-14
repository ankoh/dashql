import * as React from 'react';

import { filterInvalidWorkbookCatalogs, renameBundleCatalogs, type WorkbookBundle, type WorkbookBundleWriteStep } from '@ankoh/dashql-runtime/storage/workbook_bundle';
import type { PreparedNativeWorkbook } from '../../storage/composite_storage_backend.js';
import type { CompositeStorageBackend } from '../../storage/composite_storage_backend.js';
import {
    findWorkbookImportConflict,
    type WorkbookImportConflict,
    prepareNativeWorkbookImport,
    registerNativeWorkbook,
    replaceWorkbookWithNativeFolder,
    replaceWorkbookWithPortableBundle,
    writePortableWorkbookFresh,
} from '../../storage/workbook_import_transaction.js';
import { displayPath } from '../../storage/workbook_locator.js';
import { useStorage } from '../../storage/storage_provider.js';
import { restoreSingleWorkbook } from '@ankoh/dashql-runtime/workbook/persistence/app_state_loader';
import { mergeRestoredWorkbookIntoConnections, mergeRestoredWorkbookIntoScripts } from '@ankoh/dashql-runtime/workbook/persistence/app_state_loader';
import { connectionEntryFromState, findWorkbookQueries, useConnectionReferences, useConnectionRegistrySetter, useConnectionRegistryStore } from '../../connections/connection_registry.js';
import type { ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { isHyperWasmConnection } from '@ankoh/dashql-runtime/connections/connection_label';
import { getConnectorInfoForParams } from '@ankoh/dashql-runtime/connections/connector_info';
import { useWorkbookScriptsRegistrySetter } from '../scripts/workbook_scripts_registry.js';
import { useDashQLCoreSetup } from '../../runtime/core_provider.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useCancelQuery } from '../../connections/query_executor.js';
import type { WorkbookImportCardDependencies } from './workbook_import_card.js';
import { WorkbookImportConflictDialog } from './workbook_import_conflict_dialog.js';
import { WorkbookConnectionImportDialog } from './workbook_connection_import_dialog.js';
import { StorageBackendType, type ConnectionEntry } from '@ankoh/dashql-runtime/storage/storage_backend';
import {
    applyConnectionImportPlan,
    connectionImportQuestions,
    connectionRefsChanged,
    planConnectionImport,
    type ConnectionImportChoice,
    type ConnectionImportPlanItem,
} from '@ankoh/dashql-runtime/workbook/persistence/workbook_connection_import';
import { AppHost, getAppHost } from '@ankoh/dashql-runtime/platform/native_globals';
import { useQueryResultCache } from '../../storage/query_result_cache_provider.js';
import { failedWorkbookQueryResults, importWorkbookQueryResults, type ImportedWorkbookQueryResults } from '@ankoh/dashql-runtime/workbook/persistence/workbook_query_results';
import { stringifyError } from '@ankoh/dashql-runtime/platform/logger/logger';

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
    | { step: 'results'; total: number; outcome: ImportedWorkbookQueryResults | null }
    | { step: 'workbook' }
    /// The parts of the saved workbook, reported by a fresh import only
    | { step: WorkbookBundleWriteStep }
    /// The saved workbook is restored into the app, reported by a fresh import only
    | { step: 'open' };

export type WorkbookImportProgressConsumer = (progress: WorkbookImportProgress) => void;

export interface PortableWorkbookImportOptions {
    presentation: ImportPresentation;
    reloadAfterSuccess?: boolean;
    /// Follow the steps of the import, e.g. to show the query results that weren't added
    onProgress?: WorkbookImportProgressConsumer;
    /// How the connections of the workbook map to the connections of the app. `ask` asks about the connections that
    /// may consolidate with existing ones. `preview` asks nothing: such a connection uses the first existing one, a
    /// preview of a published workbook is imported again with the questions when the user imports it.
    connections?: 'ask' | 'preview';
    /// The mapping of the connections, once it is decided
    onConnections?: (mapping: WorkbookImportConnectionMapping) => void;
}

/// How the connections of an imported workbook were mapped
export interface WorkbookImportConnectionMapping {
    /// The connections that the import registered, the app didn't have them
    registered: string[];
    /// Did a connection use an existing one that the user would have been asked about?
    unasked: boolean;
}

/// A registered workbook with the id of an imported one
export interface PortableImportConflict {
    displayLocation: string;
    isNative: boolean;
}

/// An import whose decisions are made, nothing is written yet
export interface PreparedPortableImport {
    /// The validated bundle with the resolved connections, still with its query results
    bundle: WorkbookBundle;
    /// The registered workbook with the same id, the import replaces it or creates a new workbook
    conflict: PortableImportConflict | null;
}

interface WorkbookImportContextValue {
    findPortableBundleConflict(bundle: WorkbookBundle): Promise<PortableImportConflict | null>;
    /// Validate a bundle and resolve its connections, null if the user cancelled. Writes nothing.
    preparePortableImport(bundle: WorkbookBundle, onProgress?: WorkbookImportProgressConsumer): Promise<PreparedPortableImport | null>;
    /// Add the query results of a prepared import to the cache and save its workbook. The choice decides a conflict.
    commitPortableImport(prepared: PreparedPortableImport, choice: ConflictChoice | null, onProgress?: WorkbookImportProgressConsumer): Promise<string>;
    importPortableBundleWithChoice(bundle: WorkbookBundle, choice: ConflictChoice): Promise<string | null>;
    importPortableBundle(bundle: WorkbookBundle, options: PortableWorkbookImportOptions): Promise<string | null>;
    importNativeFolder(dir: string, presentation: ImportPresentation): Promise<string | null>;
}

export type ConflictChoice = 'replace' | 'create-new';

interface ConflictDialogState {
    bundle: WorkbookBundle;
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
    questions: ConnectionImportPlanItem[];
    /// Resolve with the choices, null if the import was cancelled
    resolve(choices: Map<string, ConnectionImportChoice> | null): void;
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
    const setupCore = useDashQLCoreSetup();
    const [reader, writer] = useStorage();
    // Read the registry when importing instead of re-creating the import context for every query event
    const connectionStore = useConnectionRegistryStore();
    const references = useConnectionReferences();
    const setConnections = useConnectionRegistrySetter();
    const setScripts = useWorkbookScriptsRegistrySetter();
    const cancelQuery = useCancelQuery();
    const queryResultCache = useQueryResultCache();
    const [dialog, setDialog] = React.useState<ConflictDialogState | null>(null);
    const [connectionDialog, setConnectionDialog] = React.useState<ConnectionDialogState | null>(null);

    const backend = reader.workbookFolders;

    const validatePortableBundle = React.useCallback(async (bundle: WorkbookBundle): Promise<WorkbookBundle> => {
        const core = await setupCore('workbook_import_validation');
        const validation = filterInvalidWorkbookCatalogs(core, bundle);
        if (validation.invalidFiles.length > 0) {
            logger.warn('ignored malformed workbook catalog files', {
                workbookId: bundle.workbook.workbookId,
                files: validation.invalidFiles.join(', '),
            }, 'workbook_import');
        }
        return validation.bundle;
    }, [logger, setupCore]);

    /// Add the cached query results of an imported workbook to the cache of the app, the results of the app win. The
    /// results are no part of the workbook, a failure leaves the import alone.
    const importQueryResults = React.useCallback(async (bundle: WorkbookBundle, report?: WorkbookImportProgressConsumer): Promise<WorkbookBundle> => {
        const results = bundle.results ?? [];
        if (results.length === 0) return bundle;
        const workbookId = bundle.workbook.workbookId;
        const bytes = results.reduce((sum, result) => sum + result.bytes.size, 0);
        report?.({ step: 'results', total: results.length, outcome: null });
        if (queryResultCache == null) {
            logger.warn('ignored the query results of an imported workbook, results are not cached', {
                workbookId, results: results.length.toString(), bytes: bytes.toString(),
            }, 'workbook_import');
            report?.({ step: 'results', total: results.length, outcome: failedWorkbookQueryResults(results.length, 'This app does not cache query results') });
        } else {
            logger.info('importing the query results of a workbook', { workbookId, results: results.length.toString(), bytes: bytes.toString() }, 'workbook_import');
            const started = performance.now();
            try {
                const outcome = await importWorkbookQueryResults(queryResultCache, results, logger);
                const fields = {
                    workbookId, results: results.length.toString(), added: outcome.added.toString(), kept: outcome.kept.toString(),
                    failed: outcome.failed.toString(), dropped: outcome.dropped.toString(), bytes: outcome.bytes.toString(), durationMs: Math.round(performance.now() - started).toString(),
                };
                if (outcome.failed > 0 || outcome.dropped > 0) logger.warn('imported the query results of a workbook, some were left out', fields, 'workbook_import');
                else logger.info('imported the query results of a workbook', fields, 'workbook_import');
                report?.({ step: 'results', total: results.length, outcome });
            } catch (error) {
                logger.warn('importing the query results of a workbook failed', { workbookId, error: stringifyError(error) }, 'workbook_import');
                report?.({ step: 'results', total: results.length, outcome: failedWorkbookQueryResults(results.length, error) });
            }
        }
        const { results: _results, ...rest } = bundle;
        return rest;
    }, [logger, queryResultCache]);

    /// Map the connections of an imported workbook to the connections of the app.
    /// Connections that may consolidate with existing ones are decided by the user, null if the
    /// user cancelled the import.
    const resolveConnections = React.useCallback(async (
        bundle: WorkbookBundle,
        report?: WorkbookImportProgressConsumer,
        mode: 'ask' | 'preview' = 'ask',
        onMapping?: (mapping: WorkbookImportConnectionMapping) => void,
    ): Promise<WorkbookBundle | null> => {
        report?.({ step: 'connections' });
        if (backend == null) return bundle;
        // The live connections may be ahead of the manifest while writes are debounced
        const live = connectionStore.current;
        const entries: ConnectionEntry[] = ((await backend.loadManifest()).connections ?? [])
            .map(entry => ({ ...entry, params: live.connections.get(entry.id)?.params ?? entry.params }))
            // The restoration skips a connection of an unknown connector, e.g. one that a tab of an older version wrote
            // after the migration, the import leaves it out as well
            .filter(entry => {
                if (entry.params != null && getConnectorInfoForParams(entry.params) != null) return true;
                logger.warn('ignored a stored connection of an unknown connector', {
                    connectionId: entry.id, keys: Object.keys(entry.params ?? {}).join(','),
                }, 'workbook_import');
                return false;
            });
        // The embedded database always takes the embedded databases of the imported workbook
        for (const [connectionId, connection] of live.connections) {
            if (!entries.some(entry => entry.id === connectionId)
                && (references.workbooksOf(connectionId).length > 0 || isHyperWasmConnection(connection))) {
                entries.push(connectionEntryFromState({ ...connection, paramsDraft: undefined }));
            }
        }
        const plan = planConnectionImport(bundle.workbook, entries);
        const questions = connectionImportQuestions(plan);
        let choices = new Map<string, ConnectionImportChoice>();
        if (mode === 'preview') {
            // A preview asks nothing, the import of the preview asks
            for (const question of questions) {
                if (question.decision.kind === 'ask') choices.set(question.ref.connectionId, { kind: 'link', connectionId: question.decision.candidates[0].id });
            }
        } else if (questions.length > 0) {
            const workbookName = bundle.workbook.name?.trim() || bundle.workbook.metadata.originalFileName || 'Unnamed workbook';
            const chosen = await new Promise<Map<string, ConnectionImportChoice> | null>(resolve => {
                setConnectionDialog({ workbookName, questions, resolve });
            });
            setConnectionDialog(null);
            if (chosen == null) return null;
            choices = chosen;
        }
        const { workbook, connectionIds } = applyConnectionImportPlan(bundle.workbook, plan, choices, entries);
        onMapping?.({
            registered: workbook.connections.map(connection => connection.connectionId).filter(id => !entries.some(entry => entry.id === id)),
            unasked: mode === 'preview' && questions.length > 0,
        });
        logger.info('resolved the connections of an imported workbook', {
            workbookId: bundle.workbook.workbookId,
            connections: plan.map(item => item.decision.kind).join(','),
        }, 'workbook_import');
        return { ...bundle, workbook, catalogs: renameBundleCatalogs(bundle.catalogs, connectionIds) };
    }, [backend, connectionStore, logger, references]);

    /// Resolve the connections, then add the query results to the cache: the last decision of an import is made then
    const resolveAndImportResults = React.useCallback(async (
        bundle: WorkbookBundle,
        report?: WorkbookImportProgressConsumer,
        mode?: 'ask' | 'preview',
        onMapping?: (mapping: WorkbookImportConnectionMapping) => void,
    ): Promise<WorkbookBundle | null> => {
        const resolved = await resolveConnections(bundle, report, mode, onMapping);
        return resolved == null ? null : await importQueryResults(resolved, report);
    }, [importQueryResults, resolveConnections]);

    const stopWorkbookWork = React.useCallback(async (workbookId: string) => {
        const databases = references.connectionsOf(workbookId)
            .map(connectionId => connectionStore.current.connections.get(connectionId))
            .filter((database): database is ConnectionState => database != null);
        // Connections may be shared, only the queries of the workbook are cancelled
        await Promise.all(databases.flatMap(database => findWorkbookQueries(database, workbookId, false).map(queryId =>
            cancelQuery(database.connectionId, queryId)
        )));
        writer.pause();
        try {
            await writer.flush();
        } catch (error) {
            writer.resume();
            throw error;
        }
    }, [cancelQuery, connectionStore, references, writer]);

    const restoreFreshPortable = React.useCallback(async (
        bundle: WorkbookBundle,
        targetWorkbookId: string,
        suffixNameWithCopy: boolean,
        report?: WorkbookImportProgressConsumer,
    ) => {
        if (backend == null) throw new Error('Workbook imports require composite storage');
        const importedBundle = suffixNameWithCopy
            ? withFreshIdentity(bundle, targetWorkbookId)
            : bundle;
        await writePortableWorkbookFresh(backend, importedBundle, targetWorkbookId, step => report?.({ step }));
        // The same bundle may have been imported and deleted before in this tab
        writer.reviveWorkbook(targetWorkbookId);
        report?.({ step: 'open' });
        try {
            const core = await setupCore('workbook_import');
            const restored = await restoreSingleWorkbook(
                core,
                backend,
                logger,
                targetWorkbookId,
                connectionStore.current,
            );
            setConnections(registry => mergeRestoredWorkbookIntoConnections(registry, restored));
            setScripts(registry => mergeRestoredWorkbookIntoScripts(registry, restored));
            return targetWorkbookId;
        } catch (error) {
            try {
                await backend.deletePortableWorkbook(targetWorkbookId);
            } catch {
                // Preserve the restoration error.
            }
            throw error;
        }
    }, [backend, connectionStore, logger, setConnections, setScripts, setupCore, writer]);

    const requestConflictChoice = React.useCallback((
        bundle: WorkbookBundle,
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
                return { bundle, existingDisplayLocation, presentation, busy: false, run, resolve };
            });
        });
    }, [logger]);

    const importPortableBundle = React.useCallback(async (
        bundle: WorkbookBundle,
        options: PortableWorkbookImportOptions,
    ): Promise<string | null> => {
        if (backend == null) throw new Error('Workbook imports require composite storage');
        const validated = await validatePortableBundle(bundle);
        // Whether the workbook is already registered is asked before the connections, resolving them
        // keeps the workbook id
        const conflict = await findWorkbookImportConflict(backend, validated.workbook.workbookId);
        const report = options.onProgress;
        if (conflict == null) {
            const resolved = await resolveAndImportResults(validated, report, options.connections, options.onConnections);
            if (resolved == null) return null;
            bundle = resolved;
            const workbookId = bundle.workbook.workbookId;
            report?.({ step: 'workbook' });
            if (options.reloadAfterSuccess) {
                await reloadThen(() => writePortableWorkbookFresh(backend, bundle, workbookId), writer, reload);
            } else {
                await restoreFreshPortable(bundle, workbookId, false, report);
            }
            return workbookId;
        }

        return await requestConflictChoice(
            validated,
            displayPath(conflict.workbookId, conflict.location),
            options.presentation,
            async choice => {
                const bundle = await resolveAndImportResults(validated, report);
                if (bundle == null) return null;
                report?.({ step: 'workbook' });
                if (choice === 'create-new') {
                    const workbookId = crypto.randomUUID();
                    const importedBundle = withFreshIdentity(bundle, workbookId);
                    if (options.reloadAfterSuccess) {
                        await reloadThen(() => writePortableWorkbookFresh(backend, importedBundle, workbookId), writer, reload);
                    } else {
                        await restoreFreshPortable(bundle, workbookId, true);
                    }
                    return workbookId;
                }
                await stopWorkbookWork(conflict.workbookId);
                try {
                    const workbookId = await replaceWorkbookWithPortableBundle(backend, bundle, conflict);
                    reload();
                    return workbookId;
                } catch (error) {
                    writer.resume();
                    throw error;
                }
            },
        );
    }, [backend, reload, requestConflictChoice, resolveAndImportResults, restoreFreshPortable, stopWorkbookWork, validatePortableBundle, writer]);

    const findPortableBundleConflict = React.useCallback(async (bundle: WorkbookBundle): Promise<{ displayLocation: string; isNative: boolean } | null> => {
        if (backend == null) throw new Error('Workbook imports require composite storage');
        const conflict = await findWorkbookImportConflict(backend, bundle.workbook.workbookId);
        return conflict == null ? null : {
            displayLocation: displayPath(conflict.workbookId, conflict.location),
            isNative: conflict.location.type === StorageBackendType.Native,
        };
    }, [backend]);

    const preparePortableImport = React.useCallback(async (
        bundle: WorkbookBundle,
        report?: WorkbookImportProgressConsumer,
    ): Promise<PreparedPortableImport | null> => {
        if (backend == null) throw new Error('Workbook imports require composite storage');
        const validated = await validatePortableBundle(bundle);
        const conflict = await findPortableBundleConflict(validated);
        const resolved = await resolveConnections(validated, report);
        return resolved == null ? null : { bundle: resolved, conflict };
    }, [backend, findPortableBundleConflict, resolveConnections, validatePortableBundle]);

    const commitPortableImport = React.useCallback(async (
        prepared: PreparedPortableImport,
        choice: ConflictChoice | null,
        report?: WorkbookImportProgressConsumer,
    ): Promise<string> => {
        if (backend == null) throw new Error('Workbook imports require composite storage');
        const bundle = await importQueryResults(prepared.bundle, report);
        report?.({ step: 'workbook' });
        // The registered workbooks may have changed since the import was prepared
        const conflict = await findWorkbookImportConflict(backend, bundle.workbook.workbookId);
        if (conflict == null) return await restoreFreshPortable(bundle, bundle.workbook.workbookId, false);
        if (choice == null) throw new Error(`A workbook with the id ${bundle.workbook.workbookId} was added meanwhile`);
        if (choice === 'create-new') {
            const workbookId = crypto.randomUUID();
            return await restoreFreshPortable(bundle, workbookId, true);
        }
        await stopWorkbookWork(conflict.workbookId);
        try {
            const workbookId = await replaceWorkbookWithPortableBundle(backend, bundle, conflict);
            reload();
            return workbookId;
        } catch (error) {
            writer.resume();
            throw error;
        }
    }, [backend, importQueryResults, reload, restoreFreshPortable, stopWorkbookWork, writer]);

    const importPortableBundleWithChoice = React.useCallback(async (
        bundle: WorkbookBundle,
        choice: ConflictChoice,
    ): Promise<string | null> => {
        const prepared = await preparePortableImport(bundle);
        return prepared == null ? null : await commitPortableImport(prepared, choice);
    }, [commitPortableImport, preparePortableImport]);

    const importNativeFolder = React.useCallback(async (
        dir: string,
        presentation: ImportPresentation,
    ): Promise<string | null> => {
        if (backend == null) throw new Error('Native workbook imports require composite storage');
        const original = await prepareNativeWorkbookImport(backend, dir);
        // The folder is registered untouched, references to consolidated connections are written after
        const resolve = async () => {
            const resolved = await resolveConnections(original.bundle);
            if (resolved == null) return null;
            const prepared: PreparedNativeWorkbook = { ...original, bundle: resolved };
            return { prepared, refsChanged: connectionRefsChanged(original.bundle.workbook, resolved.workbook) };
        };
        const conflict = await findWorkbookImportConflict(backend, original.bundle.workbook.workbookId);
        if (conflict == null) {
            const resolution = await resolve();
            if (resolution == null) return null;
            const { prepared, refsChanged } = resolution;
            await reloadThen(async () => {
                const workbookId = await registerNativeWorkbook(backend, prepared);
                if (refsChanged) await writeNativeConnectionRefs(backend, workbookId, prepared.bundle);
                return workbookId;
            }, writer, reload);
            return prepared.bundle.workbook.workbookId;
        }
        return await requestConflictChoice(
            original.bundle,
            displayPath(conflict.workbookId, conflict.location),
            presentation,
            async choice => {
                const resolution = await resolve();
                if (resolution == null) return null;
                return await runNativeConflict(choice, resolution.prepared, resolution.refsChanged, conflict, backend, writer, stopWorkbookWork, reload);
            },
        );
    }, [backend, reload, requestConflictChoice, resolveConnections, stopWorkbookWork, writer]);

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
        findPortableBundleConflict,
        preparePortableImport,
        commitPortableImport,
        importPortableBundleWithChoice,
        importPortableBundle,
        importNativeFolder,
    }), [commitPortableImport, findPortableBundleConflict, importNativeFolder, importPortableBundle, importPortableBundleWithChoice, preparePortableImport]);

    return (
        <WORKBOOK_IMPORT_CTX.Provider value={value}>
            <div
                aria-hidden={dialog?.presentation.mode === 'centered' || undefined}
                style={{ display: dialog?.presentation.mode === 'centered' ? 'none' : 'contents' }}
            >
                {props.children}
            </div>
            {/* The connections are asked after the conflict choice, the conflict dialog waits behind them */}
            {connectionDialog == null && dialog?.presentation.mode === 'centered' && renderConflictDialog(dialog, handleChoice, cancelDialog, card)}
            {connectionDialog == null && dialog?.presentation.mode === 'anchored' && renderConflictDialog(dialog, handleChoice, cancelDialog, card)}
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

/// Give an imported workbook a new identity.
/// The connections keep their ids, the connections of the copy were resolved by the import.
function withFreshIdentity(bundle: WorkbookBundle, workbookId: string): WorkbookBundle {
    const workbook = { ...bundle.workbook, workbookId };
    const name = workbook.name?.trim();
    if (name) workbook.name = `${name} (copy)`;
    return { ...bundle, workbook };
}

async function reloadThen<T>(operation: () => Promise<T>, writer: ReturnType<typeof useStorage>[1], reload: () => void): Promise<T> {
    writer.pause();
    try {
        await writer.flush();
        const result = await operation();
        reload();
        return result;
    } catch (error) {
        writer.resume();
        throw error;
    }
}

/// Write the resolved connection references into a registered native folder
async function writeNativeConnectionRefs(backend: CompositeStorageBackend, workbookId: string, bundle: WorkbookBundle): Promise<void> {
    const existing = await backend.loadWorkbook(workbookId);
    await backend.saveWorkbookManifest(workbookId, {
        ...existing,
        connections: bundle.workbook.connections,
        scripts: bundle.workbook.scripts,
    });
}

async function runNativeConflict(
    choice: ConflictChoice,
    prepared: PreparedNativeWorkbook,
    refsChanged: boolean,
    conflict: WorkbookImportConflict,
    backend: CompositeStorageBackend,
    writer: ReturnType<typeof useStorage>[1],
    stopWorkbookWork: (workbookId: string) => Promise<void>,
    reload: () => void,
): Promise<string> {
    if (choice === 'create-new') {
        const workbookId = crypto.randomUUID();
        const bundle = withFreshIdentity(prepared.bundle, workbookId);
        return await reloadThen(() => writePortableWorkbookFresh(backend, bundle, workbookId), writer, reload);
    }
    await stopWorkbookWork(conflict.workbookId);
    try {
        const workbookId = await replaceWorkbookWithNativeFolder(backend, prepared, conflict);
        if (refsChanged) await writeNativeConnectionRefs(backend, workbookId, prepared.bundle);
        reload();
        return workbookId;
    } catch (error) {
        writer.resume();
        throw error;
    }
}

function renderConflictDialog(
    dialog: ConflictDialogState,
    handleChoice: (choice: ConflictChoice) => Promise<void>,
    onCancel: () => void,
    dependencies: WorkbookImportCardDependencies | undefined,
): React.ReactElement {
    const common = {
        workbookName: dialog.bundle.workbook.name?.trim()
            || dialog.bundle.workbook.metadata.originalFileName
            || 'Unnamed workbook',
        workbookUuid: dialog.bundle.workbook.workbookId,
        folderCount: 0,
        scriptCount: dialog.bundle.scripts.length,
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
