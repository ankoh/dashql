import * as React from 'react';

import { useStorageWriter } from '../storage/storage_provider.js';
import { useConnectionReferences, useConnectionDispatch, useConnectionRegistryStore } from './connection_registry.js';
import type { ConnectionParams } from '@ankoh/dashql-runtime/connections/connection_params';
import {
    ConnectionPersistenceService,
    type ConnectionPersistenceDependencies,
    type ConnectionSaveResult,
    type ConnectionSaveState,
} from '@ankoh/dashql-runtime/connections/connection_persistence_service';

// Saving connections is a service of the runtime (packages/dashql-runtime/src/connections/connection_persistence_service.ts),
// this module binds it to React
export {
    connectionSaveSucceeded,
    failedWorkbookCopies,
    type ConnectionSaveResult,
    type ConnectionSaveState,
    type WorkbookCopySaveResult,
} from '@ankoh/dashql-runtime/connections/connection_persistence_service';

/// The API to save connections
interface ConnectionPersistence {
    /// The save states of connections (connectionId -> state)
    states: Map<string, ConnectionSaveState>;
    /// Save the draft of a connection, or the given params
    save: (connectionId: string, params?: ConnectionParams) => Promise<ConnectionSaveResult>;
    /// Write the copies of workbooks again
    retry: (connectionId: string, workbookIds: string[]) => Promise<ConnectionSaveResult | null>;
}

const CONNECTION_PERSISTENCE_CTX = React.createContext<ConnectionPersistence | null>(null);

const IDLE_SAVE_STATE: ConnectionSaveState = { saving: false, result: null };

/// Saves connections, see ConnectionPersistenceService
export const ConnectionPersistenceProvider: React.FC<{ children: React.ReactElement }> = (props) => {
    const storageWriter = useStorageWriter();
    const registryStore = useConnectionRegistryStore();
    const references = useConnectionReferences();
    const dispatch = useConnectionDispatch();
    const deps = React.useMemo<ConnectionPersistenceDependencies>(() => ({
        storageWriter,
        readConnections: () => registryStore.current,
        references,
        dispatchConnection: dispatch,
    }), [storageWriter, registryStore, references, dispatch]);
    const [service] = React.useState(() => new ConnectionPersistenceService(deps));
    service.setDependencies(deps);

    const states = React.useSyncExternalStore(service.states.subscribe, service.states.get);
    // The functions change with the dependencies, like the callbacks of the former provider
    const value = React.useMemo<ConnectionPersistence>(() => ({
        states,
        save: (connectionId, params) => service.save(connectionId, params),
        retry: (connectionId, workbookIds) => service.retry(connectionId, workbookIds),
    }), [states, service, deps]);
    return (
        <CONNECTION_PERSISTENCE_CTX.Provider value={value}>
            {props.children}
        </CONNECTION_PERSISTENCE_CTX.Provider>
    );
};

/// Save a connection and observe the save state
export function useConnectionSave(connectionId: string | null) {
    const persistence = React.useContext(CONNECTION_PERSISTENCE_CTX);
    const state = (connectionId == null ? null : persistence?.states.get(connectionId)) ?? IDLE_SAVE_STATE;
    const save = React.useCallback(async (): Promise<ConnectionSaveResult | null> => {
        if (connectionId == null || persistence == null) return null;
        return await persistence.save(connectionId);
    }, [connectionId, persistence]);
    const retry = React.useCallback(async (workbookIds: string[]): Promise<ConnectionSaveResult | null> => {
        if (connectionId == null || persistence == null) return null;
        return await persistence.retry(connectionId, workbookIds);
    }, [connectionId, persistence]);
    return { ...state, save, retry };
}

/// Save the params of any connection, e.g. of a connection that is not shown
export function useConnectionSaver(): (connectionId: string, params: ConnectionParams) => Promise<ConnectionSaveResult | null> {
    const persistence = React.useContext(CONNECTION_PERSISTENCE_CTX);
    return React.useCallback(async (connectionId: string, params: ConnectionParams) => {
        return persistence == null ? null : await persistence.save(connectionId, params);
    }, [persistence]);
}

/// Save the draft of a connection before connecting with it.
/// Resolves false if the connection must not be set up because the draft could not be saved.
export function useSaveBeforeConnect(connectionId: string | null): () => Promise<boolean> {
    const persistence = React.useContext(CONNECTION_PERSISTENCE_CTX);
    const registryStore = useConnectionRegistryStore();
    return React.useCallback(async () => {
        if (connectionId == null || persistence == null) return true;
        const connection = registryStore.current.connections.get(connectionId);
        if (connection?.paramsDraft == null) return true;
        const result = await persistence.save(connectionId);
        return result.manifest.status === 'written';
    }, [connectionId, persistence, registryStore]);
}
