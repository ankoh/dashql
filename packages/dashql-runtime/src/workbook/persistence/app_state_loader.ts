import type { DashQL } from '@ankoh/dashql-core';
import type { Logger } from '../../platform/logger/logger.js';
import { stringifyError } from '../../platform/logger/logger.js';
import { ProgressCounter } from '../../utils/progress.js';
import type { ConnectionState } from '../../connections/connection_state.js';
import { registerConnection, workbookConnectionFromState, type ConnectionRegistry } from '../../connections/connection_registry_state.js';
import type { WorkbookScripts, ScriptData } from '../scripts/workbook_scripts.js';
import { addWorkbookScriptsForConnection, copyWorkbookScriptsRegistry, type WorkbookScriptsRegistry } from '../scripts/workbook_scripts_registry_state.js';
import { createEmptyScriptData, destroyWorkbookScripts, isEphemeralWorkbook, replaceScriptSessionText, scriptConnectionOf, workbookConnectionIds } from '../scripts/workbook_scripts.js';
import { readWorkbookAttachments, type WorkbookAttachment } from '../attachments/workbook_attachments.js';
import { connectionStateFromStorage, destroyUnregisteredConnection, restoreConnectionCatalog } from '../../connections/connection_restore.js';
import { CONNECTOR_INFOS, CONNECTOR_TYPES, ConnectorType } from '../../connections/connector_info.js';
import type { StorageBackend, WorkbookEntry, WorkbookData, WorkbookRegistryBackend, ConnectionEntry, WorkbookConnection, WorkbookScript } from '../../storage/storage_backend.js';
import { StorageBackendType, isWorkbookRegistryBackend } from '../../storage/storage_backend.js';
import { connectionParamsEqual, createDefaultConnectionParamsForConnector } from '../../connections/connection_params.js';
import { findEmbeddedConnection } from '../../connections/embedded_connection.js';
import { patchWorkbookConnection, upsertConnectionEntry } from '../../storage/storage_writer.js';
import { sanitizeWorkbookFiles, workbookConnectionIdsOf, withWorkbookScripts } from '../../storage/workbook_files.js';
import { resolveWorkbookScripts, workbookScriptsResolutionChanged, type WorkbookConnectionResolver } from './workbook_script_connections.js';
import { validateWorkbookData, describeInvalidWorkbook, isLocalHyperWasmParams, isValidUuid, WorkbookValidationError, type InvalidWorkbook } from '../../storage/workbook_validation.js';
import type { BatchProcessor } from '../../connections/catalog/catalog_batch.js';

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

/// Thrown by `restoreWorkbookEntry` when a workbook's metadata fails the up-front validation gate.
///
/// Distinguished from an arbitrary restore error so the loader can record it as a (skipped)
/// invalid workbook and surface it in the UI, rather than counting it as a hard failure.
class InvalidWorkbookError extends Error {
    constructor(public readonly invalid: InvalidWorkbook) {
        super(`invalid workbook ${invalid.workbookId}: ${invalid.error}`);
        this.name = 'InvalidWorkbookError';
    }
}

export interface AppStateRestorationProgress {
    restoreConnections: ProgressCounter;
    restoreCatalogs: ProgressCounter;
    restoreWorkbookScripts: ProgressCounter;
}

/// The progress counters of a restoration, every change is reported to the consumer
class RestoreProgress {
    /// The restored connections of the workbooks
    readonly connections = new ProgressCounter();
    /// The restored catalogs of the workbooks
    readonly catalogs = new ProgressCounter();
    /// The restored workbook scripts
    readonly workbookScripts = new ProgressCounter();

    constructor(private readonly consumer: (progress: AppStateRestorationProgress) => void) { }

    /// Report the current progress
    report(): void {
        this.consumer({
            restoreConnections: this.connections.clone(),
            restoreCatalogs: this.catalogs.clone(),
            restoreWorkbookScripts: this.workbookScripts.clone(),
        });
    }
}

