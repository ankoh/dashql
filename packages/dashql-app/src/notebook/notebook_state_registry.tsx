import * as React from 'react';

import { NotebookState, NotebookStateAction, reduceNotebookState } from './notebook_state.js';
import { Dispatch } from '../utils/variant.js';
import { CONNECTOR_TYPES, ConnectorType } from '../connection/connector_info.js';
import { useStorageWriter } from '../platform/storage/storage_provider.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { DEBOUNCE_DURATION_NOTEBOOK_WRITE, DELETE_NOTEBOOK, groupNotebookWrites, WRITE_NOTEBOOK } from "../platform/storage/storage_writer.js";

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

        // Write the notebook to storage (skip ephemeral notebooks)
        if (notebook.connectorInfo.connectorType !== ConnectorType.DEMO) {
            storage.write(groupNotebookWrites(notebook.sessionId), {
                type: WRITE_NOTEBOOK,
                value: notebook
            }, DEBOUNCE_DURATION_NOTEBOOK_WRITE);
        }
        return [sessionId, notebook];
    }, [setReg, storage]);
}

export function useNotebookState(id: string | null): [NotebookState | null, ModifyNotebook] {
    const [registry, setRegistry] = React.useContext(NOTEBOOK_REGISTRY_CTX)!;
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
            for (const action of actions) {
                const prev = reg.notebookMap.get(id);
                if (!prev) {
                    console.warn(`no notebook registered with session id ${id}`);
                    continue;
                }
                const next = reduceNotebookState(prev, action, storageWriter, logger);
                // @ts-ignore - DELETE_NOTEBOOK is a storage task, not a state action, but we check for it here
                if ((action as any).type == DELETE_NOTEBOOK) {
                    reg.notebookMap.delete(id);
                    reg.notebooksByConnectionType[prev.connectorInfo.connectorType] = reg.notebooksByConnectionType[prev.connectorInfo.connectorType].filter(c => c != id);
                    // Since 1:1 mapping, just delete the sessionId entry
                    reg.notebooksByConnection.delete(id);
                } else {
                    reg.notebookMap.set(id, next);
                }
            }
            return { ...reg };
        });
    }, [id, setRegistry, storageWriter, logger]);

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
                        const next = reduceNotebookState(prev, action, storage, logger);
                        reg.notebookMap.set(notebookId, next);
                    }
                }
            }
            return { ...reg };
        });
    }, [setRegistry, storage, logger]);

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
