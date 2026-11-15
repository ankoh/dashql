import type * as core from '@ankoh/dashql-core';
import type { Logger } from '../../platform/logger/logger.js';
import { ProgressCounter } from '../../utils/progress.js';
import type { ConnectionState } from '../../connections/connection_state.js';
import { destroyConnectionState } from '../../connections/connection_state.js';
import { NativeConnection } from '../../connections/connection_native.js';
import { registerConnection, type ConnectionRegistry } from '../../connections/connection_registry_state.js';
import type { WorkbookScripts } from '../scripts/workbook_scripts.js';
import type { WorkbookMetadata } from '../scripts/script_types.js';
import { addWorkbookScriptsForConnection, copyWorkbookScriptsRegistry, type WorkbookScriptsRegistry } from '../scripts/workbook_scripts_registry_state.js';
import { destroyWorkbookScripts, scriptConnectionOf, workbookConnectionIds } from '../scripts/workbook_scripts.js';
import { NativeWorkbook, workbookConnectionOf } from '../scripts/workbook_native.js';
import { CONNECTOR_TYPES, ConnectorType } from '../../connections/connector_info.js';
import type { StorageBackend } from '../../storage/storage_backend.js';
import { isWorkbookRegistryBackend } from '../../storage/storage_backend.js';
import { StorageWriter } from '../../storage/storage_writer.js';
import type { InvalidWorkbook, WorkbookValidationError } from '../../storage/workbook_validation.js';

/// The restore of the stored state runs in the Rust runtime (`dashql_core_runtime::restore`, docs/wip/core_runtime.md):
/// the validation, the connections with their catalogs, the workbooks with their scripts
/// and the writes after the restore through the storage writer. This module is its host over a storage backend and
/// projects the Rust connections and workbooks into the objects of the registries.

const LOG_CTX = "app_state_loader";

export interface RestoredAppState {
    connectionStates: Map<string, ConnectionState>;
    connectionStatesByType: string[][];
    workbookScripts: Map<string, WorkbookScripts>;
    workbookScriptsByConnection: Map<string, string[]>;
    /// Workbooks whose metadata failed validation and were refused a load (keyed by bare UUID).
    /// These never enter the connection/workbook maps; the workbook workbench surfaces them as
    /// invalid (blocked from opening, still deletable).
    invalidWorkbooks: Map<string, InvalidWorkbook>;
}

export interface AppStateRestorationProgress {
    restoreConnections: ProgressCounter;
    restoreCatalogs: ProgressCounter;
    restoreWorkbookScripts: ProgressCounter;
}

/// A counter of the progress that the restore reports
function progressCounter(counter: core.RestoreProgressCounter): ProgressCounter {
    const out = new ProgressCounter(counter.total);
    out.started = counter.started;
    out.succeeded = counter.succeeded;
    out.skipped = counter.skipped;
    out.failed = counter.failed;
    return out;
}

function restorationProgress(progress: core.RestoreProgress): AppStateRestorationProgress {
    return {
        restoreConnections: progressCounter(progress.restoreConnections),
        restoreCatalogs: progressCounter(progress.restoreCatalogs),
        restoreWorkbookScripts: progressCounter(progress.restoreWorkbookScripts),
    };
}

/// The host of the restore: the host of the storage writer with the reads of the restore over the backend
function restoreHost(
    writer: StorageWriter,
    backend: StorageBackend,
    logger: Logger,
    progress: (progress: AppStateRestorationProgress) => void,
): core.RestoreHost {
    const registry = isWorkbookRegistryBackend(backend) ? backend : null;
    return {
        ...writer.createHost(),
        log: (level, message, details) => logger[level](message, details, LOG_CTX),
        ownsConnections: () => registry != null,
        newUuid: () => crypto.randomUUID(),
        listWorkbooks: async () => (await backend.listWorkbooks()).map(entry => entry.path),
        loadManifestConnections: async () => (await registry?.loadManifest())?.connections ?? null,
        loadScripts: async workbookId => (await backend.loadScripts(workbookId)).map(script => ({ name: script.name, sql: script.sql })),
        listDataFiles: async workbookId => backend.listDataFiles(workbookId),
        loadConnectionFile: async (connectionId, fileName) => registry == null ? null : registry.loadConnectionFile(connectionId, fileName),
        restoreProgress: restored => progress(restorationProgress(restored)),
    };
}

/// The connection states of restored Rust connections
function projectConnections(instance: core.DashQL, connections: readonly core.RestoredConnection[]): ConnectionState[] {
    return connections.map(restored => new NativeConnection(instance, restored.connection).project(restored.connectionId));
}

/// The workbook scripts of a restored Rust workbook on the connections it names
function projectWorkbook(instance: core.DashQL, restored: core.RestoredWorkbook, connections: (connectionId: string) => ConnectionState | undefined): WorkbookScripts {
    const scriptConnections = restored.connectionIds.map(connectionId => {
        const connection = connections(connectionId);
        if (connection == null) throw new Error(`the restored workbook ${restored.workbookId} names an unknown connection: ${connectionId}`);
        return scriptConnectionOf(connection);
    });
    return NativeWorkbook.adopt({
        instance,
        workbookId: restored.workbookId,
        name: restored.name,
        workbookMetadata: (restored.metadata ?? {}) as WorkbookMetadata,
        workbook: restored.workbook,
        connections: scriptConnections,
    });
}

/// Free what a restore created and nothing took
function destroyRestoredState(state: core.DashQLRestoredState): void {
    for (const workbook of state.workbooks) workbook.workbook.destroy();
    for (const connection of state.connections) connection.connection.destroy();
}