/// Restores workbook scripts from storage
async function restoreWorkbookScripts(
    core: DashQL,
    backend: StorageBackend,
    workbookId: string,
    name: string | null,
    workbookData: WorkbookData,
    fallbackConnection: () => ConnectionState,
    resolveConnection: WorkbookConnectionResolver,
    logger: Logger
): Promise<{ workbookScripts: WorkbookScripts; workbook: WorkbookData }> {
    const scripts: Record<number, ScriptData> = {};

    try {
        logger.info("Loading scripts", { workbookId }, LOG_CTX);
        const storedScripts = await backend.loadScripts(workbookId);
        logger.info("Scripts loaded", {
            workbookId,
            scriptCount: storedScripts.length.toString()
        }, LOG_CTX);

        // The workbook file orders the scripts and names their connections
        const sqlByName = new Map(storedScripts.map(script => [script.name, script.sql]));
        const resolved = resolveWorkbookScripts(workbookData, storedScripts.map(script => script.name), fallbackConnection, resolveConnection,
            connectionId => logger.warn("Script references an unknown connection, using the embedded database", { workbookId, connectionId }, LOG_CTX));
        const scriptRefs: { [fileName: string]: { scriptId: number; fileName: string } } = {};
        for (const entry of resolved.scripts) {
            const [scriptKey, created] = createEmptyScriptData(core, scriptConnectionOf(entry.connection), entry.name);
            const scriptData = entry.unresolvedConnectionId == null ? created : { ...created, unresolvedConnectionId: entry.unresolvedConnectionId };
            scripts[scriptKey] = scriptData;

            // Set SQL content. Ordinary workbook scripts remain outdated until first use.
            replaceScriptSessionText(scriptData.scriptSession, sqlByName.get(entry.name) ?? '');

            scriptRefs[entry.name] = {
                scriptId: scriptKey,
                fileName: entry.name,
            };
        }
        const scriptOrder = resolved.scripts.map(entry => entry.name);
        // The attachments of the workbook, a Parquet attachment is a table parameter of the scripts
        let attachments: WorkbookAttachment[] = [];
        try {
            attachments = readWorkbookAttachments(await backend.listDataFiles(workbookId));
        } catch (error) {
            logger.warn("Listing the attachments failed", { workbookId, error: stringifyError(error) }, LOG_CTX);
        }

        const workbookScripts: WorkbookScripts = {
            instance: core,
            workbookId,
            name,
            pendingConnection: resolved.pendingConnection == null ? null : scriptConnectionOf(resolved.pendingConnection),
            workbookMetadata: workbookData.metadata,
            scripts,
            scriptRefs,
            scriptOrder,
            scriptFocus: { fileName: scriptOrder[0] ?? '' },
            semanticUserFocus: null,
            attachments,
        };

        return { workbookScripts, workbook: resolved.workbook };
    } catch (error) {
        for (const scriptData of Object.values(scripts)) {
            scriptData.scriptSession.destroy();
        }
        throw error;
    }
}

/// The state that the restoration of connections and workbooks shares.
///
/// Connections are entities of their own, the app manifest is their source of truth. They are
/// restored first, workbooks then resolve their references against them. Workbooks keep copies of
/// the connection params to stay self-contained, a copy that disagrees with the manifest is
/// rewritten, and a reference to an unknown connection registers the connection from the copy.
interface RestoreContext {
    /// The core instance
    core: DashQL;
    /// The storage backend
    backend: StorageBackend;
    /// The backend as registry, null if the backend doesn't own the connections
    registry: WorkbookRegistryBackend | null;
    /// The logger
    logger: Logger;
    /// The batch processor for catalog scripts
    processor?: BatchProcessor;
    /// The connections (connectionId -> state)
    connectionStates: Map<string, ConnectionState>;
    /// The connections by connector type
    connectionStatesByType: string[][];
    /// The connections whose catalog is restored or live
    catalogsRestored: Set<string>;
    /// The connections that were registered while restoring workbooks
    newConnections: Map<string, ConnectionState>;
    /// The writes that bring the stored state in line with the restored one
    pendingWrites: RestorePendingWrites;
}

