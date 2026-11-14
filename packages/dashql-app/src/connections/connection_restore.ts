import * as buffers from '@ankoh/dashql-core/buffers';
import type { DashQL } from '@ankoh/dashql-core';
import type { Logger } from '@ankoh/dashql-sdk/platform/logger/logger';
import { stringifyError } from '@ankoh/dashql-sdk/platform/logger/logger';
import type { ConnectionState } from '@ankoh/dashql-sdk/connections/connection_state';
import { decodeConnectionFromProto, restoreConnectionState } from './connection_import.js';
import { connectionCatalogIsDurable } from '@ankoh/dashql-sdk/connections/connection_params';
import { SALESFORCE_DATA_CLOUD_CONNECTOR } from '@ankoh/dashql-sdk/connections/connector_info';
import { beginCatalogBatch, invalidateCatalogBatch, publishCatalogBatch, type BatchProcessor, type CatalogBatchEntry } from '@ankoh/dashql-sdk/connections/catalog/catalog_batch';
import type { WorkbookConnection, WorkbookRegistryBackend } from '@ankoh/dashql-sdk/storage/storage_backend';
import { STORAGE_CATALOG_CHANGES, STORAGE_CATALOG_FUNCTIONS, STORAGE_CATALOG_RELATIONS, STORAGE_CATALOG_STATE } from '@ankoh/dashql-sdk/storage/storage_backend';
import { packRelationName, parseCatalogStateFile, readRelationName } from '@ankoh/dashql-sdk/connections/catalog/catalog_sql_generator';
import { mergeRelationNames } from '@ankoh/dashql-sdk/connections/catalog/catalog_update_state';

const LOG_CTX = "connection_restore";

/// The stored params of a connection, as the app manifest or a workbook file holds them
export type StoredConnection = Pick<WorkbookConnection, 'params' | 'paramsDraft'> & {
    /// The name of the connection, the app manifest keeps it, an imported workbook brings it along
    name?: string;
    /// Does the connection cache query results? The app manifest keeps it, absent for the default of the connector.
    cacheQueryResults?: boolean;
};

/// Create the state of a connection from its stored params.
/// The connection is neither registered nor written, see `destroyUnregisteredConnection`.
export function connectionStateFromStorage(core: DashQL, connectionId: string, stored: StoredConnection): ConnectionState {
    const [connectorInfo, details] = decodeConnectionFromProto(stored.params as any, connectionId);
    const state = restoreConnectionState(core, connectionId, connectorInfo, details, stored.paramsDraft);
    return {
        ...state,
        ...(stored.name == null ? {} : { name: stored.name }),
        ...(stored.cacheQueryResults == null ? {} : { cacheQueryResults: stored.cacheQueryResults }),
    };
}

/// Destroy a connection that was created but never registered
export function destroyUnregisteredConnection(connection: ConnectionState): void {
    invalidateCatalogBatch(connection.catalog);
    connection.catalog.dropDescriptor(connection.catalogRelationEntryId);
    connection.catalog.dropDescriptor(connection.catalogFunctionScript.catalog_entry_id);
    connection.catalogFunctionScript.destroy();
    connection.catalog.destroy();
}

/// What restoring a catalog needs
export interface CatalogRestoreContext {
    /// The core instance
    core: DashQL;
    /// The logger
    logger: Logger;
    /// The processor of catalog batches, the core processes them if absent
    processor?: BatchProcessor;
}

/// The outcome of restoring the catalog of a connection from its files
export interface ConnectionCatalogRestore {
    /// False if the restoration failed, the connection refreshes its catalog on connect
    succeeded: boolean;
    /// The files to write: those whose relations or changes were dropped are cleared
    files: Array<{ fileName: string; text: string }>;
}

/// Restore the catalog of a connection from the files of the connection.
///
/// The relations of a connection whose database doesn't outlive the app describe a database that is
/// gone, they are dropped and their file is reported as stale. Such a catalog is described by a refresh
/// on connect. A restored catalog is kept until an explicit refresh.
///
/// The relations the connection didn't answer about yet are asked about again once it is online, and those it reported as
/// gone stay gone. Older versions of the app kept the changes of executed statements in a file of their own. The relations
/// of that file count as not answered, the file is cleared.
export async function restoreConnectionCatalog(
    ctx: CatalogRestoreContext,
    registry: WorkbookRegistryBackend,
    connection: ConnectionState,
    logContext: Record<string, string>,
): Promise<ConnectionCatalogRestore> {
    const { connectionId, catalog, catalogRelationEntryId, catalogFunctionScript } = connection;
    const durable = connectionCatalogIsDurable(connection.params);
    const files: Array<{ fileName: string; text: string }> = [];
    try {
        const validate = beginCatalogBatch(catalog);
        const [relations, functions, changes, state] = await Promise.all([
            registry.loadConnectionFile(connectionId, STORAGE_CATALOG_RELATIONS),
            registry.loadConnectionFile(connectionId, STORAGE_CATALOG_FUNCTIONS),
            registry.loadConnectionFile(connectionId, STORAGE_CATALOG_CHANGES),
            registry.loadConnectionFile(connectionId, STORAGE_CATALOG_STATE),
        ]);
        validate();
        // Clear the dropped relations that older versions of the app wrote
        if (!durable && relations) files.push({ fileName: STORAGE_CATALOG_RELATIONS, text: '' });

        const catalogScripts: CatalogBatchEntry[] = [];
        if (durable && relations && relations.trim().length > 0) {
            ctx.logger.info("Catalog schema loaded", { ...logContext, schemaLength: relations.length.toString() }, LOG_CTX);
            // The batch reads the file once, the catalog keeps the descriptor and not the text
            catalogScripts.push({ entryId: catalogRelationEntryId, text: relations });
        }
        if (functions && functions.trim().length > 0) {
            ctx.logger.info("Catalog functions loaded", { ...logContext, functionsLength: functions.length.toString() }, LOG_CTX);
            catalogScripts.push({ script: catalogFunctionScript, text: functions });
        }
        if (catalogScripts.length > 0) {
            await publishCatalogBatch(ctx.core, catalog, catalogScripts, { processor: ctx.processor }, validate);
            // Only restored relations make a catalog that is kept
            if (durable && relations && relations.trim().length > 0) {
                connection.catalogUpdates.described = true;
            }
        }
        const { pending, gone } = parseCatalogStateFile(state);
        if (durable && gone.length > 0) {
            catalog.replaceTables(catalogRelationEntryId, buffers.catalog.CatalogLayer.CONNECTION, { relations: gone.map(packRelationName), tables: [] });
        }
        // Nothing that runs on Salesforce changes its relations, and it has no lookup for them
        if (durable && connection.details.type !== SALESFORCE_DATA_CLOUD_CONNECTOR) {
            const changed = changes?.trim() ? ctx.core.touchedRelations(changes).map(name => readRelationName(name)) : [];
            connection.catalogUpdates.touchedRelations = mergeRelationNames(pending, changed);
        }
        // The relations of the old file move to the new one before the old one is cleared
        if (changes) {
            files.push({ fileName: STORAGE_CATALOG_STATE, text: JSON.stringify({ pending: connection.catalogUpdates.touchedRelations, gone }) });
            files.push({ fileName: STORAGE_CATALOG_CHANGES, text: '' });
        }
        return { succeeded: true, files };
    } catch (error) {
        ctx.logger.warn("Failed to restore connection catalog, will refresh on connect", {
            ...logContext,
            error: stringifyError(error),
        }, LOG_CTX);
        return { succeeded: false, files };
    }
}
