import * as React from 'react';

import { ConnectionState, ConnectionStateAction, ConnectionStateWithoutId, reduceConnectionState } from './connection_state.js';
import { Dispatch } from '../utils/variant.js';
import { CONNECTOR_TYPES } from './connector_info.js';
import { ConnectionSignatureMap } from './connection_signature.js';
import { useStorageWriter } from '../platform/storage_provider.js';

/// The connection registry
///
/// Note that we're deliberately not using immutable maps for the connections here.
/// Following the same reasoning as with the workbook registry, we don't have code that
/// explicitly observes modifications of the registry map.
/// Instead, shallow-compare the entire registry object again.
export interface ConnectionRegistry {
    connectionMap: Map<number, ConnectionState>;
    connectionsByType: Set<number>[];
    connectionsBySignature: ConnectionSignatureMap;
}

type SetConnectionRegistryAction = React.SetStateAction<ConnectionRegistry>;
export type ConnectionAllocator = (state: ConnectionStateWithoutId) => ConnectionState;
export type ConnectionCloner = (state: ConnectionState) => ConnectionState;
export type ConnectionDispatch = (action: ConnectionStateAction) => void;
export type DynamicConnectionDispatch = (id: number | null, action: ConnectionStateAction) => void;

const CONNECTION_REGISTRY_CTX = React.createContext<[ConnectionRegistry, Dispatch<SetConnectionRegistryAction>] | null>(null);
let NEXT_CONNECTION_ID: number = 1;

type Props = {
    children: React.ReactElement | React.ReactElement[];
};

export const ConnectionRegistry: React.FC<Props> = (props: Props) => {
    const [reg, setReg] = React.useState<ConnectionRegistry>(() => {
        return ({
            connectionMap: new Map(),
            connectionsByType: CONNECTOR_TYPES.map(() => new Set()),
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
        const cid = NEXT_CONNECTION_ID++;
        const conn: ConnectionState = { ...state, connectionId: cid };
        setReg((reg) => {
            reg.connectionMap.set(cid, conn);
            reg.connectionsByType[state.connectorInfo.connectorType].add(cid);
            reg.connectionsBySignature.set(state.connectionSignature.signatureString, cid);
            return { ...reg };
        });
        return conn;
    }, [setReg]);
}

export function useConnectionRegistry(): [ConnectionRegistry, Dispatch<SetConnectionRegistryAction>] {
    return React.useContext(CONNECTION_REGISTRY_CTX)!;
}

export function useDynamicConnectionDispatch(): [ConnectionRegistry, DynamicConnectionDispatch] {
    const [registry, setRegistry] = React.useContext(CONNECTION_REGISTRY_CTX)!;
    const storageWriter = useStorageWriter();

    /// Helper to modify a dynamic connection
    const dispatch = React.useCallback((id: number | null, action: ConnectionStateAction) => {
        // No id provided? Then do nothing.
        if (id == null) {
            return;
        }
        setRegistry(
            (reg: ConnectionRegistry) => {
                // Find the previous workbook state
                const prev = reg.connectionMap.get(id);
                // Ignore if the workbook does not exist
                if (!prev) {
                    console.warn(`no workbook registered with id ${id}`);
                    return reg;
                }
                // Reduce the workbook action
                const next = reduceConnectionState(prev, action, storageWriter);
                reg.connectionMap.set(id, next);
                return { ...reg };
            }
        );
    }, [setRegistry]);

    return [registry, dispatch];
}

export function useConnectionState(id: number | null): [ConnectionState | null, ConnectionDispatch] {
    const [registry, dispatch] = useDynamicConnectionDispatch();
    const capturingDispatch = React.useCallback((action: ConnectionStateAction) => dispatch(id, action), [id, dispatch]);
    return [id == null ? null : (registry.connectionMap.get(id) ?? null), capturingDispatch]
}