/// Run a restore of the Rust runtime through the native writer of a storage writer
async function runRestore(
    instance: core.DashQL,
    backend: StorageBackend,
    logger: Logger,
    storageWriter: StorageWriter | undefined,
    progress: (progress: AppStateRestorationProgress) => void,
    run: (restore: core.DashQLAppRestore) => Promise<core.DashQLRestoredState>,
): Promise<core.DashQLRestoredState> {
    const writer = storageWriter ?? new StorageWriter(logger, backend, instance);
    const host = restoreHost(writer, backend, logger, progress);
    return await writer.withNativeWriter(native => run(instance.createRestore(host, native)));
}

/// The connection references + workbook a single workbook restored into.
export interface RestoredWorkbook {
    /// The workbook id
    workbookId: string;
    /// The connections the workbook registered, connections that were already live are not included
    databases: ConnectionState[];
    /// The workbook scripts
    workbookScripts: WorkbookScripts;
}

export function mergeRestoredWorkbookIntoConnections(
    reg: ConnectionRegistry,
    restored: RestoredWorkbook,
): ConnectionRegistry {
    for (const database of restored.databases) {
        if (!reg.connections.has(database.connectionId)) {
            registerConnection(reg, database);
        }
    }
    return { ...reg };
}

export function mergeRestoredWorkbookIntoScripts(
    reg: WorkbookScriptsRegistry,
    restored: RestoredWorkbook,
): WorkbookScriptsRegistry {
    const next = copyWorkbookScriptsRegistry(reg);
    next.workbookScriptsMap.set(restored.workbookId, restored.workbookScripts);
    for (const connectionId of workbookConnectionIds(restored.workbookScripts)) {
        addWorkbookScriptsForConnection(next, connectionId, restored.workbookId);
    }
    return next;
}

export function destroyRestoredWorkbook(restored: RestoredWorkbook): void {
    destroyWorkbookScripts(restored.workbookScripts);
    for (const database of restored.databases) destroyConnectionState(database);
}

/// The live connections that a restored workbook resolves its references against
export type LiveConnections = Pick<ConnectionRegistry, 'connections'>;

/// Restore a single, already-persisted workbook (connection references + catalog + workbook) and
/// return just that workbook's pieces.
///
/// This is the incremental counterpart to `restoreAppState`, used after a workbook is written to
/// storage at runtime (e.g. imported from a shared URL) so it can be merged into the already-live
/// registries without a full app reload. It runs the same restore of the Rust runtime as the boot
/// loader, so a URL-imported workbook is decoded and cataloged identically to one loaded at startup.
/// References to live connections reuse them, unknown connections are registered and returned.
export async function restoreSingleWorkbook(
    instance: core.DashQL,
    backend: StorageBackend,
    logger: Logger,
    workbookId: string,
    live: LiveConnections,
    storageWriter?: StorageWriter,
): Promise<RestoredWorkbook> {
    const state = await runRestore(instance, backend, logger, storageWriter, () => { }, restore => {
        for (const connection of live.connections.values()) {
            restore.addLiveConnection(connection.params, workbookConnectionOf(scriptConnectionOf(connection)));
        }
        return restore.restoreWorkbook(workbookId);
    });
    const restored = state.workbooks[0];
    if (restored == null) {
        destroyRestoredState(state);
        throw new Error(`imported workbook ${workbookId} did not restore its scripts`);
    }
    const databases = projectConnections(instance, state.connections);
    const registered = new Map(databases.map(database => [database.connectionId, database]));
    try {
        const workbookScripts = projectWorkbook(instance, restored, connectionId => registered.get(connectionId) ?? live.connections.get(connectionId));
        return { workbookId, databases, workbookScripts };
    } catch (error) {
        for (const database of databases) destroyConnectionState(database);
        throw error;
    }
}

/**
 * Restores complete application state from storage
 */
export async function restoreAppState(
    instance: core.DashQL,
    backend: StorageBackend,
    logger: Logger,
    progressConsumer: (progress: AppStateRestorationProgress) => void,
    storageWriter?: StorageWriter,
): Promise<RestoredAppState> {
    const state = await runRestore(instance, backend, logger, storageWriter, progressConsumer, restore => restore.restore());

    const connectionStates = new Map<string, ConnectionState>();
    const connectionStatesByType: string[][] = CONNECTOR_TYPES.map(() => []);
    for (const connection of projectConnections(instance, state.connections)) {
        connectionStates.set(connection.connectionId, connection);
        connectionStatesByType[connection.connectorInfo.connectorType].push(connection.connectionId);
    }
    const workbookScripts = new Map<string, WorkbookScripts>();
    const workbookScriptsByConnection = new Map<string, string[]>();
    for (const restored of state.workbooks) {
        const scripts = projectWorkbook(instance, restored, connectionId => connectionStates.get(connectionId));
        workbookScripts.set(restored.workbookId, scripts);
        for (const id of workbookConnectionIds(scripts)) {
            workbookScriptsByConnection.set(id, [...(workbookScriptsByConnection.get(id) ?? []), restored.workbookId]);
        }
    }
    const invalidWorkbooks = new Map<string, InvalidWorkbook>();
    for (const invalid of state.invalidWorkbooks) {
        invalidWorkbooks.set(invalid.workbookId, {
            workbookId: invalid.workbookId,
            title: invalid.title,
            connectorType: invalid.connectorType == null ? null : invalid.connectorType as ConnectorType,
            error: invalid.error as WorkbookValidationError,
        });
    }
    progressConsumer(restorationProgress(state.progress));
    return {
        connectionStates,
        connectionStatesByType,
        workbookScripts,
        workbookScriptsByConnection,
        invalidWorkbooks,
    };
}
