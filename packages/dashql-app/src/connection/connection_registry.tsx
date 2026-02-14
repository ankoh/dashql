import * as React from 'react';

import { ConnectionState, ConnectionStateAction, ConnectionStateWithoutId, DELETE_CONNECTION, reduceConnectionState } from './connection_state.js';
import { Dispatch } from '../utils/variant.js';
import { CONNECTOR_TYPES, ConnectorType } from './connector_info.js';
import { ConnectionSignatureMap } from './connection_signature.js';
import { useStorageWriter } from '../storage/storage_provider.js';
import { DEBOUNCE_DURATION_CONNECTION_WRITE, groupConnectionWrites, WRITE_CONNECTION_STATE } from '../storage/storage_writer.js';
import { useLogger } from '../platform/logger_provider.js';

/// The connection registry
///
/// Note that we're deliberately not using immutable maps for the connections here.
/// Following the same reasoning as with the notebook registry, we don't have code that
/// explicitly observes modifications of the registry map.
/// Instead, shallow-compare the entire registry object again.
export interface ConnectionRegistry {
    connectionMap: Map<number, ConnectionState>;
    connectionsByType: number[][];
    connectionsBySignature: ConnectionSignatureMap;
}

export type SetConnectionRegistryAction = React.SetStateAction<ConnectionRegistry>;
export type ConnectionAllocator = (state: ConnectionStateWithoutId) => ConnectionState;
export type ConnectionCloner = (state: ConnectionState) => ConnectionState;
export type ConnectionDispatch = (action: ConnectionStateAction) => void;
export type DynamicConnectionDispatch = (id: number | null, action: ConnectionStateAction) => void;

const CONNECTION_REGISTRY_CTX = React.createContext<[ConnectionRegistry, Dispatch<SetConnectionRegistryAction>] | null>(null);
let NEXT_CONNECTION_ID: number = 1;

export function nextConnectionIdMustBeLargerThan(cid: number) {
    NEXT_CONNECTION_ID = Math.max(NEXT_CONNECTION_ID, cid + 1);
}

type Props = {
    children: React.ReactElement | React.ReactElement[];
};

export const ConnectionRegistry: React.FC<Props> = (props: Props) => {
    const [reg, setReg] = React.useState<ConnectionRegistry>(() => {
        return ({
            connectionMap: new Map(),
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
    const storage = useStorageWriter();
    const [_reg, setReg] = React.useContext(CONNECTION_REGISTRY_CTX)!;
    return React.useCallback((state: ConnectionStateWithoutId) => {
        const cid = NEXT_CONNECTION_ID++;
        const conn: ConnectionState = { ...state, connectionId: cid };
        setReg((reg) => {
            reg.connectionMap.set(cid, conn);
            reg.connectionsByType[state.connectorInfo.connectorType].push(cid);
            reg.connectionsBySignature.set(state.connectionSignature.signatureString, cid);
            return { ...reg };
        });
        if (conn.connectorInfo.connectorType != ConnectorType.DEMO) {
            storage.write(groupConnectionWrites(conn.connectionId), {
                type: WRITE_CONNECTION_STATE,
                value: [conn.connectionId, conn]
            }, DEBOUNCE_DURATION_CONNECTION_WRITE);
        }
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
    const pendingActionsRef = React.useRef<Array<{ id: number; action: ConnectionStateAction }>>([]);
    const flushScheduledRef = React.useRef(false);

    // Flush all pending actions in a single state update
    const flushPendingActions = React.useCallback(() => {
        flushScheduledRef.current = false;
        const actions = pendingActionsRef.current;
        if (actions.length === 0) return;
        pendingActionsRef.current = [];

        setRegistry((reg: ConnectionRegistry) => {
            for (const { id, action } of actions) {
                const prev = reg.connectionMap.get(id);
                if (!prev) {
                    console.warn(`no connection registered with id ${id}`);
                    continue;
                }
                const connectionSignature = prev.connectionSignature.signatureString;
                const connectorType = prev.connectorInfo.connectorType;
                const next = reduceConnectionState(prev, action, storageWriter, logger);

                if (action.type == DELETE_CONNECTION) {
                    reg.connectionsBySignature.delete(connectionSignature);
                    reg.connectionsByType[connectorType] = reg.connectionsByType[connectorType].filter(cid => cid != id);
                    reg.connectionMap.delete(id);
                } else {
                    reg.connectionMap.set(id, next);
                }
            }
            return { ...reg };
        });
    }, [setRegistry, storageWriter, logger]);

    /// Helper to modify a dynamic connection
    const dispatch = React.useCallback((id: number | null, action: ConnectionStateAction) => {
        // No id provided? Then do nothing.
        if (id == null) {
            return;
        }
        // Queue the action
        pendingActionsRef.current.push({ id, action });

        // Schedule a flush if not already scheduled
        if (!flushScheduledRef.current) {
            flushScheduledRef.current = true;
            queueMicrotask(flushPendingActions);
        }
    }, [flushPendingActions]);

    return [registry, dispatch];
}

export function useConnectionState(id: number | null): [ConnectionState | null, ConnectionDispatch] {
    const [registry, dispatch] = useDynamicConnectionDispatch();
    const capturingDispatch = React.useCallback((action: ConnectionStateAction) => dispatch(id, action), [id, dispatch]);
    return [id == null ? null : (registry.connectionMap.get(id) ?? null), capturingDispatch]
}

