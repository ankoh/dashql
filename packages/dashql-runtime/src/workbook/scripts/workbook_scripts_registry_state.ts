import {
    ANALYZE_OUTDATED_SCRIPT,
    isAnalysisOutdated,
    promoteEphemeralWorkbook,
    reduceWorkbookScripts,
    WorkbookScriptsEffects,
    workbookConnectionIds,
    workbookScriptListWrite,
    type ScriptData,
    type WorkbookScripts,
    type WorkbookScriptsAction,
} from './workbook_scripts.js';
import type { UpdateQueue } from '../../store/store.js';
import type { ConnectionReferences } from '../../connections/connection_registry_state.js';
import { stringifyError, type Logger } from '../../platform/logger/logger.js';
import type { InvalidWorkbook } from '../../storage/workbook_validation.js';
import type { StorageWriter, WorkbookReplacement } from '../../storage/storage_writer.js';

const LOG_CTX = 'workbook_scripts_registry';

/// The scripts registry.
///
/// Note that we're deliberately not using immutable maps for workbook scripts and the connection index.
/// We're never "observing" these maps directly and thus can live with the simple variants.
/// Shallow-compare the entire registry object instead when reacting to workbook list changes.
export interface WorkbookScriptsRegistry {
    /// The scripts map (workbookId -> WorkbookScripts)
    workbookScriptsMap: Map<string, WorkbookScripts>;
    /// The index to find the workbooks with scripts that analyze with a connection (connectionId -> workbookIds)
    workbookScriptsByConnection: Map<string, string[]>;
    /// The workbooks that were refused a load (workbookId -> reason). They never enter the scripts map,
    /// the workbench lists them as invalid and they can only be deleted.
    invalidWorkbooks: Map<string, InvalidWorkbook>;
}

/// Copy the indices of a registry before modifying them. Snapshots of the registry are never modified, a
/// component that renders an older snapshot keeps seeing the maps of that snapshot.
export function copyWorkbookScriptsRegistry(reg: WorkbookScriptsRegistry): WorkbookScriptsRegistry {
    return {
        ...reg,
        workbookScriptsMap: new Map(reg.workbookScriptsMap),
        workbookScriptsByConnection: new Map(reg.workbookScriptsByConnection),
    };
}

/// The registry with the next scripts of a workbook, the given registry stays unchanged
export function replaceWorkbookScriptsInRegistry(reg: WorkbookScriptsRegistry, prev: WorkbookScripts, next: WorkbookScripts): WorkbookScriptsRegistry {
    const copy = copyWorkbookScriptsRegistry(reg);
    copy.workbookScriptsMap.set(next.workbookId, next);
    reindexWorkbookScriptConnections(copy, prev, next);
    return copy;
}

export type WorkbookScriptsAllocator = (scripts: WorkbookScripts) => [string, WorkbookScripts];
export type ModifyWorkbookScripts = (action: WorkbookScriptsAction) => Promise<WorkbookScripts | null> | void;
/// Resolves once the action was applied to the workbooks
export type ModifyConnectionWorkbookScripts = (conn: string, action: WorkbookScriptsAction) => Promise<void>;

/// The connections that the workbooks of a scripts registry use
export function workbookConnectionReferences(registry: { current: WorkbookScriptsRegistry; subscribe: (listener: () => void) => () => void }): ConnectionReferences {
    return {
        workbooksOf: connectionId => registry.current.workbookScriptsByConnection.get(connectionId) ?? [],
        connectionsOf: workbookId => {
            const scripts = registry.current.workbookScriptsMap.get(workbookId);
            return scripts == null ? [] : workbookConnectionIds(scripts);
        },
        subscribe: registry.subscribe,
    };
}

/// The write of a whole workbook, its script texts are read when the write runs
export function workbookReplacement(scripts: WorkbookScripts): WorkbookReplacement {
    return {
        workbookId: scripts.workbookId,
        name: scripts.name,
        scripts: scripts.scriptOrder.flatMap(fileName => {
            const script = scripts.scripts[scripts.scriptRefs[fileName]?.scriptId];
            return script == null ? [] : [{
                fileName,
                readText: () => script.scriptSession.getText(),
            }];
        }),
        connection: workbookScriptListWrite(scripts).connections[0] ?? null,
        originalFileName: scripts.workbookMetadata.originalFileName,
    };
}

/// Record that a workbook analyzes its scripts with a connection (mutates the registry)
export function addWorkbookScriptsForConnection(reg: WorkbookScriptsRegistry, connectionId: string, workbookId: string): void {
    const workbooks = reg.workbookScriptsByConnection.get(connectionId) ?? [];
    if (!workbooks.includes(workbookId)) {
        reg.workbookScriptsByConnection.set(connectionId, [...workbooks, workbookId]);
    }
}

/// Follow the connections of a workbook's scripts in the connection index (mutates the registry)
export function reindexWorkbookScriptConnections(reg: WorkbookScriptsRegistry, prev: WorkbookScripts, next: WorkbookScripts): void {
    if (prev.scripts === next.scripts && prev.pendingConnection === next.pendingConnection) return;
    const prevIds = new Set(workbookConnectionIds(prev));
    const nextIds = new Set(workbookConnectionIds(next));
    for (const connectionId of prevIds) {
        if (!nextIds.has(connectionId)) removeWorkbookScriptsForConnection(reg, connectionId, next.workbookId);
    }
    for (const connectionId of nextIds) {
        if (!prevIds.has(connectionId)) addWorkbookScriptsForConnection(reg, connectionId, next.workbookId);
    }
}

