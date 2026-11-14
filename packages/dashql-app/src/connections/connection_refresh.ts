import { ConnectionHealth, type ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { isCatalogRefreshRunning } from '@ankoh/dashql-runtime/connections/catalog/catalog_update_state';

export function canRefreshConnection(database: ConnectionState): boolean {
    return database.connectionHealth === ConnectionHealth.ONLINE &&
        !isCatalogRefreshRunning(database);
}
