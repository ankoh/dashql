import * as React from 'react';

import { NotebookState, NotebookStateAction, destroyState, reduceNotebookState } from './notebook_state.js';
import { Dispatch } from '../utils/variant.js';
import { CONNECTOR_TYPES, ConnectorType } from '../connection/connector_info.js';
import { useConnectionRegistry } from '../connection/connection_registry.js';
import { useStorageWriter } from '../platform/storage/storage_provider.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { REPLACE_NOTEBOOK, DEBOUNCE_DURATION_NOTEBOOK_WRITE, groupNotebookWrites } from "../platform/storage/storage_writer.js";

/// The notebook registry.
///
/// Note that we're deliberately not using immutable maps for notebooks and the connection index.
/// We're never "observing" these maps directly and thus can live with the simple variants.
/// Shallow-compare the entire registry object instead when reacting to notebook list changes.
export interface NotebookRegistry {
    /// The notebook map (sessionId -> NotebookState)
    notebookMap: Map<string, NotebookState>;
    /// The index to find notebooks associated with a session (1:1 mapping, sessionId -> sessionId)
    notebooksByConnection: Map<string, string>;
    /// The index to find notebooks associated with a connection type (arrays of sessionIds)
    notebooksByConnectionType: string[][];
}

export type NotebookStateWithoutId = NotebookState;
export type SetNotebookRegistryAction = React.SetStateAction<NotebookRegistry>;
export type NotebookAllocator = (notebook: NotebookStateWithoutId) => [string, NotebookState];
export type ModifyNotebook = (action: NotebookStateAction) => void;
export type ModifyConnectionNotebooks = (conn: string, action: NotebookStateAction) => void;

const NOTEBOOK_REGISTRY_CTX = React.createContext<[NotebookRegistry, Dispatch<SetNotebookRegistryAction>] | null>(null);

type Props = {};

export const NotebookStateRegistry: React.FC<React.PropsWithChildren<Props>> = (props: React.PropsWithChildren<Props>) => {
    const reg = React.useState<NotebookRegistry>(() => ({
        notebookMap: new Map(),
        notebooksByConnection: new Map(),
        notebooksByConnectionType: CONNECTOR_TYPES.map(() => []),
    }));
    return (
        <NOTEBOOK_REGISTRY_CTX.Provider value={reg}>
            {props.children}
        </NOTEBOOK_REGISTRY_CTX.Provider>
    );
};

export function useNotebookRegistry(): [NotebookRegistry, Dispatch<SetNotebookRegistryAction>] {
    return React.useContext(NOTEBOOK_REGISTRY_CTX)!;
}

export function useNotebookStateAllocator(): NotebookAllocator {
    const storage = useStorageWriter();
    const [_reg, setReg] = React.useContext(NOTEBOOK_REGISTRY_CTX)!;
    return React.useCallback((state: NotebookStateWithoutId) => {
        // Use the sessionId from the state (1:1 mapping with connection)
        const sessionId = state.sessionId;
        const notebook: NotebookState = { ...state };

        // Modify the registry
        setReg((reg) => {
            if (notebook.notebookMetadata.originalFileName == "") {
                notebook.notebookMetadata.originalFileName = `${notebook.connectorInfo.names.fileShort}`;
            }

            // 1:1 mapping: sessionId -> sessionId
            reg.notebooksByConnection.set(sessionId, sessionId);
            reg.notebooksByConnectionType[state.connectorInfo.connectorType].push(sessionId);
            reg.notebookMap.set(sessionId, notebook);
            return { ...reg };
        });

        storage.write(groupNotebookWrites(notebook.sessionId), {
            type: REPLACE_NOTEBOOK,
            value: notebook
        }, DEBOUNCE_DURATION_NOTEBOOK_WRITE);
        return [sessionId, notebook];
    }, [setReg, storage]);
}

/// Remove a notebook from all three registry indices.
///
/// Pure and idempotent (a missing entry is a no-op), so it is safe to run inside a React state
/// updater that may be invoked more than once. It touches no Wasm — freeing the notebook's Wasm is
/// the caller's responsibility and must happen separately (see useNotebookDeletion), because that
/// teardown is order-sensitive against the shared connection catalog.
export function removeNotebookFromRegistry(reg: NotebookRegistry, sessionId: string): NotebookRegistry {
    const entry = reg.notebookMap.get(sessionId);
    if (!entry) return reg;
    reg.notebookMap.delete(sessionId);
    // 1:1 mapping: sessionId -> sessionId
    reg.notebooksByConnection.delete(sessionId);
    const connectorType = entry.connectorInfo.connectorType;
    reg.notebooksByConnectionType[connectorType] =
        reg.notebooksByConnectionType[connectorType].filter(sid => sid !== sessionId);
    return { ...reg };
}