/// Drop a workbook from the scripts of a connection (mutates the registry)
export function removeWorkbookScriptsForConnection(reg: WorkbookScriptsRegistry, connectionId: string, workbookId: string): void {
    const workbooks = (reg.workbookScriptsByConnection.get(connectionId) ?? []).filter(id => id !== workbookId);
    if (workbooks.length === 0) {
        reg.workbookScriptsByConnection.delete(connectionId);
    } else {
        reg.workbookScriptsByConnection.set(connectionId, workbooks);
    }
}

/// Remove a workbook from all three registry indices.
///
/// Pure and idempotent (a missing entry is a no-op, the given registry stays unchanged), so it is safe to run
/// inside a React state updater that may be invoked more than once. It touches no Wasm — freeing the workbook's Wasm is
/// the caller's responsibility and must happen separately (see useWorkbookScriptsDeletion), because that
/// teardown is order-sensitive against the shared connection catalog.
export function removeWorkbookScriptsFromRegistry(reg: WorkbookScriptsRegistry, workbookId: string): WorkbookScriptsRegistry {
    const entry = reg.workbookScriptsMap.get(workbookId);
    if (!entry) return reg;
    const next = copyWorkbookScriptsRegistry(reg);
    next.workbookScriptsMap.delete(workbookId);
    for (const connectionId of workbookConnectionIds(entry)) {
        removeWorkbookScriptsForConnection(next, connectionId, workbookId);
    }
    return next;
}

/// Apply an action to the scripts of a workbook through the shared queue
export function dispatchWorkbookScriptsAction(
    queue: UpdateQueue<WorkbookScriptsRegistry>,
    storageWriter: StorageWriter,
    logger: Logger,
    id: string,
    action: WorkbookScriptsAction,
): Promise<WorkbookScripts | null> {
    return new Promise<WorkbookScripts | null>((resolve) => {
        logger.debug('Queued workbook script action', {
            workbookId: id,
            actionType: action.type.description ?? action.type.toString(),
        }, LOG_CTX);
        queue.push(reg => {
            const prev = reg.workbookScriptsMap.get(id);
            if (!prev) {
                logger.warn('No workbook scripts registered for workbook', { workbookId: id }, LOG_CTX);
                resolve(null);
                return reg;
            }
            let next: WorkbookScripts;
            const effects = new WorkbookScriptsEffects(storageWriter);
            try {
                next = promoteEphemeralWorkbook(reduceWorkbookScripts(prev, action, effects, logger), reg.workbookScriptsMap.values(), effects);
            } catch (e: unknown) {
                // Drop the action, a throw would also drop the other updates of the queue flush
                logger.error('Workbook script action failed', {
                    workbookId: id,
                    actionType: action.type.description ?? action.type.toString(),
                    error: stringifyError(e),
                }, LOG_CTX);
                resolve(prev);
                return reg;
            }
            effects.commit();
            resolve(next);
            // Keep the registry identity for no-ops
            if (next === prev) return reg;
            return replaceWorkbookScriptsInRegistry(reg, prev, next);
        });
    });
}

/// Return a script with current analysis, synchronizing workbook state first when necessary.
export async function ensureWorkbookScriptAnalyzed(
    workbookScripts: WorkbookScripts,
    scriptKey: number,
    modifyWorkbookScripts: ModifyWorkbookScripts,
): Promise<ScriptData | null> {
    const scriptData = workbookScripts.scripts[scriptKey];
    if (!scriptData) return null;
    if (!isAnalysisOutdated(scriptData)) return scriptData;
    const result = modifyWorkbookScripts({ type: ANALYZE_OUTDATED_SCRIPT, value: scriptKey });
    if (!result) return null;
    const next = await result;
    return next ? next.scripts[scriptKey] ?? null : null;
}

/// Apply an action to every workbook with scripts that analyze with a connection
export function applyConnectionWorkbookScriptsAction(
    prevReg: WorkbookScriptsRegistry,
    conn: string,
    action: WorkbookScriptsAction,
    storage: StorageWriter,
    logger: Logger,
): WorkbookScriptsRegistry {
    let reg = prevReg;
    // Every workbook with scripts that analyze with the connection receives the action
    for (const workbookId of [...(reg.workbookScriptsByConnection.get(conn) ?? [])]) {
        const prev = reg.workbookScriptsMap.get(workbookId);
        if (prev) {
            let next: WorkbookScripts;
            const effects = new WorkbookScriptsEffects(storage);
            try {
                next = reduceWorkbookScripts(prev, action, effects, logger);
            } catch (e: unknown) {
                // Skip the workbook, the other workbooks of the connection still receive the action
                logger.error('Connection script action failed', {
                    connectionId: conn,
                    workbookId,
                    actionType: action.type.description ?? action.type.toString(),
                    error: stringifyError(e),
                }, LOG_CTX);
                continue;
            }
            effects.commit();
            if (next !== prev) reg = replaceWorkbookScriptsInRegistry(reg, prev, next);
        }
    }
    return reg;
}
