import * as React from 'react';

import { filterInvalidSessionCatalogs, renameBundleCatalogs, type SessionBundle } from '../../storage/session_bundle.js';
import type { PreparedNativeSession } from '../../storage/composite_storage_backend.js';
import type { CompositeStorageBackend } from '../../storage/composite_storage_backend.js';
import {
    findSessionImportConflict,
    type SessionImportConflict,
    prepareNativeSessionImport,
    registerNativeSession,
    replaceSessionWithNativeFolder,
    replaceSessionWithPortableBundle,
    writePortableSessionFresh,
} from '../../storage/session_import_transaction.js';
import { displayPath } from '../../storage/session_locator.js';
import { useStorage } from '../../storage/storage_provider.js';
import { restoreSingleSession } from './app_state_loader.js';
import { mergeRestoredSessionIntoConnections, mergeRestoredSessionIntoScripts } from './app_state_loader.js';
import { connectionEntryFromState, findSessionQueries, useConnectionReferences, useConnectionRegistrySetter, useConnectionRegistryStore } from '../../connections/connection_registry.js';
import type { ConnectionState } from '../../connections/connection_state.js';
import { isHyperWasmConnection } from '../../connections/connection_label.js';
import { getConnectorInfoForParams } from '../../connections/connector_info.js';
import { useSessionScriptsRegistrySetter } from '../scripts/session_scripts_registry.js';
import { useDashQLCoreSetup } from '../../runtime/core_provider.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useCancelQuery } from '../../connections/query_executor.js';
import type { SessionImportCardDependencies } from './session_import_card.js';
import { SessionImportConflictDialog } from './session_import_conflict_dialog.js';
import { SessionConnectionImportDialog } from './session_connection_import_dialog.js';
import { StorageBackendType, type ConnectionEntry } from '../../storage/storage_backend.js';
import {
    applyConnectionImportPlan,
    connectionImportQuestions,
    connectionRefsChanged,
    planConnectionImport,
    type ConnectionImportChoice,
    type ConnectionImportPlanItem,
} from './session_connection_import.js';
import { AppHost, getAppHost } from '../../platform/native_globals.js';
import { useQueryResultCache } from '../../storage/query_result_cache_provider.js';
import { failedSessionQueryResults, importSessionQueryResults, type ImportedSessionQueryResults } from './session_query_results.js';
import { stringifyError } from '../../platform/logger/logger.js';

type ImportPresentation =
    | { mode: 'centered' }
    | {
        mode: 'anchored';
        anchorRef: React.RefObject<Element | null>;
        returnFocusRef: React.RefObject<HTMLElement | null>;
    };

/// A step of an import, in order: the connections are resolved, the query results go to the cache, the session is saved
export type SessionImportProgress =
    | { step: 'connections' }
    /// The query results of the session, with the outcome once they are added. Only reported if the session has some.
    | { step: 'results'; total: number; outcome: ImportedSessionQueryResults | null }
    | { step: 'session' };

export type SessionImportProgressConsumer = (progress: SessionImportProgress) => void;

export interface PortableSessionImportOptions {
    presentation: ImportPresentation;
    reloadAfterSuccess?: boolean;
    /// Follow the steps of the import, e.g. to show the query results that weren't added
    onProgress?: SessionImportProgressConsumer;
}

/// A registered session with the id of an imported one
export interface PortableImportConflict {
    displayLocation: string;
    isNative: boolean;
}

/// An import whose decisions are made, nothing is written yet
export interface PreparedPortableImport {
    /// The validated bundle with the resolved connections, still with its query results
    bundle: SessionBundle;
    /// The registered session with the same id, the import replaces it or creates a new session
    conflict: PortableImportConflict | null;
}

