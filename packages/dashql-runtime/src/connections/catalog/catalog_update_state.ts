import { CatalogUpdateTaskStatus, CatalogUpdateVariant } from '@ankoh/dashql-core';
import type { ConnectionState } from '../connection_state.js';
import type { RelationName } from './catalog_sql_generator.js';

/// What a catalog update does and how far it got, numeric enums of the module
export { CatalogUpdateTaskStatus, CatalogUpdateVariant };

export interface CatalogUpdateTaskState {
    /// The task key
    taskId: number;
    /// The catalog update variant
    taskVariant: CatalogUpdateVariant;
    /// The status
    status: CatalogUpdateTaskStatus;
    /// The cancellation signal
    cancellation: AbortController;
    /// The queries
    queries: number[];
    /// The loading error (if any)
    error: Error | null;
    /// The time at which the loading started (if any)
    startedAt: Date | null;
    /// The time at which the loading finishe (if any)
    finishedAt: Date | null;
    /// The relations of executed statements that the task answers
    touchedRelations?: RelationName[];
}

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
