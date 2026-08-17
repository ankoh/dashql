import * as React from 'react';

import { ConnectionState, ConnectionStateAction, ConnectionStateWithoutId, DELETE_CONNECTION, SWITCH_CONNECTOR_TYPE, reduceConnectionState } from './connection_state.js';
import { Dispatch } from '../../../shared/utils/variant.js';
import { CONNECTOR_TYPES } from './connector_info.js';
import { ConnectionSignatureMap } from './connection_signature.js';
import { useStorageWriter } from '../persistence/storage_provider.js';
import { useLogger } from '../../../shared/platform/logger/logger_provider.js';

// Note: Storage persistence handled by connection reducer when setupParams are configured

/// The connection registry
///
/// Note that we're deliberately not using immutable maps for the connections here.
/// Following the same reasoning as with the notebook registry, we don't have code that
/// explicitly observes modifications of the registry map.
/// Instead, shallow-compare the entire registry object again.
export interface ConnectionRegistry {
    connectionMap: Map<string, ConnectionState>;  // connectionId -> ConnectionState
    connectionByNotebook: Map<string, string>;  // notebookId -> connectionId
    connectionsByType: string[][];  // arrays of connectionIds by connector type
    connectionsBySignature: ConnectionSignatureMap;
}

export type SetConnectionRegistryAction = React.SetStateAction<ConnectionRegistry>;
export type ConnectionAllocator = (state: ConnectionStateWithoutId) => ConnectionState;
export type ConnectionCloner = (state: ConnectionState) => ConnectionState;
export type ConnectionDispatch = (action: ConnectionStateAction) => void;
export type DynamicConnectionDispatch = (connectionId: string | null, action: ConnectionStateAction) => void;

const CONNECTION_REGISTRY_CTX = React.createContext<[ConnectionRegistry, Dispatch<SetConnectionRegistryAction>] | null>(null);

type Props = {
    children: React.ReactElement | React.ReactElement[];
};

export const ConnectionRegistry: React.FC<Props> = (props: Props) => {
    const [reg, setReg] = React.useState<ConnectionRegistry>(() => {
        return ({
            connectionMap: new Map(),
            connectionByNotebook: new Map(),
            connectionsByType: CONNECTOR_TYPES.map(() => ([])),
            connectionsBySignature: new Map(),
        });
    });
    return (
        <CONNECTION_REGISTRY_CTX.Provider value={[reg, setReg]}>
            {props.children}
        </CONNECTION_REGISTRY_CTX.Provider>
    );
};

export function useConnectionStateAllocator(): ConnectionAllocator {
    const [_reg, setReg] = React.useContext(CONNECTION_REGISTRY_CTX)!;
    return React.useCallback((state: ConnectionStateWithoutId) => {
        // The notebook UUID is the authoritative identity. New notebooks are implicitly OPFS-backed;
        // their physical location is recorded in the manifest when first persisted.
        const notebookId = crypto.randomUUID();
        const connectionId = crypto.randomUUID();
        const conn: ConnectionState = { ...state, connectionId, notebookId };
        setReg((reg) => {
            reg.connectionMap.set(connectionId, conn);
            reg.connectionByNotebook.set(notebookId, connectionId);
            reg.connectionsByType[state.connectorInfo.connectorType].push(connectionId);
            reg.connectionsBySignature.set(state.connectionSignature.signatureString, connectionId);
            return { ...reg };
        });
        // Don't persist yet - wait until connection is configured
        // Persistence happens in connection reducer when CHANNEL_READY/HEALTH_CHECK_SUCCEEDED
        return conn;
    }, [setReg]);
}

export function useConnectionRegistry(): [ConnectionRegistry, Dispatch<SetConnectionRegistryAction>] {
    return React.useContext(CONNECTION_REGISTRY_CTX)!;
}

export function useDynamicConnectionDispatch(): [ConnectionRegistry, DynamicConnectionDispatch] {
    const [registry, setRegistry] = React.useContext(CONNECTION_REGISTRY_CTX)!;
    const storageWriter = useStorageWriter();
    const logger = useLogger();

    // Queue for batching dispatch calls to avoid concurrent rendering issues
    const pendingActionsRef = React.useRef<Array<{ connectionId: string; action: ConnectionStateAction }>>([]);
    const flushScheduledRef = React.useRef(false);

    // Flush all pending actions in a single state update
    const flushPendingActions = React.useCallback(() => {
        flushScheduledRef.current = false;
        const actions = pendingActionsRef.current;
        if (actions.length === 0) return;
        pendingActionsRef.current = [];

        setRegistry((reg: ConnectionRegistry) => {
            for (const { connectionId, action } of actions) {
                const prev = reg.connectionMap.get(connectionId);
                if (!prev) {
                    console.warn(`no connection registered with id ${connectionId}`);
                    continue;
                }
                const connectionSignature = prev.connectionSignature.signatureString;
                const connectorType = prev.connectorInfo.connectorType;
                const next = reduceConnectionState(prev, action, storageWriter, logger);

                if (action.type == DELETE_CONNECTION) {
                    reg.connectionsBySignature.delete(connectionSignature);
                    reg.connectionsByType[connectorType] = reg.connectionsByType[connectorType].filter(id => id != connectionId);
                    reg.connectionByNotebook.delete(prev.notebookId);
                    reg.connectionMap.delete(connectionId);
                } else {
                    reg.connectionMap.set(connectionId, next);
                    // Update type index when connector type changes
                    if (action.type == SWITCH_CONNECTOR_TYPE && next.connectorInfo.connectorType !== connectorType) {
                        reg.connectionsByType[connectorType] = reg.connectionsByType[connectorType].filter(id => id != connectionId);
                        reg.connectionsByType[next.connectorInfo.connectorType].push(connectionId);
                        // Update signature
                        reg.connectionsBySignature.delete(connectionSignature);
                        reg.connectionsBySignature.set(next.connectionSignature.signatureString, connectionId);
                    }
                }
            }
            return { ...reg };
        });
    }, [setRegistry, storageWriter, logger]);

    /// Helper to modify a dynamic connection
    const dispatch = React.useCallback((connectionId: string | null, action: ConnectionStateAction) => {
        // No id provided? Then do nothing.
        if (connectionId == null) {
            return;
        }
        // Queue the action
        pendingActionsRef.current.push({ connectionId, action });

        // Schedule a flush if not already scheduled
        if (!flushScheduledRef.current) {
            flushScheduledRef.current = true;
            queueMicrotask(flushPendingActions);
        }
    }, [flushPendingActions]);

    return [registry, dispatch];
}

export function useConnectionState(notebookId: string | null): [ConnectionState | null, ConnectionDispatch] {
    const [registry, dispatch] = useDynamicConnectionDispatch();
    const connectionId = notebookId == null ? null : registry.connectionByNotebook.get(notebookId) ?? null;
    const capturingDispatch = React.useCallback((action: ConnectionStateAction) => dispatch(connectionId, action), [connectionId, dispatch]);
    return [connectionId == null ? null : (registry.connectionMap.get(connectionId) ?? null), capturingDispatch]
}