interface SessionImportContextValue {
    findPortableBundleConflict(bundle: SessionBundle): Promise<PortableImportConflict | null>;
    /// Validate a bundle and resolve its connections, null if the user cancelled. Writes nothing.
    preparePortableImport(bundle: SessionBundle, onProgress?: SessionImportProgressConsumer): Promise<PreparedPortableImport | null>;
    /// Add the query results of a prepared import to the cache and save its session. The choice decides a conflict.
    commitPortableImport(prepared: PreparedPortableImport, choice: ConflictChoice | null, onProgress?: SessionImportProgressConsumer): Promise<string>;
    importPortableBundleWithChoice(bundle: SessionBundle, choice: ConflictChoice): Promise<string | null>;
    importPortableBundle(bundle: SessionBundle, options: PortableSessionImportOptions): Promise<string | null>;
    importNativeFolder(dir: string, presentation: ImportPresentation): Promise<string | null>;
}

export type ConflictChoice = 'replace' | 'create-new';

interface ConflictDialogState {
    bundle: SessionBundle;
    existingDisplayLocation: string;
    presentation: ImportPresentation;
    busy: boolean;
    /// Run the import with the choice, null if the user cancelled it while choosing connections
    run(choice: ConflictChoice): Promise<string | null>;
    resolve(value: string | null): void;
}

/// The question whether imported connections should use existing connections
interface ConnectionDialogState {
    /// The name of the imported session
    sessionName: string;
    /// The connections that may consolidate
    questions: ConnectionImportPlanItem[];
    /// Resolve with the choices, null if the import was cancelled
    resolve(choices: Map<string, ConnectionImportChoice> | null): void;
}

const SESSION_IMPORT_CTX = React.createContext<SessionImportContextValue | null>(null);

export function useSessionImport(): SessionImportContextValue {
    const value = React.useContext(SESSION_IMPORT_CTX);
    if (value == null) throw new Error('useSessionImport must be used within SessionImportProvider');
    return value;
}

/// What the provider needs from the page, tests replace it
export interface SessionImportDependencies {
    /// Reload the app, an import that changes registered sessions runs the restoration again
    reload: () => void;
    /// The dependencies of the card of the conflict dialog
    card?: SessionImportCardDependencies;
}

const DEFAULT_DEPENDENCIES: SessionImportDependencies = {
    reload: () => globalThis.location.reload(),
};

