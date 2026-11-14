import * as React from 'react';

import { forgetWorkbookScriptReferences } from './script_reference_reports.js';
import { forgetDataflowGraph } from '../dataflow/dataflow_graph.js';
import { WorkbookScripts, WorkbookScriptsAction, destroyWorkbookScripts, newScriptConnection, workbookConnectionIds, workbookScriptListWrite } from './workbook_scripts.js';
import { Dispatch } from '../../utils/variant.js';
import { UpdateQueue } from '@ankoh/dashql-sdk/store/store';
import { useStore, useStoreState, useUpdateQueue } from '../../utils/store_hooks.js';
import { useStorageWriter } from '../../storage/storage_provider.js';
import { ConnectionReferencesProvider, type ConnectionReferences } from '../../connections/connection_registry.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { stringifyError } from '../../platform/logger/logger.js';
import type { InvalidWorkbook } from '../../storage/workbook_validation.js';
import {
    REPLACE_WORKBOOK_SCRIPTS,
    DEBOUNCE_DURATION_WORKBOOK_WRITE,
    groupWorkbookScriptListWrites,
    groupWorkbookWrites,
    WRITE_WORKBOOK_SCRIPTS,
} from "../../storage/storage_writer.js";
import {
    addWorkbookScriptsForConnection,
    applyConnectionWorkbookScriptsAction,
    copyWorkbookScriptsRegistry,
    dispatchWorkbookScriptsAction,
    removeWorkbookScriptsFromRegistry,
    workbookConnectionReferences,
    workbookReplacement,
    type ModifyConnectionWorkbookScripts,
    type ModifyWorkbookScripts,
    type WorkbookScriptsAllocator,
    type WorkbookScriptsRegistry,
} from './workbook_scripts_registry_state.js';

// The state of the registry and its reducers are in workbook_scripts_registry_state.ts, this module binds them to React
export {
    addWorkbookScriptsForConnection,
    applyConnectionWorkbookScriptsAction,
    copyWorkbookScriptsRegistry,
    dispatchWorkbookScriptsAction,
    ensureWorkbookScriptAnalyzed,
    reindexWorkbookScriptConnections,
    removeWorkbookScriptsForConnection,
    removeWorkbookScriptsFromRegistry,
    replaceWorkbookScriptsInRegistry,
    workbookConnectionReferences,
    workbookReplacement,
    type ModifyConnectionWorkbookScripts,
    type ModifyWorkbookScripts,
    type WorkbookScriptsAllocator,
    type WorkbookScriptsRegistry,
} from './workbook_scripts_registry_state.js';

const LOG_CTX = 'workbook_scripts_registry';

export type SetWorkbookScriptsRegistryAction = React.SetStateAction<WorkbookScriptsRegistry>;


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

export function useConnectionScriptsDispatch(): ModifyConnectionWorkbookScripts {
    const queue = React.useContext(WORKBOOK_SCRIPTS_REGISTRY_QUEUE_CTX)!;
    const storage = useStorageWriter();
    const logger = useLogger();

    return React.useCallback<ModifyConnectionWorkbookScripts>((conn: string, action: WorkbookScriptsAction) => new Promise<void>(resolve => {
        queue.push(prevReg => {
            const reg = applyConnectionWorkbookScriptsAction(prevReg, conn, action, storage, logger);
            resolve();
            return reg;
        });
    }), [queue, storage, logger]);
}
