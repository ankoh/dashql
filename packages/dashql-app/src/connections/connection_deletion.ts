import * as React from 'react';

import { useConnectionDispatch, useConnectionReferences, useConnectionRegistryStore } from './connection_registry.js';
import { DELETE_CONNECTION } from './connection_state.js';
import { HYPER_CONNECTOR } from './connector_info.js';
import { embeddedCloudDatabases } from './hyper/local_cloud.js';
import type { HyperConnectionDetails } from './hyper/hyper_connection_state.js';
import { useHyperLogMetrics } from './hyper/hyper_log_metrics_provider.js';
import { useCancelQuery } from './query_executor.js';
import { dropsAttachedDatabases } from '../platform/database/embedded_database.js';
import { useEmbeddedDatabaseSetup } from '../platform/database/embedded_database_provider.js';
import { embeddedAttachedDatabasePath } from '../platform/hyperdb/hyperdb_opfs_instance.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { stringifyError } from '../platform/logger/logger.js';

/// Delete a connection
export type DeleteConnection = (connectionId: string) => Promise<void>;

/// Delete a connection with its folder.
///
/// The connection is shut down first: its running queries are cancelled, which also stops the workbook executions
/// that wait for them, and its log monitor closes the monitoring database in its folder. The registry refuses to
/// delete a connection that workbooks still use. A connection of the embedded Hyper that attaches databases of the
/// clouds folder, a local cloud, takes them along once its session is closed, unless another connection attaches them.
export function useDeleteConnection(): DeleteConnection {
    const registryStore = useConnectionRegistryStore();
    const connectionDispatch = useConnectionDispatch();
    const cancelQuery = useCancelQuery();
    const logMetrics = useHyperLogMetrics();
    const setupEmbeddedDatabase = useEmbeddedDatabaseSetup();
    const logger = useLogger();
    const references = useConnectionReferences();

    return React.useCallback(async (connectionId: string) => {
        const database = registryStore.current.connections.get(connectionId);
        if (database == null) return;
        await Promise.all(database.queriesActiveOrdered.map(queryId => cancelQuery(connectionId, queryId)));
        await logMetrics?.forget(connectionId);
        const hyper = database.details.type === HYPER_CONNECTOR ? database.details.value as HyperConnectionDetails : null;
        // The registry refuses to delete a connection that workbooks reference, its databases stay then
        const deleted = references.workbooksOf(connectionId).length === 0;
        const attached = hyper == null || !deleted ? [] : embeddedCloudDatabases(database.params != null && 'hyper' in database.params ? database.params.hyper : null);
        // The session detaches the databases when it closes, the deletion closes it without waiting
        if (attached.length > 0) await hyper?.channel?.close().catch(() => {});
        connectionDispatch(connectionId, { type: DELETE_CONNECTION, value: null });
        if (attached.length === 0 || setupEmbeddedDatabase == null) return;

        const others = [...registryStore.current.connections.values()].filter(other => other.connectionId !== connectionId);
        const attachedElsewhere = new Set(others.flatMap(other => embeddedCloudDatabases(other.params != null && 'hyper' in other.params ? other.params.hyper : null)
            .map(database => database.path)));
        const embedded = await setupEmbeddedDatabase('hyper_wasm_connector');
        if (!dropsAttachedDatabases(embedded)) return;
        for (const { path } of attached) {
            if (attachedElsewhere.has(path)) continue;
            try {
                await embedded.dropAttachedDatabase(await embeddedAttachedDatabasePath(path));
                logger.info('Dropped the database of a deleted connection', { connectionId, path }, 'connection_deletion');
            } catch (error) {
                logger.warn('Dropping the database of a deleted connection failed', { connectionId, path, error: stringifyError(error) }, 'connection_deletion');
            }
        }
    }, [cancelQuery, connectionDispatch, logMetrics, logger, references, registryStore, setupEmbeddedDatabase]);
}
