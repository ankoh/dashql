import type { ConnectionState } from '../connection_state.js';
import type { RelationName } from './catalog_sql_generator.js';

export enum CatalogUpdateVariant {
    FULL_CATALOG_REFRESH,
    /// Ask the connection about the relations that executed statements touched
    RELATION_REFRESH,
}

export enum CatalogUpdateTaskStatus {
    STARTED = 0,
    SUCCEEDED = 1,
    FAILED = 2,
    CANCELLED = 3,
    PARTIALLY_SUCCEEDED = 4,
}

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

/// Merge relation names, every relation once
export function mergeRelationNames(into: RelationName[], names: RelationName[]): RelationName[] {
    const out = [...into];
    for (const name of names) {
        if (!out.some(r => r.databaseName === name.databaseName && r.schemaName === name.schemaName && r.tableName === name.tableName)) out.push(name);
    }
    return out;
}

/// The relations that nothing has answered about yet, also those of a running update
export function pendingRelations(connection: ConnectionState): RelationName[] {
    let pending = connection.catalogUpdates.touchedRelations;
    for (const task of connection.catalogUpdates.tasksRunning.values()) {
        pending = mergeRelationNames(pending, task.touchedRelations ?? []);
    }
    return pending;
}

export function isCatalogRefreshRunning(connection: ConnectionState | null): boolean {
    if (connection == null) return false;
    const refreshId = connection.catalogUpdates.currentFullRefresh;
    return refreshId != null && connection.catalogUpdates.tasksRunning.has(refreshId);
}
