import * as React from 'react';

import { NotebookState, DELETE_NOTEBOOK, NotebookStateAction, reduceNotebookState } from './notebook_state.js';
import { Dispatch } from '../utils/variant.js';
import { CONNECTOR_TYPES, ConnectorType } from '../connection/connector_info.js';
import { useStorageWriter } from '../storage/storage_provider.js';
import { useLogger } from '../platform/logger_provider.js';
import { DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE, DEBOUNCE_DURATION_NOTEBOOK_WRITE, groupScriptWrites, groupNotebookWrites, WRITE_NOTEBOOK_SCRIPT, WRITE_NOTEBOOK_STATE } from '../storage/storage_writer.js';

/// The notebook registry.
///
/// Note that we're deliberately not using immutable maps for notebooks and the connection index.
/// We're never "observing" these maps directly and thus can live with the simple variants.
/// Shallow-compare the entire registry object instead when reacting to notebook list changes.
export interface NotebookRegistry {
    /// The notebook map
    notebookMap: Map<number, NotebookState>;
    /// The index to find notebooks associated with a connection id
    notebooksByConnection: Map<number, number[]>;
    /// The index to find notebooks associated with a connection type
    notebooksByConnectionType: number[][];
}

export type NotebookStateWithoutId = Omit<NotebookState, "notebookId">;
export type SetNotebookRegistryAction = React.SetStateAction<NotebookRegistry>;
export type NotebookAllocator = (notebook: NotebookStateWithoutId) => NotebookState;
export type ModifyNotebook = (action: NotebookStateAction) => void;
export type ModifyConnectionNotebooks = (conn: number, action: NotebookStateAction) => void;

const NOTEBOOK_REGISTRY_CTX = React.createContext<[NotebookRegistry, Dispatch<SetNotebookRegistryAction>] | null>(null);
let NEXT_NOTEBOOK_ID: number = 1;

export function nextWorbookIdMustBeLargerThan(wid: number) {
    NEXT_NOTEBOOK_ID = Math.max(NEXT_NOTEBOOK_ID, wid + 1);
}

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
        const notebookId = NEXT_NOTEBOOK_ID++;
        const notebook: NotebookState = {
            ...state,
            notebookId: notebookId
        };
        // Modify the registry
        setReg((reg) => {
            if (notebook.notebookMetadata.originalFileName == "") {
                notebook.notebookMetadata.originalFileName = `${notebook.connectorInfo.names.fileShort}_${notebookId}`;
            }

            const sameConnection = reg.notebooksByConnection.get(state.connectionId);
            if (sameConnection) {
                sameConnection.push(notebookId);
            } else {
                reg.notebooksByConnection.set(state.connectionId, [notebookId]);
            }
            reg.notebooksByConnectionType[state.connectorInfo.connectorType].push(notebookId);
            reg.notebookMap.set(notebookId, notebook);
            return { ...reg };
        });
        // Schedule notebook and scripts
        if (notebook.connectorInfo.connectorType != ConnectorType.DEMO) {
            for (const v of Object.values(notebook.scripts)) {
                if (v.script == null) {
                    continue;
                }
                storage.write(groupScriptWrites(notebookId, v.scriptKey), {
                    type: WRITE_NOTEBOOK_SCRIPT,
                    value: [notebookId, v.scriptKey, v]
                }, DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE);
            }
            storage.write(groupNotebookWrites(notebookId), {
                type: WRITE_NOTEBOOK_STATE,
                value: [notebookId, notebook]
            }, DEBOUNCE_DURATION_NOTEBOOK_WRITE);

        }
        return notebook;
    }, [setReg]);
}

export function useNotebookState(id: number | null): [NotebookState | null, ModifyNotebook] {
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
                    console.warn(`no notebook registered with id ${id}`);
                    continue;
                }
                const next = reduceNotebookState(prev, action, storageWriter, logger);
                if (action.type == DELETE_NOTEBOOK) {
                    reg.notebookMap.delete(id);
                    reg.notebooksByConnectionType[prev.connectorInfo.connectorType] = reg.notebooksByConnectionType[prev.connectorInfo.connectorType].filter(c => c != prev.notebookId);
                    let byConn = reg.notebooksByConnection.get(prev.connectionId) ?? [];
                    byConn = byConn.filter(c => c != prev.notebookId);
                    if (byConn.length == 0) {
                        reg.notebooksByConnection.delete(prev.connectionId);
                    } else {
                        reg.notebooksByConnection.set(prev.connectionId, byConn);
                    }
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
    const pendingActionsRef = React.useRef<Array<{ conn: number; action: NotebookStateAction }>>([]);
    const flushScheduledRef = React.useRef(false);

    // Flush all pending actions in a single state update
    const flushPendingActions = React.useCallback(() => {
        flushScheduledRef.current = false;
        const actions = pendingActionsRef.current;
        if (actions.length === 0) return;
        pendingActionsRef.current = [];

        setRegistry((reg: NotebookRegistry) => {
            for (const { conn, action } of actions) {
                const notebookIds = reg.notebooksByConnection.get(conn) ?? [];
                for (const notebookId of notebookIds) {
                    const prev = reg.notebookMap.get(notebookId);
                    if (!prev) continue;
                    const next = reduceNotebookState(prev, action, storage, logger);
                    reg.notebookMap.set(notebookId, next);
                }
            }
            return { ...reg };
        });
    }, [setRegistry, storage, logger]);

    const dispatch = React.useCallback<ModifyConnectionNotebooks>((conn: number, action: NotebookStateAction) => {
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
