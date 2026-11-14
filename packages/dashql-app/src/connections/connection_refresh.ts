import { ConnectionHealth, type ConnectionState } from '@ankoh/dashql-sdk/connections/connection_state';
import { isCatalogRefreshRunning } from '@ankoh/dashql-sdk/connections/catalog/catalog_update_state';

export function canRefreshConnection(database: ConnectionState): boolean {
    return database.connectionHealth === ConnectionHealth.ONLINE &&
        !isCatalogRefreshRunning(database);
}
