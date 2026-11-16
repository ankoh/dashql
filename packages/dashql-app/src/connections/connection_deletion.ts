import * as React from 'react';

import type { Runtime } from '@ankoh/dashql-runtime/runtime';
import type { ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { ConnectorType } from '@ankoh/dashql-runtime/connections/connector_info';
import { embeddedCloudDatabases } from '@ankoh/dashql-runtime/connections/hyper/local_cloud';
import type { HyperDatabaseChannel } from '@ankoh/dashql-runtime/connections/hyper/hyperdb_grpc_client';
import { useOptionalRuntime } from '../runtime/runtime_hooks.js';
import { useHyperLogMetrics } from './hyper/hyper_log_metrics_provider.js';
import { dropsAttachedDatabases } from '@ankoh/dashql-runtime/platform/database/embedded_database';
import { useEmbeddedDatabaseSetup } from '../platform/database/embedded_database_provider.js';
import { embeddedAttachedDatabasePath } from '@ankoh/dashql-runtime/platform/hyperdb/hyperdb_opfs_instance';
import { useLogger } from '../platform/logger/logger_provider.js';
import { stringifyError, type Logger } from '@ankoh/dashql-runtime/platform/logger/logger';

/// Delete a connection
export type DeleteConnection = (connectionId: string) => Promise<void>;

/// The connections of the last flush of a runtime by id
function connectionsOf(runtime: Runtime | null): ReadonlyMap<string, ConnectionState> {
    return (runtime?.store.all('connection') ?? new Map()) as ReadonlyMap<string, ConnectionState>;
}

/// Delete a connection with its folder.
///
/// The connection is shut down first: its running queries are cancelled, which also stops the workbook executions
/// that wait for them, and its log monitor closes the monitoring database in its folder. The registry refuses to
/// delete a connection that workbooks still use. A connection of the embedded Hyper that attaches databases of the
/// clouds folder, a local cloud, takes them along once its session is closed, unless another connection attaches them.
export function useDeleteConnection(): DeleteConnection {
    const logMetrics = useHyperLogMetrics();
    const setupEmbeddedDatabase = useEmbeddedDatabaseSetup();
    const logger = useLogger();
    const runtime = useOptionalRuntime();

    return React.useCallback(async (connectionId: string) => {
        if (runtime == null) throw new Error('the connections need a RuntimeProvider');
        const database = connectionsOf(runtime).get(connectionId);
        if (database == null) return;
        await Promise.all(database.queriesActiveOrdered.map(queryId => runtime.cancel(queryId)));
        await logMetrics?.forget(connectionId);
        const hyper = database.connectorType === ConnectorType.HYPER ? { channel: runtime.channel<HyperDatabaseChannel>(database) } : null;
        // The runtime refuses to delete a connection that workbooks use, its databases stay then
        const deleted = (runtime.store.get('connection', connectionId)?.workbooks ?? []).length === 0;
        const attached = hyper == null || !deleted ? [] : embeddedCloudDatabases(database.params != null && 'hyper' in database.params ? database.params.hyper : null);
        // The session detaches the databases when it closes, the deletion closes it without waiting
        if (attached.length > 0) await hyper?.channel?.close().catch(() => {});
        runtime.dispatch({ connection: connectionId }, { kind: 'deleteConnection' });
        if (attached.length === 0 || setupEmbeddedDatabase == null) return;

        const others = [...connectionsOf(runtime).values()].filter(other => other.connectionId !== connectionId);
        const attachedElsewhere = new Set(others.flatMap(other => embeddedCloudDatabases(other.params != null && 'hyper' in other.params ? other.params.hyper : null)
            .map(database => database.path)));
        await dropCloudDatabases(await setupEmbeddedDatabase('hyper_wasm_connector'), attached.map(database => database.path).filter(path => !attachedElsewhere.has(path)), logger);
    }, [logMetrics, logger, runtime, setupEmbeddedDatabase]);
}

/// Drop databases of the clouds folder through the embedded Hyper, the sessions that attach them must be closed
async function dropCloudDatabases(embedded: object, paths: readonly string[], logger: Logger): Promise<void> {
    if (!dropsAttachedDatabases(embedded)) return;
    for (const path of paths) {
        try {
            await embedded.dropAttachedDatabase(await embeddedAttachedDatabasePath(path));
            logger.info('Dropped a database of the clouds folder', { path }, 'connection_deletion');
        } catch (error) {
            logger.warn('Dropping a database of the clouds folder failed', { path, error: stringifyError(error) }, 'connection_deletion');
        }
    }
}

/// Drop the databases of all local clouds before all data is cleared: close the sessions that attach them, then drop
/// them, the engine holds their files open until then.
export function useDropAllCloudDatabases(): () => Promise<void> {
    const setupEmbeddedDatabase = useEmbeddedDatabaseSetup();
    const logger = useLogger();
    const runtime = useOptionalRuntime();
    return React.useCallback(async () => {
        const paths = new Set<string>();
        // Outside the runtime, e.g. in a test of the settings, there are none
        for (const connection of connectionsOf(runtime).values()) {
            const attached = embeddedCloudDatabases(connection.params != null && 'hyper' in connection.params ? connection.params.hyper : null);
            if (attached.length === 0) continue;
            const channel = connection.connectorType === ConnectorType.HYPER ? runtime?.channel<HyperDatabaseChannel>(connection) ?? null : null;
            await channel?.close().catch(() => {});
            for (const { path } of attached) paths.add(path);
        }
        if (paths.size === 0 || setupEmbeddedDatabase == null) return;
        await dropCloudDatabases(await setupEmbeddedDatabase('hyper_wasm_connector'), [...paths], logger);
    }, [logger, runtime, setupEmbeddedDatabase]);
}