/// The writes that bring the stored state in line with the restored one
interface RestorePendingWrites {
    /// Connections that workbooks registered, they are missing in the app manifest
    connectionEntries: ConnectionEntry[];
    /// Catalog files of connections, in order: those that hold dropped relations or changes are cleared
    connectionFiles: Array<{ connectionId: string; fileName: string; text: string }>;
    /// Workbooks whose copies of connection params are stale
    workbookCopies: Array<{ workbookId: string; connectionId: string }>;
    /// Workbooks whose script lists or connections disagree with the restored scripts
    workbookScriptLists: Array<{ workbookId: string; scripts: WorkbookScript[]; connections: WorkbookConnection[] }>;
    /// Ephemeral workbooks that hold scripts, the app stopped before their promotion was written
    promotedWorkbooks: string[];
}

function createRestoreContext(core: DashQL, backend: StorageBackend, logger: Logger, processor: BatchProcessor | undefined): RestoreContext {
    return {
        core,
        backend,
        registry: isWorkbookRegistryBackend(backend) ? backend : null,
        logger,
        processor,
        connectionStates: new Map(),
        connectionStatesByType: CONNECTOR_TYPES.map(() => []),
        catalogsRestored: new Set(),
        newConnections: new Map(),
        pendingWrites: { connectionEntries: [], connectionFiles: [], workbookCopies: [], workbookScriptLists: [], promotedWorkbooks: [] },
    };
}

/// Restore a connection of the app manifest
async function restoreConnectionEntry(ctx: RestoreContext, entry: ConnectionEntry): Promise<void> {
    let state: ConnectionState;
    try {
        state = connectionStateFromStorage(ctx.core, entry.id, entry);
    } catch (error) {
        // Workbooks referencing the connection register it again from their copies
        ctx.logger.warn("Failed to restore connection", { connectionId: entry.id, error: stringifyError(error) }, LOG_CTX);
        return;
    }
    ctx.connectionStates.set(state.connectionId, state);
    ctx.connectionStatesByType[state.connectorInfo.connectorType].push(state.connectionId);
    await restoreCatalog(ctx, ctx.registry!, state, { connectionId: entry.id });
}

/// Restore the catalog of a connection once, returns false if the restoration failed
async function restoreCatalog(
    ctx: RestoreContext,
    registry: WorkbookRegistryBackend,
    state: ConnectionState,
    logContext: Record<string, string>,
): Promise<boolean> {
    const connectionId = state.connectionId;
    ctx.catalogsRestored.add(connectionId);
    const restored = await restoreConnectionCatalog(ctx, registry, state, logContext);
    for (const file of restored.files) {
        ctx.pendingWrites.connectionFiles.push({ connectionId, ...file });
    }
    return restored.succeeded;
}

/// Resolve a workbook's reference to a connection.
/// The app manifest wins over the copy in the workbook, an unknown connection is registered from the copy.
/// The app holds a single connection to the embedded database, an unknown one resolves to it.
function resolveWorkbookConnection(ctx: RestoreContext, workbookId: string, database: WorkbookConnection): ConnectionState {
    const connectionId = database.connectionId;
    const known = ctx.connectionStates.get(connectionId)
        ?? (isLocalHyperWasmParams(database.params) ? findEmbeddedConnection(ctx.connectionStates.values()) : null);
    if (known != null) {
        if (known.connectionId === connectionId
            && (database.paramsDraft != null || database.name != null || !connectionParamsEqual(database.params, known.params))) {
            ctx.pendingWrites.workbookCopies.push({ workbookId, connectionId });
        }
        return known;
    }
    const state = connectionStateFromStorage(ctx.core, connectionId, database);
    ctx.connectionStates.set(state.connectionId, state);
    ctx.connectionStatesByType[state.connectorInfo.connectorType].push(state.connectionId);
    ctx.newConnections.set(state.connectionId, state);
    ctx.pendingWrites.connectionEntries.push({
        id: state.connectionId,
        params: state.params,
        ...(database.paramsDraft == null ? {} : { paramsDraft: database.paramsDraft }),
        ...(state.name == null ? {} : { name: state.name }),
        createdAt: new Date().toISOString(),
    });
    if (database.paramsDraft != null || database.name != null) {
        // Drafts and the names of imported connections move into the app manifest
        ctx.pendingWrites.workbookCopies.push({ workbookId, connectionId });
    }
    return state;
}

