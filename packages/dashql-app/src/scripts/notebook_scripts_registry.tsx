import * as React from 'react';

import { NotebookScripts, NotebookScriptsAction, destroyNotebookScripts, reduceNotebookScripts } from './notebook_scripts.js';
import { Dispatch } from '../utils/variant.js';
import { CONNECTOR_TYPES, ConnectorType } from '../connection/connector_info.js';
import { useConnectionRegistry } from '../connection/connection_registry.js';
import { useStorageWriter } from '../platform/storage/storage_provider.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { REPLACE_NOTEBOOK_SCRIPTS, DEBOUNCE_DURATION_NOTEBOOK_WRITE, groupNotebookWrites } from "../platform/storage/storage_writer.js";

/// The scripts registry.
///
/// Note that we're deliberately not using immutable maps for notebook scripts and the connection index.
/// We're never "observing" these maps directly and thus can live with the simple variants.
/// Shallow-compare the entire registry object instead when reacting to notebook list changes.
export interface NotebookScriptsRegistry {
    /// The scripts map (notebookId -> NotebookScripts)
    notebookScriptsMap: Map<string, NotebookScripts>;
    /// The index to find scripts associated with a connection (1:1 mapping, notebookId -> notebookId)
    notebookScriptsByConnection: Map<string, string>;
    /// The index to find scripts associated with a connection type (arrays of notebookIds)
    notebookScriptsByConnectionType: string[][];
}

export type NotebookScriptsInput = NotebookScripts;
export type SetNotebookScriptsRegistryAction = React.SetStateAction<NotebookScriptsRegistry>;
export type NotebookScriptsAllocator = (scripts: NotebookScriptsInput) => [string, NotebookScripts];
export type ModifyNotebookScripts = (action: NotebookScriptsAction) => void;
export type ModifyConnectionNotebookScripts = (conn: string, action: NotebookScriptsAction) => void;

const NOTEBOOK_SCRIPTS_REGISTRY_CTX = React.createContext<[NotebookScriptsRegistry, Dispatch<SetNotebookScriptsRegistryAction>] | null>(null);

type Props = {};

export const NotebookScriptsRegistryProvider: React.FC<React.PropsWithChildren<Props>> = (props: React.PropsWithChildren<Props>) => {
    const reg = React.useState<NotebookScriptsRegistry>(() => ({
        notebookScriptsMap: new Map(),
        notebookScriptsByConnection: new Map(),
        notebookScriptsByConnectionType: CONNECTOR_TYPES.map(() => []),
    }));
    return (
        <NOTEBOOK_SCRIPTS_REGISTRY_CTX.Provider value={reg}>
            {props.children}
        </NOTEBOOK_SCRIPTS_REGISTRY_CTX.Provider>
    );
};

export function useNotebookScriptsRegistry(): [NotebookScriptsRegistry, Dispatch<SetNotebookScriptsRegistryAction>] {
    return React.useContext(NOTEBOOK_SCRIPTS_REGISTRY_CTX)!;
}

export function useNotebookScriptsAllocator(): NotebookScriptsAllocator {
    const storage = useStorageWriter();
    const [_reg, setReg] = React.useContext(NOTEBOOK_SCRIPTS_REGISTRY_CTX)!;
    return React.useCallback((state: NotebookScriptsInput) => {
        const notebookId = state.notebookId;
        const scripts: NotebookScripts = { ...state };

        // Modify the registry
        setReg((reg) => {
            if (scripts.notebookMetadata.originalFileName == "") {
                scripts.notebookMetadata.originalFileName = `${scripts.connectorInfo.names.fileShort}`;
            }

            // 1:1 mapping: notebookId -> notebookId
            reg.notebookScriptsByConnection.set(notebookId, notebookId);
            reg.notebookScriptsByConnectionType[state.connectorInfo.connectorType].push(notebookId);
            reg.notebookScriptsMap.set(notebookId, scripts);
            return { ...reg };
        });

        storage.write(groupNotebookWrites(scripts.notebookId), {
            type: REPLACE_NOTEBOOK_SCRIPTS,
            value: scripts
        }, DEBOUNCE_DURATION_NOTEBOOK_WRITE);
        return [notebookId, scripts];
    }, [setReg, storage]);
}

/// Remove a notebook from all three registry indices.
///
/// Pure and idempotent (a missing entry is a no-op), so it is safe to run inside a React state
/// updater that may be invoked more than once. It touches no Wasm — freeing the notebook's Wasm is
/// the caller's responsibility and must happen separately (see useNotebookScriptsDeletion), because that
/// teardown is order-sensitive against the shared connection catalog.
export function removeNotebookScriptsFromRegistry(reg: NotebookScriptsRegistry, notebookId: string): NotebookScriptsRegistry {
    const entry = reg.notebookScriptsMap.get(notebookId);
    if (!entry) return reg;
    reg.notebookScriptsMap.delete(notebookId);
    // 1:1 mapping: notebookId -> notebookId
    reg.notebookScriptsByConnection.delete(notebookId);
    const connectorType = entry.connectorInfo.connectorType;
    reg.notebookScriptsByConnectionType[connectorType] =
        reg.notebookScriptsByConnectionType[connectorType].filter(id => id !== notebookId);
    return { ...reg };
}

