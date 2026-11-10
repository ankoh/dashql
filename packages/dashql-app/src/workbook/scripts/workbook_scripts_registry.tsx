import * as React from 'react';

import { forgetWorkbookScriptReferences } from './script_reference_reports.js';
import { forgetDataflowGraph } from '../dataflow/dataflow_graph.js';
import { ANALYZE_OUTDATED_SCRIPT, WorkbookScripts, WorkbookScriptsAction, ScriptData, destroyWorkbookScripts, isAnalysisOutdated, newScriptConnection, promoteEphemeralWorkbook, reduceWorkbookScripts, WorkbookScriptsEffects, workbookConnectionIds, workbookScriptListWrite } from './workbook_scripts.js';
import { Dispatch } from '../../utils/variant.js';
import { UpdateQueue, useStore, useStoreState, useUpdateQueue } from '../../utils/store.js';
import { useStorageWriter } from '../../storage/storage_provider.js';
import { ConnectionReferencesProvider, type ConnectionReferences } from '../../connections/connection_registry.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { stringifyError } from '../../platform/logger/logger.js';
import type { InvalidWorkbook } from '../../storage/workbook_validation.js';
import {
    REPLACE_WORKBOOK_SCRIPTS,
    DEBOUNCE_DURATION_WORKBOOK_WRITE,
    type WorkbookReplacement,
    groupWorkbookScriptListWrites,
    groupWorkbookWrites,
    WRITE_WORKBOOK_SCRIPTS,
} from "../../storage/storage_writer.js";

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

export type SetWorkbookScriptsRegistryAction = React.SetStateAction<WorkbookScriptsRegistry>;

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

// The registry changes with every editor update while the setter is stable.
// Hooks that only modify the registry subscribe to the setter context and don't re-render on every update.
const WORKBOOK_SCRIPTS_REGISTRY_CTX = React.createContext<WorkbookScriptsRegistry | null>(null);
const WORKBOOK_SCRIPTS_REGISTRY_SETTER_CTX = React.createContext<Dispatch<SetWorkbookScriptsRegistryAction> | null>(null);
// Reads the current registry without subscribing to its changes
const WORKBOOK_SCRIPTS_REGISTRY_READER_CTX = React.createContext<(() => WorkbookScriptsRegistry) | null>(null);
// The workbook script actions of all components are applied in order through one queue
const WORKBOOK_SCRIPTS_REGISTRY_QUEUE_CTX = React.createContext<UpdateQueue<WorkbookScriptsRegistry> | null>(null);

type Props = {};

export const WorkbookScriptsRegistryProvider: React.FC<React.PropsWithChildren<Props>> = (props: React.PropsWithChildren<Props>) => {
    // Reducing workbook scripts mutates Wasm objects and schedules storage writes, the store runs every update once
    const store = useStore<WorkbookScriptsRegistry>(() => ({
        workbookScriptsMap: new Map(),
        workbookScriptsByConnection: new Map(),
        invalidWorkbooks: new Map(),
    }));
    const queue = useUpdateQueue(store);
    const reg = useStoreState(store);
    // The scripts own the references to their connections, the connection layer reads them from here
    const references = React.useMemo<ConnectionReferences>(() => workbookConnectionReferences(store), [store]);
    return (
        <ConnectionReferencesProvider value={references}>
            <WORKBOOK_SCRIPTS_REGISTRY_QUEUE_CTX.Provider value={queue}>
                <WORKBOOK_SCRIPTS_REGISTRY_READER_CTX.Provider value={store.get}>
                    <WORKBOOK_SCRIPTS_REGISTRY_SETTER_CTX.Provider value={store.update}>
                        <WORKBOOK_SCRIPTS_REGISTRY_CTX.Provider value={reg}>
                            {props.children}
                        </WORKBOOK_SCRIPTS_REGISTRY_CTX.Provider>
                    </WORKBOOK_SCRIPTS_REGISTRY_SETTER_CTX.Provider>
                </WORKBOOK_SCRIPTS_REGISTRY_READER_CTX.Provider>
            </WORKBOOK_SCRIPTS_REGISTRY_QUEUE_CTX.Provider>
        </ConnectionReferencesProvider>
    );
};

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