/// The connection to the embedded database, registered from a copy of the workbook or anew when the app
/// has none. Scripts whose connections are unknown run on it.
function resolveEmbeddedConnection(ctx: RestoreContext, workbookId: string, copies: readonly WorkbookConnection[]): ConnectionState {
    return findEmbeddedConnection(ctx.connectionStates.values()) ?? resolveWorkbookConnection(ctx, workbookId,
        copies.find(copy => isLocalHyperWasmParams(copy.params)) ?? {
            connectionId: crypto.randomUUID(),
            params: createDefaultConnectionParamsForConnector(CONNECTOR_INFOS[ConnectorType.HYPER]),
        });
}

/// Restores a single workbook (connection references + catalog + workbook).
/// Returns the workbook as invalid when its scripts could not be restored.
async function restoreWorkbookEntry(
    ctx: RestoreContext,
    workbookEntry: WorkbookEntry,
    workbookScripts: Map<string, WorkbookScripts>,
    workbookScriptsByConnection: Map<string, string[]>,
    progress: RestoreProgress,
): Promise<InvalidWorkbook | null> {
    const { backend, logger } = ctx;
    // The workbook UUID is the authoritative identity and the key the backend routes on. Gate it up
    // front: a manifest entry whose path is not a valid UUID can't be loaded (the backend would
    // build a bogus path and throw), so surface it as an invalid workbook rather than a hard failure.
    const workbookId = workbookEntry.path;
    if (!isValidUuid(workbookId)) {
        const invalid = describeInvalidWorkbook(workbookEntry, WorkbookValidationError.InvalidWorkbookId, null);
        logger.warn("Refusing to load workbook with an invalid id", {
            workbookId,
            reason: invalid.error,
        }, LOG_CTX);
        throw new InvalidWorkbookError(invalid);
    }

    // Phase 1: Resolve the connections
    logger.info("Restoring connection", { workbookId }, LOG_CTX);
    const connectionStartTime = performance.now();
    progress.connections.addStarted();
    progress.report();

    const workbookData = await loadValidWorkbook(backend, logger, workbookEntry);

    // Validation above guarantees at least one connection and params that map to a known connector.
    // The connections of the workbook are the connections of its scripts, copies that no script uses
    // are not registered.
    const used = new Set(workbookConnectionIdsOf(sanitizeWorkbookFiles(workbookData).scripts, workbookData.connections[0].connectionId));
    const usedCopies = workbookData.connections.filter(copy => used.has(copy.connectionId));
    const connectionStates = usedCopies.length > 0
        ? usedCopies.map(copy => resolveWorkbookConnection(ctx, workbookId, copy))
        : [resolveEmbeddedConnection(ctx, workbookId, workbookData.connections)];
    const connectorInfo = connectionStates[0].connectorInfo;
    const resolveScriptConnection: WorkbookConnectionResolver = (connectionId, copy) => copy != null
        ? resolveWorkbookConnection(ctx, workbookId, copy)
        : ctx.connectionStates.get(connectionId) ?? null;

    const connectionDuration = performance.now() - connectionStartTime;
    logger.info("Connections restored", {
        workbookId,
        connectorTypes: connectionStates.map(state => ConnectorType[state.connectorInfo.connectorType]).join(','),
        durationMs: connectionDuration.toFixed(2)
    }, LOG_CTX);

    progress.connections.addSucceeded();

    // Phase 2: Restore the catalogs of the connections that the workbook registered. The connections
    // of the app manifest restored their catalogs already.
    logger.info("Restoring catalog", { workbookId }, LOG_CTX);
    progress.catalogs.addStarted();
    progress.report();
    let catalogsRestored = true;
    for (const connectionState of connectionStates) {
        if (ctx.registry == null || ctx.catalogsRestored.has(connectionState.connectionId)) continue;
        catalogsRestored = await restoreCatalog(ctx, ctx.registry, connectionState, { workbookId, connectionId: connectionState.connectionId }) && catalogsRestored;
    }
    if (catalogsRestored) {
        progress.catalogs.addSucceeded();
    } else {
        progress.catalogs.addFailed();
    }

    // Phase 3: Restore workbook scripts
    logger.info("Restoring workbook scripts", { workbookId }, LOG_CTX);
    const workbookScriptsStartTime = performance.now();
    progress.workbookScripts.addStarted();
    progress.report();

    let restoredWorkbookScripts: WorkbookScripts | null = null;
    try {
        const restored = await restoreWorkbookScripts(
            ctx.core,
            backend,
            workbookId,
            workbookData.name?.trim() || null,
            workbookData,
            () => resolveEmbeddedConnection(ctx, workbookId, workbookData.connections),
            resolveScriptConnection,
            logger
        );
        restoredWorkbookScripts = restored.workbookScripts;
        if (isEphemeralWorkbook(restoredWorkbookScripts) && restoredWorkbookScripts.scriptOrder.length > 0) {
            const { ephemeral: _promoted, ...workbookMetadata } = restoredWorkbookScripts.workbookMetadata;
            restoredWorkbookScripts = { ...restoredWorkbookScripts, workbookMetadata };
            ctx.pendingWrites.promotedWorkbooks.push(workbookId);
        }
        if (workbookScriptsResolutionChanged(workbookData, restored.workbook)) {
            const { scripts, connections } = restored.workbook;
            ctx.pendingWrites.workbookScriptLists.push({ workbookId, scripts, connections });
        }

        const workbookScriptsDuration = performance.now() - workbookScriptsStartTime;
        logger.info("Workbook scripts restored", {
            workbookId,
            scriptCount: Object.keys(restoredWorkbookScripts.scripts).length.toString(),
            durationMs: workbookScriptsDuration.toFixed(2)
        }, LOG_CTX);

        progress.workbookScripts.addSucceeded();
    } catch (workbookScriptsError) {
        const workbookScriptsDuration = performance.now() - workbookScriptsStartTime;

        logger.warn("Failed to restore workbook scripts", {
            workbookId,
            durationMs: workbookScriptsDuration.toFixed(2),
            error: stringifyError(workbookScriptsError),
            stack: (workbookScriptsError instanceof Error ? workbookScriptsError.stack : (workbookScriptsError as any)?.stack)?.substring(0, 500)
        }, LOG_CTX);

        progress.workbookScripts.addFailed();
    }

    progress.report();
    if (restoredWorkbookScripts == null) {
        return describeInvalidWorkbook(workbookEntry, WorkbookValidationError.WorkbookNotRestored, workbookData);
    }
    workbookScripts.set(workbookId, restoredWorkbookScripts);
    for (const id of workbookConnectionIds(restoredWorkbookScripts)) {
        workbookScriptsByConnection.set(id, [...(workbookScriptsByConnection.get(id) ?? []), workbookId]);
    }
    return null;
}