/// Delete the notebook backing a session and free its Wasm.
///
/// A notebook shares the connection's catalog by reference (see notebook_setup) but exclusively
/// owns its script registry and every script in it. destroyState() drops those scripts from the
/// shared catalog and then frees them — so it MUST run while that catalog is still alive, i.e.
/// *before* the connection is deleted (DELETE_CONNECTION destroys the catalog). We therefore tear
/// the Wasm down synchronously here, in the event handler, and keep the registry-map removal a
/// pure updater (safe to run more than once). Callers must invoke this before dispatching
/// DELETE_CONNECTION for the same session.
export function useNotebookDeletion(): (sessionId: string) => void {
    const [reg, setReg] = React.useContext(NOTEBOOK_REGISTRY_CTX)!;
    return React.useCallback((sessionId: string) => {
        // Free the notebook-owned Wasm now, before the shared catalog can be destroyed. The
        // registry closure is recreated on every change, so this read is current at call time.
        const notebook = reg.notebookMap.get(sessionId);
        if (notebook) {
            destroyState(notebook);
        }
        // Drop the entry from all three indices.
        setReg((prev) => removeNotebookFromRegistry(prev, sessionId));
    }, [reg, setReg]);
}

export function useNotebookState(id: string | null): [NotebookState | null, ModifyNotebook] {
    const [registry, setRegistry] = React.useContext(NOTEBOOK_REGISTRY_CTX)!;
    const [connReg] = useConnectionRegistry();
    const storageWriter = useStorageWriter();
    const logger = useLogger();

    // Queue for batching rapid dispatch calls to avoid concurrent rendering issues
    const pendingActionsRef = React.useRef<NotebookStateAction[]>([]);
    const flushScheduledRef = React.useRef(false);

    // Flush all pending actions in a single state update
    const flushPendingActions = React.useCallback(() => {
        flushScheduledRef.current = false;
        const actions = pendingActionsRef.current;
        if (actions.length === 0 || id == null) return;
        pendingActionsRef.current = [];

        setRegistry((reg: NotebookRegistry) => {
            // Check if the connection is active to gate storage writes
            const active = connReg.connectionMap.get(id)?.active ?? false;
            for (const action of actions) {
                const prev = reg.notebookMap.get(id);
                if (!prev) {
                    console.warn(`no notebook registered with session id ${id}`);
                    continue;
                }
                const next = reduceNotebookState(prev, action, storageWriter, logger, active);
                reg.notebookMap.set(id, next);
            }
            return { ...reg };
        });
    }, [id, setRegistry, storageWriter, logger, connReg]);

    /// Wrapper to modify an individual notebook
    const dispatch = React.useCallback((action: NotebookStateAction) => {
        if (id == null) return;
        // Queue the action
        pendingActionsRef.current.push(action);

        // Schedule a flush if not already scheduled
        if (!flushScheduledRef.current) {
            flushScheduledRef.current = true;
            queueMicrotask(flushPendingActions);
        }
    }, [id, flushPendingActions]);

    return [id == null ? null : registry.notebookMap.get(id) ?? null, dispatch];
};

export function useConnectionNotebookDispatch(): ModifyConnectionNotebooks {
    const [_registry, setRegistry] = React.useContext(NOTEBOOK_REGISTRY_CTX)!;
    const [connReg] = useConnectionRegistry();
    const storage = useStorageWriter();
    const logger = useLogger();

    // Queue for batching rapid dispatch calls to avoid concurrent rendering issues
    const pendingActionsRef = React.useRef<Array<{ conn: string; action: NotebookStateAction }>>([]);
    const flushScheduledRef = React.useRef(false);

    // Flush all pending actions in a single state update
    const flushPendingActions = React.useCallback(() => {
        flushScheduledRef.current = false;
        const actions = pendingActionsRef.current;
        if (actions.length === 0) return;
        pendingActionsRef.current = [];

        setRegistry((reg: NotebookRegistry) => {
            for (const { conn, action } of actions) {
                // Since 1:1 mapping, sessionId -> sessionId
                const notebookId = reg.notebooksByConnection.get(conn);
                if (notebookId) {
                    const prev = reg.notebookMap.get(notebookId);
                    if (prev) {
                        const active = connReg.connectionMap.get(conn)?.active ?? false;
                        const next = reduceNotebookState(prev, action, storage, logger, active);
                        reg.notebookMap.set(notebookId, next);
                    }
                }
            }
            return { ...reg };
        });
    }, [setRegistry, storage, logger, connReg]);

    const dispatch = React.useCallback<ModifyConnectionNotebooks>((conn: string, action: NotebookStateAction) => {
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
