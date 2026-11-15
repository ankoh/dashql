import * as React from 'react';

import type { ConnectionParams } from '@ankoh/dashql-runtime/connections/connection_params';
import type {
    ConnectionPersistenceService,
    ConnectionSaveResult,
    ConnectionSaveState,
} from '@ankoh/dashql-runtime/connections/connection_persistence_service';
import { useOptionalRuntime } from '../runtime/runtime_provider.js';

// Saving connections is a service of the runtime (packages/dashql-runtime/src/connections/connection_persistence_service.ts),
// this module binds it to React
export {
    connectionSaveSucceeded,
    failedWorkbookCopies,
    type ConnectionSaveResult,
    type ConnectionSaveState,
    type WorkbookCopySaveResult,
} from '@ankoh/dashql-runtime/connections/connection_persistence_service';

const IDLE_SAVE_STATE: ConnectionSaveState = { saving: false, result: null };
const NO_SAVE_STATES = new Map<string, ConnectionSaveState>();
const subscribeNothing = () => () => { };

/// The service that saves connections, null outside of the runtime
function usePersistence(): ConnectionPersistenceService | null {
    return useOptionalRuntime()?.persistence ?? null;
}

/// Save a connection and observe the save state
export function useConnectionSave(connectionId: string | null) {
    const persistence = usePersistence();
    const states = React.useSyncExternalStore(persistence?.states.subscribe ?? subscribeNothing, persistence?.states.get ?? (() => NO_SAVE_STATES));
    const state = (connectionId == null ? null : states.get(connectionId)) ?? IDLE_SAVE_STATE;
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
    const persistence = usePersistence();
    return React.useCallback(async (connectionId: string, params: ConnectionParams) => {
        return persistence == null ? null : await persistence.save(connectionId, params);
    }, [persistence]);
}

/// Save the draft of a connection before connecting with it.
/// Resolves false if the connection must not be set up because the draft could not be saved.
export function useSaveBeforeConnect(connectionId: string | null): () => Promise<boolean> {
    const runtime = useOptionalRuntime();
    return React.useCallback(async () => {
        if (connectionId == null || runtime == null) return true;
        const connection = runtime.connections.store.current.connections.get(connectionId);
        if (connection?.paramsDraft == null) return true;
        const result = await runtime.persistence.save(connectionId);
        return result.manifest.status === 'written';
    }, [connectionId, runtime]);
}