/// Load a workbook and validate its metadata
async function loadValidWorkbook(backend: StorageBackend, logger: Logger, workbookEntry: WorkbookEntry): Promise<WorkbookData> {
    const workbookId = workbookEntry.path;
    logger.info("Loading workbook data", { workbookId }, LOG_CTX);
    // The manifest registers this workbook, but its files may be gone (a native workbook whose folder
    // the user moved/deleted, or a corrupt/absent OPFS workbook). Treat a load failure the same as a
    // metadata rejection: surface it as an invalid workbook so the selector shows it blocked and
    // deletable, rather than letting it fall through to the loader's generic "failed to restore"
    // path — which logs an error on every launch and leaves the stale entry with no way to remove it.
    let workbookData: WorkbookData;
    try {
        workbookData = await backend.loadWorkbook(workbookId);
    } catch (loadError) {
        const invalid = describeInvalidWorkbook(workbookEntry, WorkbookValidationError.WorkbookUnreadable, null);
        logger.warn("Refusing to load workbook with unreadable files", {
            workbookId,
            reason: invalid.error,
            error: stringifyError(loadError),
        }, LOG_CTX);
        throw new InvalidWorkbookError(invalid);
    }

    // Fail-fast metadata validation: refuse to load a workbook whose metadata is structurally
    // unusable (unsupported format, no id, or invalid connection). This runs
    // before any heavy restore work and surfaces the workbook as invalid in the selector rather than
    // letting it blow up mid-restore. Runtime hiccups (catalog/workbook) remain non-fatal below.
    const validation = validateWorkbookData(workbookData);
    if (!validation.ok) {
        const invalid = describeInvalidWorkbook(workbookEntry, validation.error, workbookData);
        logger.warn("Refusing to load invalid workbook", {
            workbookId,
            reason: invalid.error,
        }, LOG_CTX);
        throw new InvalidWorkbookError(invalid);
    }
    logger.info("Workbook data loaded", { workbookId }, LOG_CTX);
    return workbookData;
}