export function SessionImportProvider(props: React.PropsWithChildren<{ dependencies?: SessionImportDependencies }>) {
    const { reload, card } = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const logger = useLogger();
    const setupCore = useDashQLCoreSetup();
    const [reader, writer] = useStorage();
    // Read the registry when importing instead of re-creating the import context for every query event
    const connectionStore = useConnectionRegistryStore();
    const references = useConnectionReferences();
    const setConnections = useConnectionRegistrySetter();
    const setScripts = useSessionScriptsRegistrySetter();
    const cancelQuery = useCancelQuery();
    const queryResultCache = useQueryResultCache();
    const [dialog, setDialog] = React.useState<ConflictDialogState | null>(null);
    const [connectionDialog, setConnectionDialog] = React.useState<ConnectionDialogState | null>(null);

    const backend = reader.sessionFolders;

    const validatePortableBundle = React.useCallback(async (bundle: SessionBundle): Promise<SessionBundle> => {
        const core = await setupCore('session_import_validation');
        const validation = filterInvalidSessionCatalogs(core, bundle);
        if (validation.invalidFiles.length > 0) {
            logger.warn('ignored malformed session catalog files', {
                sessionId: bundle.session.sessionId,
                files: validation.invalidFiles.join(', '),
            }, 'session_import');
        }
        return validation.bundle;
    }, [logger, setupCore]);

    /// Add the cached query results of an imported session to the cache of the app, the results of the app win. The
    /// results are no part of the session, a failure leaves the import alone.
    const importQueryResults = React.useCallback(async (bundle: SessionBundle, report?: SessionImportProgressConsumer): Promise<SessionBundle> => {
        const results = bundle.results ?? [];
        if (results.length === 0) return bundle;
        const sessionId = bundle.session.sessionId;
        const bytes = results.reduce((sum, result) => sum + result.bytes.size, 0);
        report?.({ step: 'results', total: results.length, outcome: null });
        if (queryResultCache == null) {
            logger.warn('ignored the query results of an imported session, results are not cached', {
                sessionId, results: results.length.toString(), bytes: bytes.toString(),
            }, 'session_import');
            report?.({ step: 'results', total: results.length, outcome: failedSessionQueryResults(results.length, 'This app does not cache query results') });
        } else {
            logger.info('importing the query results of a session', { sessionId, results: results.length.toString(), bytes: bytes.toString() }, 'session_import');
            const started = performance.now();
            try {
                const outcome = await importSessionQueryResults(queryResultCache, results, logger);
                const fields = {
                    sessionId, results: results.length.toString(), added: outcome.added.toString(), kept: outcome.kept.toString(),
                    failed: outcome.failed.toString(), dropped: outcome.dropped.toString(), bytes: outcome.bytes.toString(), durationMs: Math.round(performance.now() - started).toString(),
                };
                if (outcome.failed > 0 || outcome.dropped > 0) logger.warn('imported the query results of a session, some were left out', fields, 'session_import');
                else logger.info('imported the query results of a session', fields, 'session_import');
                report?.({ step: 'results', total: results.length, outcome });
            } catch (error) {
                logger.warn('importing the query results of a session failed', { sessionId, error: stringifyError(error) }, 'session_import');
                report?.({ step: 'results', total: results.length, outcome: failedSessionQueryResults(results.length, error) });
            }
        }
        const { results: _results, ...rest } = bundle;
        return rest;
    }, [logger, queryResultCache]);

    /// Map the connections of an imported session to the connections of the app.
    /// Connections that may consolidate with existing ones are decided by the user, null if the
    /// user cancelled the import.
    const resolveConnections = React.useCallback(async (bundle: SessionBundle, report?: SessionImportProgressConsumer): Promise<SessionBundle | null> => {
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
                }, 'session_import');
                return false;
            });
        // The embedded database always takes the embedded databases of the imported session
        for (const [connectionId, connection] of live.connections) {
            if (!entries.some(entry => entry.id === connectionId)
                && (references.sessionsOf(connectionId).length > 0 || isHyperWasmConnection(connection))) {
                entries.push(connectionEntryFromState({ ...connection, paramsDraft: undefined }));
            }
        }
        const plan = planConnectionImport(bundle.session, entries);
        const questions = connectionImportQuestions(plan);
        let choices = new Map<string, ConnectionImportChoice>();
        if (questions.length > 0) {
            const sessionName = bundle.session.name?.trim() || bundle.session.metadata.originalFileName || 'Unnamed session';
            const chosen = await new Promise<Map<string, ConnectionImportChoice> | null>(resolve => {
                setConnectionDialog({ sessionName, questions, resolve });
            });
            setConnectionDialog(null);
            if (chosen == null) return null;
            choices = chosen;
        }
        const { session, connectionIds } = applyConnectionImportPlan(bundle.session, plan, choices, entries);
        logger.info('resolved the connections of an imported session', {
            sessionId: bundle.session.sessionId,
            connections: plan.map(item => item.decision.kind).join(','),
        }, 'session_import');
        return { ...bundle, session, catalogs: renameBundleCatalogs(bundle.catalogs, connectionIds) };
    }, [backend, connectionStore, logger, references]);

    /// Resolve the connections, then add the query results to the cache: the last decision of an import is made then
    const resolveAndImportResults = React.useCallback(async (bundle: SessionBundle, report?: SessionImportProgressConsumer): Promise<SessionBundle | null> => {
        const resolved = await resolveConnections(bundle, report);
        return resolved == null ? null : await importQueryResults(resolved, report);
    }, [importQueryResults, resolveConnections]);

    const stopSessionWork = React.useCallback(async (sessionId: string) => {
        const databases = references.connectionsOf(sessionId)
            .map(connectionId => connectionStore.current.connections.get(connectionId))
            .filter((database): database is ConnectionState => database != null);
        // Connections may be shared, only the queries of the session are cancelled
        await Promise.all(databases.flatMap(database => findSessionQueries(database, sessionId, false).map(queryId =>
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
        bundle: SessionBundle,
        targetSessionId: string,
        suffixNameWithCopy: boolean,
    ) => {
        if (backend == null) throw new Error('Session imports require composite storage');
        const importedBundle = suffixNameWithCopy
            ? withFreshIdentity(bundle, targetSessionId)
            : bundle;
        await writePortableSessionFresh(backend, importedBundle, targetSessionId);
        // The same bundle may have been imported and deleted before in this tab
        writer.reviveSession(targetSessionId);
        try {
            const core = await setupCore('session_import');
            const restored = await restoreSingleSession(
                core,
                backend,
                logger,
                targetSessionId,
                connectionStore.current,
            );
            setConnections(registry => mergeRestoredSessionIntoConnections(registry, restored));
            setScripts(registry => mergeRestoredSessionIntoScripts(registry, restored));
            return targetSessionId;
        } catch (error) {
            try {
                await backend.deletePortableSession(targetSessionId);
            } catch {
                // Preserve the restoration error.
            }
            throw error;
        }
    }, [backend, connectionStore, logger, setConnections, setScripts, setupCore, writer]);

    const requestConflictChoice = React.useCallback((
        bundle: SessionBundle,
        existingDisplayLocation: string,
        presentation: ImportPresentation,
        run: (choice: ConflictChoice) => Promise<string | null>,
    ): Promise<string | null> => {
        return new Promise<string | null>(resolve => {
            setDialog(current => {
                if (current != null) {
                    resolve(null);
                    logger.warn('ignored session import while another decision is pending', {}, 'session_import');
                    return current;
                }
                return { bundle, existingDisplayLocation, presentation, busy: false, run, resolve };
            });
        });
    }, [logger]);

    const importPortableBundle = React.useCallback(async (
        bundle: SessionBundle,
        options: PortableSessionImportOptions,
    ): Promise<string | null> => {
        if (backend == null) throw new Error('Session imports require composite storage');
        const validated = await validatePortableBundle(bundle);
        // Whether the session is already registered is asked before the connections, resolving them
        // keeps the session id
        const conflict = await findSessionImportConflict(backend, validated.session.sessionId);
        const report = options.onProgress;
        if (conflict == null) {
            const resolved = await resolveAndImportResults(validated, report);
            if (resolved == null) return null;
            bundle = resolved;
            const sessionId = bundle.session.sessionId;
            report?.({ step: 'session' });
            if (options.reloadAfterSuccess) {
                await reloadThen(() => writePortableSessionFresh(backend, bundle, sessionId), writer, reload);
            } else {
                await restoreFreshPortable(bundle, sessionId, false);
            }
            return sessionId;
        }

        return await requestConflictChoice(
            validated,
            displayPath(conflict.sessionId, conflict.location),
            options.presentation,
            async choice => {
                const bundle = await resolveAndImportResults(validated, report);
                if (bundle == null) return null;
                report?.({ step: 'session' });
                if (choice === 'create-new') {
                    const sessionId = crypto.randomUUID();
                    const importedBundle = withFreshIdentity(bundle, sessionId);
                    if (options.reloadAfterSuccess) {
                        await reloadThen(() => writePortableSessionFresh(backend, importedBundle, sessionId), writer, reload);
                    } else {
                        await restoreFreshPortable(bundle, sessionId, true);
                    }
                    return sessionId;
                }
                await stopSessionWork(conflict.sessionId);
                try {
                    const sessionId = await replaceSessionWithPortableBundle(backend, bundle, conflict);
                    reload();
                    return sessionId;
                } catch (error) {
                    writer.resume();
                    throw error;
                }
            },
        );
    }, [backend, reload, requestConflictChoice, resolveAndImportResults, restoreFreshPortable, stopSessionWork, validatePortableBundle, writer]);

    const findPortableBundleConflict = React.useCallback(async (bundle: SessionBundle): Promise<{ displayLocation: string; isNative: boolean } | null> => {
        if (backend == null) throw new Error('Session imports require composite storage');
        const conflict = await findSessionImportConflict(backend, bundle.session.sessionId);
        return conflict == null ? null : {
            displayLocation: displayPath(conflict.sessionId, conflict.location),
            isNative: conflict.location.type === StorageBackendType.Native,
        };
    }, [backend]);

    const preparePortableImport = React.useCallback(async (
        bundle: SessionBundle,
        report?: SessionImportProgressConsumer,
    ): Promise<PreparedPortableImport | null> => {
        if (backend == null) throw new Error('Session imports require composite storage');
        const validated = await validatePortableBundle(bundle);
        const conflict = await findPortableBundleConflict(validated);
        const resolved = await resolveConnections(validated, report);
        return resolved == null ? null : { bundle: resolved, conflict };
    }, [backend, findPortableBundleConflict, resolveConnections, validatePortableBundle]);

    const commitPortableImport = React.useCallback(async (
        prepared: PreparedPortableImport,
        choice: ConflictChoice | null,
        report?: SessionImportProgressConsumer,
    ): Promise<string> => {
        if (backend == null) throw new Error('Session imports require composite storage');
        const bundle = await importQueryResults(prepared.bundle, report);
        report?.({ step: 'session' });
        // The registered sessions may have changed since the import was prepared
        const conflict = await findSessionImportConflict(backend, bundle.session.sessionId);
        if (conflict == null) return await restoreFreshPortable(bundle, bundle.session.sessionId, false);
        if (choice == null) throw new Error(`A session with the id ${bundle.session.sessionId} was added meanwhile`);
        if (choice === 'create-new') {
            const sessionId = crypto.randomUUID();
            return await restoreFreshPortable(bundle, sessionId, true);
        }
        await stopSessionWork(conflict.sessionId);
        try {
            const sessionId = await replaceSessionWithPortableBundle(backend, bundle, conflict);
            reload();
            return sessionId;
        } catch (error) {
            writer.resume();
            throw error;
        }
    }, [backend, importQueryResults, reload, restoreFreshPortable, stopSessionWork, writer]);

    const importPortableBundleWithChoice = React.useCallback(async (
        bundle: SessionBundle,
        choice: ConflictChoice,
    ): Promise<string | null> => {
        const prepared = await preparePortableImport(bundle);
        return prepared == null ? null : await commitPortableImport(prepared, choice);
    }, [commitPortableImport, preparePortableImport]);

    const importNativeFolder = React.useCallback(async (
        dir: string,
        presentation: ImportPresentation,
    ): Promise<string | null> => {
        if (backend == null) throw new Error('Native session imports require composite storage');
        const original = await prepareNativeSessionImport(backend, dir);
        // The folder is registered untouched, references to consolidated connections are written after
        const resolve = async () => {
            const resolved = await resolveConnections(original.bundle);
            if (resolved == null) return null;
            const prepared: PreparedNativeSession = { ...original, bundle: resolved };
            return { prepared, refsChanged: connectionRefsChanged(original.bundle.session, resolved.session) };
        };
        const conflict = await findSessionImportConflict(backend, original.bundle.session.sessionId);
        if (conflict == null) {
            const resolution = await resolve();
            if (resolution == null) return null;
            const { prepared, refsChanged } = resolution;
            await reloadThen(async () => {
                const sessionId = await registerNativeSession(backend, prepared);
                if (refsChanged) await writeNativeConnectionRefs(backend, sessionId, prepared.bundle);
                return sessionId;
            }, writer, reload);
            return prepared.bundle.session.sessionId;
        }
        return await requestConflictChoice(
            original.bundle,
            displayPath(conflict.sessionId, conflict.location),
            presentation,
            async choice => {
                const resolution = await resolve();
                if (resolution == null) return null;
                return await runNativeConflict(choice, resolution.prepared, resolution.refsChanged, conflict, backend, writer, stopSessionWork, reload);
            },
        );
    }, [backend, reload, requestConflictChoice, resolveConnections, stopSessionWork, writer]);

    const handleChoice = React.useCallback(async (choice: ConflictChoice) => {
        const current = dialog;
        if (current == null || current.busy) return;
        setDialog({ ...current, busy: true });
        try {
            const result = await current.run(choice);
            setDialog(null);
            current.resolve(result);
        } catch (error) {
            logger.error('session import failed', { error: String(error) }, 'session_import');
            setDialog({ ...current, busy: false });
        }
    }, [dialog, logger]);

    const cancelDialog = React.useCallback(() => {
        if (dialog == null || dialog.busy) return;
        setDialog(null);
        dialog.resolve(null);
    }, [dialog]);

    const value = React.useMemo<SessionImportContextValue>(() => ({
        findPortableBundleConflict,
        preparePortableImport,
        commitPortableImport,
        importPortableBundleWithChoice,
        importPortableBundle,
        importNativeFolder,
    }), [commitPortableImport, findPortableBundleConflict, importNativeFolder, importPortableBundle, importPortableBundleWithChoice, preparePortableImport]);

    return (
        <SESSION_IMPORT_CTX.Provider value={value}>
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
                <SessionConnectionImportDialog
                    sessionName={connectionDialog.sessionName}
                    questions={connectionDialog.questions}
                    busy={false}
                    onConfirm={choices => connectionDialog.resolve(choices)}
                    onCancel={() => connectionDialog.resolve(null)}
                />
            )}
        </SESSION_IMPORT_CTX.Provider>
    );
}