export function useWorkbookScriptsRegistry(): [WorkbookScriptsRegistry, Dispatch<SetWorkbookScriptsRegistryAction>] {
    return [React.useContext(WORKBOOK_SCRIPTS_REGISTRY_CTX)!, React.useContext(WORKBOOK_SCRIPTS_REGISTRY_SETTER_CTX)!];
}

/// Modify the registry without subscribing to its changes
export function useWorkbookScriptsRegistrySetter(): Dispatch<SetWorkbookScriptsRegistryAction> {
    return React.useContext(WORKBOOK_SCRIPTS_REGISTRY_SETTER_CTX)!;
}

/// Read the current registry without subscribing to its changes
export function useWorkbookScriptsRegistryReader(): () => WorkbookScriptsRegistry {
    return React.useContext(WORKBOOK_SCRIPTS_REGISTRY_READER_CTX)!;
}

/// The workbooks that were refused a load
export interface InvalidWorkbooks {
    /// The invalid workbooks (workbookId -> reason)
    invalidWorkbooks: ReadonlyMap<string, InvalidWorkbook>;
    /// Delete the files of an invalid workbook and drop it from the list
    deleteInvalidWorkbook: (workbookId: string) => Promise<void>;
}

export function useInvalidWorkbooks(): InvalidWorkbooks {
    const reg = React.useContext(WORKBOOK_SCRIPTS_REGISTRY_CTX)!;
    const setReg = React.useContext(WORKBOOK_SCRIPTS_REGISTRY_SETTER_CTX)!;
    const storage = useStorageWriter();
    const logger = useLogger();
    const deleteInvalidWorkbook = React.useCallback(async (workbookId: string) => {
        try {
            await storage.deleteWorkbook(workbookId);
        } catch (error) {
            logger.error('Failed to delete invalid workbook', { workbookId, error: stringifyError(error) }, LOG_CTX);
        }
        setReg(reg => {
            if (!reg.invalidWorkbooks.has(workbookId)) return reg;
            const invalidWorkbooks = new Map(reg.invalidWorkbooks);
            invalidWorkbooks.delete(workbookId);
            return { ...reg, invalidWorkbooks };
        });
    }, [logger, setReg, storage]);
    return React.useMemo(() => ({ invalidWorkbooks: reg.invalidWorkbooks, deleteInvalidWorkbook }), [reg.invalidWorkbooks, deleteInvalidWorkbook]);
}