/// Perform the writes that bring the stored state in line with the restored one.
/// Failures are logged, the next load attempts them again.
///
/// The writes go to the backend directly, not through the storage writer. They run before the restored
/// workbooks join the registry, so no write of the storage writer touches these workbooks yet, and the
/// backend serializes the updates of the app manifest.
async function flushRestoreWrites(ctx: RestoreContext): Promise<void> {
    const { registry, pendingWrites } = ctx;
    if (registry != null) {
        await flushRestoredConnectionWrites(ctx, registry);
    }
    for (const { workbookId, scripts, connections } of pendingWrites.workbookScriptLists) {
        await patchRestoredWorkbook(ctx, workbookId, workbook => {
            const next = withWorkbookScripts(workbook, scripts, connections);
            return workbookScriptsResolutionChanged(workbook, next) ? next : null;
        });
    }
    for (const workbookId of pendingWrites.promotedWorkbooks) {
        await patchRestoredWorkbook(ctx, workbookId, workbook => {
            const { ephemeral: _promoted, ...metadata } = workbook.metadata;
            return { ...workbook, metadata };
        });
    }
}

/// Patch the file of a restored workbook, a failure is logged and the next load attempts it again
async function patchRestoredWorkbook(ctx: RestoreContext, workbookId: string, patch: (workbook: WorkbookData) => WorkbookData | null): Promise<void> {
    try {
        const next = patch(await ctx.backend.loadWorkbook(workbookId));
        if (next != null) {
            await ctx.backend.saveWorkbookManifest(workbookId, next);
        }
    } catch (error) {
        ctx.logger.warn("Failed to update a restored workbook", { workbookId, error: stringifyError(error) }, LOG_CTX);
    }
}

/// Persist the connections that the restoration registered
async function flushRestoredConnectionWrites(ctx: RestoreContext, registry: WorkbookRegistryBackend): Promise<void> {
    const { logger, pendingWrites } = ctx;
    try {
        if (pendingWrites.connectionEntries.length > 0) {
            await registry.updateConnections(connections => {
                let next = connections ?? [];
                for (const entry of pendingWrites.connectionEntries) {
                    next = upsertConnectionEntry(next, entry) ?? next;
                }
                return next;
            });
        }
        for (const { connectionId, fileName, text } of pendingWrites.connectionFiles) {
            await registry.saveConnectionFile(connectionId, fileName, text);
        }
    } catch (error) {
        logger.warn("Failed to persist restored connections", { error: stringifyError(error) }, LOG_CTX);
        return;
    }
    for (const { workbookId, connectionId } of pendingWrites.workbookCopies) {
        const connection = ctx.connectionStates.get(connectionId);
        if (connection == null) continue;
        try {
            const existing = await ctx.backend.loadWorkbook(workbookId);
            const next = patchWorkbookConnection(existing, workbookConnectionFromState(connection));
            if (next != null) {
                await ctx.backend.saveWorkbookManifest(workbookId, next);
            }
        } catch (error) {
            logger.warn("Failed to update the connection copy of a workbook", { workbookId, connectionId, error: stringifyError(error) }, LOG_CTX);
        }
    }
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
    for (const database of restored.databases) destroyUnregisteredConnection(database);
}