/// Give an imported session a new identity.
/// The connections keep their ids, the connections of the copy were resolved by the import.
function withFreshIdentity(bundle: SessionBundle, sessionId: string): SessionBundle {
    const session = { ...bundle.session, sessionId };
    const name = session.name?.trim();
    if (name) session.name = `${name} (copy)`;
    return { ...bundle, session };
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
async function writeNativeConnectionRefs(backend: CompositeStorageBackend, sessionId: string, bundle: SessionBundle): Promise<void> {
    const existing = await backend.loadSession(sessionId);
    await backend.saveSessionManifest(sessionId, {
        ...existing,
        connections: bundle.session.connections,
        scripts: bundle.session.scripts,
    });
}

async function runNativeConflict(
    choice: ConflictChoice,
    prepared: PreparedNativeSession,
    refsChanged: boolean,
    conflict: SessionImportConflict,
    backend: CompositeStorageBackend,
    writer: ReturnType<typeof useStorage>[1],
    stopSessionWork: (sessionId: string) => Promise<void>,
    reload: () => void,
): Promise<string> {
    if (choice === 'create-new') {
        const sessionId = crypto.randomUUID();
        const bundle = withFreshIdentity(prepared.bundle, sessionId);
        return await reloadThen(() => writePortableSessionFresh(backend, bundle, sessionId), writer, reload);
    }
    await stopSessionWork(conflict.sessionId);
    try {
        const sessionId = await replaceSessionWithNativeFolder(backend, prepared, conflict);
        if (refsChanged) await writeNativeConnectionRefs(backend, sessionId, prepared.bundle);
        reload();
        return sessionId;
    } catch (error) {
        writer.resume();
        throw error;
    }
}

function renderConflictDialog(
    dialog: ConflictDialogState,
    handleChoice: (choice: ConflictChoice) => Promise<void>,
    onCancel: () => void,
    dependencies: SessionImportCardDependencies | undefined,
): React.ReactElement {
    const common = {
        sessionName: dialog.bundle.session.name?.trim()
            || dialog.bundle.session.metadata.originalFileName
            || 'Unnamed session',
        sessionUuid: dialog.bundle.session.sessionId,
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
        ? <SessionImportConflictDialog mode="centered" {...common} />
        : <SessionImportConflictDialog
            mode="anchored"
            anchorRef={dialog.presentation.anchorRef}
            returnFocusRef={dialog.presentation.returnFocusRef}
            {...common}
        />;
}