export function useWorkbookScriptsAllocator(): WorkbookScriptsAllocator {
    const storage = useStorageWriter();
    const setReg = React.useContext(WORKBOOK_SCRIPTS_REGISTRY_SETTER_CTX)!;
    return React.useCallback((state: WorkbookScripts) => {
        const workbookId = state.workbookId;
        const scripts: WorkbookScripts = { ...state };

        // Modify the registry
        setReg((prevReg) => {
            const connectorInfo = newScriptConnection(scripts, null)?.connectorInfo;
            if (scripts.workbookMetadata.originalFileName == "" && connectorInfo != null) {
                scripts.workbookMetadata.originalFileName = `${connectorInfo.names.fileShort}`;
            }

            const reg = copyWorkbookScriptsRegistry(prevReg);
            for (const connectionId of workbookConnectionIds(scripts)) {
                addWorkbookScriptsForConnection(reg, connectionId, workbookId);
            }
            reg.workbookScriptsMap.set(workbookId, scripts);
            return reg;
        });

        storage.write(groupWorkbookWrites(scripts.workbookId), {
            type: REPLACE_WORKBOOK_SCRIPTS,
            value: workbookReplacement(scripts),
        }, DEBOUNCE_DURATION_WORKBOOK_WRITE);
        // Scheduled after the workbook file is written, the script list has a single writer
        storage.write(groupWorkbookScriptListWrites(scripts.workbookId), {
            type: WRITE_WORKBOOK_SCRIPTS,
            value: [scripts.workbookId, workbookScriptListWrite(scripts)],
        }, DEBOUNCE_DURATION_WORKBOOK_WRITE);
        return [workbookId, scripts];
    }, [setReg, storage]);
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

/// Delete a workbook's scripts and free their Wasm.
///
/// Workbook scripts share the connection's catalog by reference (see workbook_creation) and own every
/// editor workbook they create. destroyWorkbookScripts() drops those editor workbooks from the shared catalog and then frees
/// them, so it MUST run while that catalog is still alive, i.e.
/// *before* the connection is deleted (DELETE_CONNECTION destroys the catalog). We therefore tear
/// the Wasm down synchronously here, in the event handler, and keep the registry-map removal a
/// pure updater (safe to run more than once). Callers must invoke this before dispatching
/// DELETE_CONNECTION for the same workbook.
export function useWorkbookScriptsDeletion(): (workbookId: string) => void {
    const readReg = React.useContext(WORKBOOK_SCRIPTS_REGISTRY_READER_CTX)!;
    const setReg = React.useContext(WORKBOOK_SCRIPTS_REGISTRY_SETTER_CTX)!;
    return React.useCallback((workbookId: string) => {
        // Free the workbook-owned Wasm now, before the shared catalog can be destroyed. The store holds the
        // latest registry, a rendered snapshot may miss the latest scripts of the workbook.
        const scripts = readReg().workbookScriptsMap.get(workbookId);
        if (scripts) {
            destroyWorkbookScripts(scripts);
        }
        // The caches of the workbook in the app go with it
        forgetWorkbookScriptReferences(workbookId);
        forgetDataflowGraph(workbookId);
        // Drop the entry from all three indices.
        setReg((prev) => removeWorkbookScriptsFromRegistry(prev, workbookId));
    }, [readReg, setReg]);
}

/// Apply an action to the scripts of a workbook through the shared queue
function dispatchWorkbookScriptsAction(
    queue: UpdateQueue<WorkbookScriptsRegistry>,
    storageWriter: ReturnType<typeof useStorageWriter>,
    logger: ReturnType<typeof useLogger>,
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
            // Keep the registry identity for no-ops (e.g. re-selecting the hovered script)
            if (next === prev) return reg;
            return replaceWorkbookScriptsInRegistry(reg, prev, next);
        });
    });
}

export function useWorkbookScripts(id: string | null): [WorkbookScripts | null, ModifyWorkbookScripts] {
    const registry = React.useContext(WORKBOOK_SCRIPTS_REGISTRY_CTX)!;
    const queue = React.useContext(WORKBOOK_SCRIPTS_REGISTRY_QUEUE_CTX)!;
    const storageWriter = useStorageWriter();
    const logger = useLogger();

    /// Wrapper to modify an individual workbook scripts collection
    const dispatch = React.useCallback((action: WorkbookScriptsAction) => {
        if (id == null) return Promise.resolve(null);
        return dispatchWorkbookScriptsAction(queue, storageWriter, logger, id, action);
    }, [id, queue, storageWriter, logger]);

    return [id == null ? null : registry.workbookScriptsMap.get(id) ?? null, dispatch];
};

/// Modify the scripts of any workbook without subscribing to the registry
export function useWorkbookScriptsDispatch(): (id: string, action: WorkbookScriptsAction) => Promise<WorkbookScripts | null> {
    const queue = React.useContext(WORKBOOK_SCRIPTS_REGISTRY_QUEUE_CTX)!;
    const storageWriter = useStorageWriter();
    const logger = useLogger();
    return React.useCallback(
        (id: string, action: WorkbookScriptsAction) => dispatchWorkbookScriptsAction(queue, storageWriter, logger, id, action),
        [queue, storageWriter, logger],
    );
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

export function useConnectionScriptsDispatch(): ModifyConnectionWorkbookScripts {
    const queue = React.useContext(WORKBOOK_SCRIPTS_REGISTRY_QUEUE_CTX)!;
    const storage = useStorageWriter();
    const logger = useLogger();

    return React.useCallback<ModifyConnectionWorkbookScripts>((conn: string, action: WorkbookScriptsAction) => new Promise<void>(resolve => {
        queue.push(prevReg => {
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
            resolve();
            return reg;
        });
    }), [queue, storage, logger]);
}