/// The live connections that a restored workbook resolves its references against
export type LiveConnections = Pick<ConnectionRegistry, 'connections'>;

/// Restore a single, already-persisted workbook (connection references + catalog + workbook) and
/// return just that workbook's pieces.
///
/// This is the incremental counterpart to `restoreAppState`, used after a workbook is written to
/// storage at runtime (e.g. imported from a shared URL) so it can be merged into the already-live
/// registries without a full app reload. It reuses the exact same `restoreWorkbookEntry` path the boot
/// loader runs, so a URL-imported workbook is decoded and cataloged identically to one
/// loaded at startup. References to live connections reuse them, unknown connections are
/// registered and returned.
export async function restoreSingleWorkbook(
    core: DashQL,
    backend: StorageBackend,
    logger: Logger,
    workbookId: string,
    live: LiveConnections,
    processor?: BatchProcessor,
): Promise<RestoredWorkbook> {
    // A freshly imported workbook is implicitly OPFS-backed and keyed by its UUID; that's all the
    // manifest entry `restoreWorkbookEntry` needs to route the load.
    const workbookEntry: WorkbookEntry = { path: workbookId, storageType: StorageBackendType.OPFS };

    const ctx = createRestoreContext(core, backend, logger, processor);
    for (const [connectionId, state] of live.connections) {
        ctx.connectionStates.set(connectionId, state);
        ctx.catalogsRestored.add(connectionId);
    }
    const workbookScripts = new Map<string, WorkbookScripts>();
    const workbookScriptsByConnection = new Map<string, string[]>();

    try {
        await restoreWorkbookEntry(
            ctx,
            workbookEntry,
            workbookScripts,
            workbookScriptsByConnection,
            new RestoreProgress(() => { }),
        );
    } catch (error) {
        for (const database of ctx.newConnections.values()) destroyUnregisteredConnection(database);
        throw error;
    }

    const scripts = workbookScripts.get(workbookId) ?? null;
    if (!scripts) {
        for (const database of ctx.newConnections.values()) destroyUnregisteredConnection(database);
        throw new Error(`imported workbook ${workbookId} did not restore its scripts`);
    }
    await flushRestoreWrites(ctx);
    return {
        workbookId,
        databases: [...ctx.newConnections.values()],
        workbookScripts: scripts,
    };
}

/**
 * Restores complete application state from storage
 */
