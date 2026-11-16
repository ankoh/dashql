import { CatalogUpdateTaskStatus, CatalogUpdateVariant } from '../../../core/index.js';
import type { ConnectionState } from '../connection_state.js';

/// What a catalog update does and how far it got, numeric enums of the module
export { CatalogUpdateTaskStatus, CatalogUpdateVariant };

/// The attempts to answer the relations of executed statements before the catalog counts as out of date
export const MAX_TOUCHED_ATTEMPTS = 3;

/// Might the catalog miss what executed statements did, since asking the connection failed?
export function isCatalogOutOfDate(connection: ConnectionState): boolean {
    return connection.catalogUpdates.touchedFailures >= MAX_TOUCHED_ATTEMPTS;
}

export function isCatalogRefreshRunning(connection: ConnectionState | null): boolean {
    if (connection == null) return false;
    const refreshId = connection.catalogUpdates.currentFullRefresh;
    return refreshId != null && connection.catalogUpdates.tasksRunning.some(task => task.taskId === refreshId);
}
