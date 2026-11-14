import {
    CATALOG_UPDATE_CANCELLED,
    CATALOG_UPDATE_FAILED,
    CATALOG_UPDATE_REGISTER_QUERY,
    CATALOG_UPDATE_PARTIALLY_SUCCEEDED,
    CATALOG_UPDATE_SUCCEEDED,
    CatalogAction,
    ConnectionState,
    RELATIONS_TOUCHED,
    UPDATE_CATALOG,
} from '../connection_state.js';
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
export const CATALOG_UPDATE_TASK_STATUS_NAMES: string[] = [
    "Started",
    "Succeeded",
    "Failed",
    "Cancelled",
    "Partially Succeeded",
];

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

/// What a task that didn't answer gives back
function returnTouched(state: ConnectionState, update: CatalogUpdateTaskState, failed: boolean) {
    const touched = (update.touchedRelations?.length ?? 0) > 0;
    return {
        touchedRelations: mergeRelationNames(state.catalogUpdates.touchedRelations, update.touchedRelations ?? []),
        touchedFailures: state.catalogUpdates.touchedFailures + (failed && touched ? 1 : 0),
    };
}

export function isCatalogRefreshRunning(connection: ConnectionState | null): boolean {
    if (connection == null) return false;
    const refreshId = connection.catalogUpdates.currentFullRefresh;
    return refreshId != null && connection.catalogUpdates.tasksRunning.has(refreshId);
}

export function reduceCatalogAction(state: ConnectionState, action: CatalogAction): ConnectionState {
    if (action.type === RELATIONS_TOUCHED) {
        return state;
    }
    if (action.type == UPDATE_CATALOG) {
        const [updateId, update] = action.value;
        state.catalogUpdates.tasksRunning.set(updateId, update);
        return {
            ...state,
            catalogUpdates: {
                ...state.catalogUpdates,
                currentFullRefresh: update.taskVariant == CatalogUpdateVariant.FULL_CATALOG_REFRESH
                    ? updateId
                    : state.catalogUpdates.currentFullRefresh,
                // An update takes the relations it answers. A statement may have touched others meanwhile, and a full
                // refresh leaves them all: only the answer about a relation can say that it is gone.
                touchedRelations: state.catalogUpdates.touchedRelations.filter(relation => !(update.touchedRelations ?? []).includes(relation)),
            },
        };
    }

    const updateId = action.value[0];
    const update = state.catalogUpdates.tasksRunning.get(updateId);
    if (!update) {
        return state;
    }
    if (action.type === CATALOG_UPDATE_REGISTER_QUERY) {
        state.catalogUpdates.tasksRunning.set(updateId, { ...update, queries: [...update.queries, action.value[1]] });
        return { ...state, catalogUpdates: { ...state.catalogUpdates } };
    }

    // The update is done
    const statusOf = {
        [CATALOG_UPDATE_CANCELLED]: CatalogUpdateTaskStatus.CANCELLED,
        [CATALOG_UPDATE_FAILED]: CatalogUpdateTaskStatus.FAILED,
        [CATALOG_UPDATE_SUCCEEDED]: CatalogUpdateTaskStatus.SUCCEEDED,
        [CATALOG_UPDATE_PARTIALLY_SUCCEEDED]: CatalogUpdateTaskStatus.PARTIALLY_SUCCEEDED,
    };
    const succeeded = action.type === CATALOG_UPDATE_SUCCEEDED;
    state.catalogUpdates.tasksRunning.delete(updateId);
    state.catalogUpdates.tasksFinished.set(updateId, {
        ...update,
        status: statusOf[action.type],
        error: succeeded ? null : action.value[1],
        finishedAt: new Date(),
    });
    return {
        ...state,
        catalogUpdates: {
            ...state.catalogUpdates,
            described: state.catalogUpdates.described || (succeeded && update.taskVariant === CatalogUpdateVariant.FULL_CATALOG_REFRESH),
            // A cancelled update was superseded or its connection stopped, that is no failure of the connection. A database
            // that failed in a partial update didn't answer about its relations.
            ...(succeeded ? { touchedFailures: 0 } : returnTouched(state, update, action.type !== CATALOG_UPDATE_CANCELLED)),
        },
    };
}