export async function restoreAppState(
    core: DashQL,
    backend: StorageBackend,
    logger: Logger,
    progressConsumer: (progress: AppStateRestorationProgress) => void,
    processor?: BatchProcessor,
): Promise<RestoredAppState> {
    logger.info("Starting app state restoration", {}, LOG_CTX);
    const startTime = performance.now();

    const ctx = createRestoreContext(core, backend, logger, processor);
    const workbookScripts = new Map<string, WorkbookScripts>();
    const workbookScriptsByConnection = new Map<string, string[]>();
    const invalidWorkbooks = new Map<string, InvalidWorkbook>();

    const progress = new RestoreProgress(progressConsumer);

    try {
        // Load manifest
        logger.info("Loading app manifest", {}, LOG_CTX);
        const manifestStartTime = performance.now();
        const workbookEntries = await backend.listWorkbooks();
        let connectionEntries: ConnectionEntry[] = [];
        if (ctx.registry != null) {
            const manifest = await ctx.registry.loadManifest();
            connectionEntries = manifest.connections ?? [];
        }
        const manifestDuration = performance.now() - manifestStartTime;

        logger.info("Loaded app manifest", {
            workbookCount: workbookEntries.length.toString(),
            connectionCount: connectionEntries.length.toString(),
            durationMs: manifestDuration.toFixed(2)
        }, LOG_CTX);

        // Restore the connections before the workbooks that reference them
        for (const entry of connectionEntries) {
            await restoreConnectionEntry(ctx, entry);
        }

        // Set totals.
        progress.connections.addTotal(workbookEntries.length);
        progress.catalogs.addTotal(workbookEntries.length);
        progress.workbookScripts.addTotal(workbookEntries.length);

        progress.report();

        // Process each workbook
        logger.info("Restoring workbooks", { count: workbookEntries.length.toString() }, LOG_CTX);
        for (let i = 0; i < workbookEntries.length; i++) {
            const workbookEntry = workbookEntries[i];
            const workbookStartTime = performance.now();

            try {
                logger.info("Restoring workbook", {
                    index: `${i + 1}/${workbookEntries.length}`,
                    workbookId: workbookEntry.path
                }, LOG_CTX);

                const invalid = await restoreWorkbookEntry(
                    ctx,
                    workbookEntry,
                    workbookScripts,
                    workbookScriptsByConnection,
                    progress,
                );
                if (invalid != null) {
                    // The workbook stays visible as invalid, the user can delete it
                    invalidWorkbooks.set(invalid.workbookId, invalid);
                }

                const workbookDuration = performance.now() - workbookStartTime;
                logger.info("Workbook restored", {
                    index: `${i + 1}/${workbookEntries.length}`,
                    workbookId: workbookEntry.path,
                    durationMs: workbookDuration.toFixed(2)
                }, LOG_CTX);
            } catch (error) {
                const workbookDuration = performance.now() - workbookStartTime;

                if (error instanceof InvalidWorkbookError) {
                    // Metadata validation refused this workbook up front. Record it so the selector
                    // can show it as invalid (blocked, deletable), and account it as *skipped*
                    // rather than *failed* — nothing was attempted, the metadata was simply
                    // unusable. The workbook contributed no connection/catalog/scripts/scripts.
                    invalidWorkbooks.set(error.invalid.workbookId, error.invalid);
                    progress.connections.addSkipped();
                    progress.catalogs.addSkipped();
                    progress.workbookScripts.addSkipped();

                    progress.report();
                    continue;
                }

                logger.warn("Failed to restore workbook", {
                    index: `${i + 1}/${workbookEntries.length}`,
                    workbookId: workbookEntry.path,
                    durationMs: workbookDuration.toFixed(2),
                    error: stringifyError(error)
                }, LOG_CTX);

                // The workbook stays visible as invalid, the user can delete it
                invalidWorkbooks.set(workbookEntry.path, describeInvalidWorkbook(workbookEntry, WorkbookValidationError.WorkbookNotRestored, null));
                progress.connections.addFailed();
                progress.catalogs.addFailed();
                progress.workbookScripts.addFailed();
                progress.report();
            }
        }
    } catch (manifestError) {
        logger.warn("Failed to load manifest, starting with empty state", {
            error: stringifyError(manifestError)
        }, LOG_CTX);
    }

    await flushRestoreWrites(ctx);

    progress.report();

    const totalDuration = performance.now() - startTime;
    logger.info("Finished loading app state", {
        connections: ctx.connectionStates.size.toString(),
        workbookScripts: workbookScripts.size.toString(),
        invalidWorkbooks: invalidWorkbooks.size.toString(),
        connectionsSucceeded: progress.connections.succeeded.toString(),
        connectionsFailed: progress.connections.failed.toString(),
        connectionsSkipped: progress.connections.skipped.toString(),
        totalDurationMs: totalDuration.toFixed(2)
    }, LOG_CTX);

    return {
        connectionStates: ctx.connectionStates,
        connectionStatesByType: ctx.connectionStatesByType,
        workbookScripts,
        workbookScriptsByConnection,
        invalidWorkbooks,
    };
}