/// Delete a notebook's scripts and free their Wasm.
///
/// Notebook scripts share the connection's catalog by reference (see notebook_scripts_setup) and own every
/// script they create. destroyNotebookScripts() drops those scripts from the shared catalog and then frees
/// them, so it MUST run while that catalog is still alive, i.e.
/// *before* the connection is deleted (DELETE_CONNECTION destroys the catalog). We therefore tear
/// the Wasm down synchronously here, in the event handler, and keep the registry-map removal a
/// pure updater (safe to run more than once). Callers must invoke this before dispatching
/// DELETE_CONNECTION for the same notebook.
export function useNotebookScriptsDeletion(): (notebookId: string) => void {
    const [reg, setReg] = React.useContext(NOTEBOOK_SCRIPTS_REGISTRY_CTX)!;
    return React.useCallback((notebookId: string) => {
        // Free the notebook-owned Wasm now, before the shared catalog can be destroyed. The
        // registry closure is recreated on every change, so this read is current at call time.
        const scripts = reg.notebookScriptsMap.get(notebookId);
        if (scripts) {
            destroyNotebookScripts(scripts);
        }
        // Drop the entry from all three indices.
        setReg((prev) => removeNotebookScriptsFromRegistry(prev, notebookId));
    }, [reg, setReg]);
}

export function useNotebookScripts(id: string | null): [NotebookScripts | null, ModifyNotebookScripts] {
    const [registry, setRegistry] = React.useContext(NOTEBOOK_SCRIPTS_REGISTRY_CTX)!;
    const [connReg] = useConnectionRegistry();
    const storageWriter = useStorageWriter();
    const logger = useLogger();

    // Queue for batching rapid dispatch calls to avoid concurrent rendering issues
    const pendingActionsRef = React.useRef<NotebookScriptsAction[]>([]);
    const flushScheduledRef = React.useRef(false);

    // Flush all pending actions in a single state update
    const flushPendingActions = React.useCallback(() => {
        flushScheduledRef.current = false;
        const actions = pendingActionsRef.current;
        if (actions.length === 0 || id == null) return;
        pendingActionsRef.current = [];

        setRegistry((reg: NotebookScriptsRegistry) => {
            // Check if the connection is active to gate storage writes
            const active = connReg.connectionMap.get(id)?.active ?? false;
            for (const action of actions) {
                const prev = reg.notebookScriptsMap.get(id);
                if (!prev) {
                    console.warn(`no notebook scripts registered with notebook id ${id}`);
                    continue;
                }
                const next = reduceNotebookScripts(prev, action, storageWriter, logger, active);
                reg.notebookScriptsMap.set(id, next);
            }
            return { ...reg };
        });
    }, [id, setRegistry, storageWriter, logger, connReg]);

    /// Wrapper to modify an individual notebook scripts collection
    const dispatch = React.useCallback((action: NotebookScriptsAction) => {
        if (id == null) return;
        // Queue the action
        pendingActionsRef.current.push(action);

        // Schedule a flush if not already scheduled
        if (!flushScheduledRef.current) {
            flushScheduledRef.current = true;
            queueMicrotask(flushPendingActions);
        }
    }, [id, flushPendingActions]);

    return [id == null ? null : registry.notebookScriptsMap.get(id) ?? null, dispatch];
};

export function useConnectionScriptsDispatch(): ModifyConnectionNotebookScripts {
    const [_registry, setRegistry] = React.useContext(NOTEBOOK_SCRIPTS_REGISTRY_CTX)!;
    const [connReg] = useConnectionRegistry();
    const storage = useStorageWriter();
    const logger = useLogger();

    // Queue for batching rapid dispatch calls to avoid concurrent rendering issues
    const pendingActionsRef = React.useRef<Array<{ conn: string; action: NotebookScriptsAction }>>([]);
    const flushScheduledRef = React.useRef(false);

    // Flush all pending actions in a single state update
    const flushPendingActions = React.useCallback(() => {
        flushScheduledRef.current = false;
        const actions = pendingActionsRef.current;
        if (actions.length === 0) return;
        pendingActionsRef.current = [];

        setRegistry((reg: NotebookScriptsRegistry) => {
            for (const { conn, action } of actions) {
                // Since 1:1 mapping, notebookId -> notebookId
                const notebookId = reg.notebookScriptsByConnection.get(conn);
                if (notebookId) {
                    const prev = reg.notebookScriptsMap.get(notebookId);
                    if (prev) {
                        const active = connReg.connectionMap.get(conn)?.active ?? false;
                        const next = reduceNotebookScripts(prev, action, storage, logger, active);
                        reg.notebookScriptsMap.set(notebookId, next);
                    }
                }
            }
            return { ...reg };
        });
    }, [setRegistry, storage, logger, connReg]);

    const dispatch = React.useCallback<ModifyConnectionNotebookScripts>((conn: string, action: NotebookScriptsAction) => {
        // Queue the action
        pendingActionsRef.current.push({ conn, action });

        // Schedule a flush if not already scheduled
        if (!flushScheduledRef.current) {
            flushScheduledRef.current = true;
            queueMicrotask(flushPendingActions);
        }
    }, [flushPendingActions]);

    return dispatch;
}
