import * as React from 'react';

import { useConnectionDispatch, useConnectionRegistryStore } from './connection_registry.js';
import { DELETE_CONNECTION } from './connection_state.js';
import { useHyperLogMetrics } from './hyper/hyper_log_metrics_provider.js';
import { useCancelQuery } from './query_executor.js';

/// Delete a connection
export type DeleteConnection = (connectionId: string) => Promise<void>;

/// Delete a connection with its folder.
///
/// The connection is shut down first: its running queries are cancelled, which also stops the session executions
/// that wait for them, and its log monitor closes the monitoring database in its folder. The registry refuses to
/// delete a connection that sessions still use.
export function useDeleteConnection(): DeleteConnection {
    const registryStore = useConnectionRegistryStore();
    const connectionDispatch = useConnectionDispatch();
    const cancelQuery = useCancelQuery();
    const logMetrics = useHyperLogMetrics();

    return React.useCallback(async (connectionId: string) => {
        const database = registryStore.current.connections.get(connectionId);
        if (database == null) return;
        await Promise.all(database.queriesActiveOrdered.map(queryId => cancelQuery(connectionId, queryId)));
        await logMetrics?.forget(connectionId);
        connectionDispatch(connectionId, { type: DELETE_CONNECTION, value: null });
    }, [cancelQuery, connectionDispatch, logMetrics, registryStore]);
}
