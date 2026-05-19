import {
    DEBOUNCE_DURATION_SESSION_WRITE,
    groupSessionSchemaWrites,
    groupSessionFunctionWrites,
    StorageWriter,
    WRITE_SESSION_CATALOG_SCRIPT,
    WRITE_SESSION_FUNCTION_SCRIPT,
} from '../platform/storage/storage_writer.js';
import {
    CATALOG_UPDATE_CANCELLED,
    CATALOG_UPDATE_FAILED,
    CATALOG_UPDATE_SCHEMA_SCRIPT,
    CATALOG_UPDATE_REGISTER_QUERY,
    CATALOG_UPDATE_SUCCEEDED,
    CatalogAction,
    ConnectionState,
    SET_CATALOG_SCRIPT,
    UPDATE_CATALOG,
} from './connection_state.js';

/// The default descriptor pool of the catalog
// export const CATALOG_DEFAULT_DESCRIPTOR_POOL = 42; XXX

/// The rank for catalog default descriptor pool.
/// We match catalog entries ordered by rank.
/// A higher rank is matched later.
export const CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK = 9999;

export enum CatalogUpdateVariant {
    FULL_CATALOG_REFRESH
}

export enum CatalogUpdateTaskStatus {
    STARTED = 0,
    SUCCEEDED = 1,
    FAILED = 2,
    CANCELLED = 3,
}
export const CATALOG_UPDATE_TASK_STATUS_NAMES: string[] = [
    "Started",
    "Succeeded",
    "Failed",
    "Cancelled",
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
    /// The time at which the task was last updated
    lastUpdateAt: Date | null;
}

export function reduceCatalogAction(state: ConnectionState, action: CatalogAction, storage: StorageWriter): ConnectionState {
    const now = new Date();

    if (action.type == UPDATE_CATALOG) {
        const [updateId, update] = action.value;
        state.catalogUpdates.tasksRunning.set(updateId, update);
        return {
            ...state,
            catalogUpdates: {
                ...state.catalogUpdates,
                tasksRunning: state.catalogUpdates.tasksRunning,
                currentFullRefresh: update.taskVariant == CatalogUpdateVariant.FULL_CATALOG_REFRESH
                    ? updateId
                    : state.catalogUpdates.currentFullRefresh
            },
        };
    }

    // SET_CATALOG_SCRIPT doesn't involve catalog updates
    if (action.type == SET_CATALOG_SCRIPT) {
        return state;
    }

    const updateId = (action.value as [number, ...any])[0];
    let update = state.catalogUpdates.tasksRunning.get(updateId);
    if (!update) {
        return state;
    }
    switch (action.type) {
        case CATALOG_UPDATE_REGISTER_QUERY: {
            update = {
                ...update,
                queries: [...update.queries, action.value[1]],
                lastUpdateAt: now,
            };
            state.catalogUpdates.tasksRunning.set(updateId, update);
            return {
                ...state,
                catalogUpdates: {
                    ...state.catalogUpdates,
                    tasksRunning: state.catalogUpdates.tasksRunning,
                }
            };
        }
        case CATALOG_UPDATE_SCHEMA_SCRIPT: {
            update = {
                ...update,
                lastUpdateAt: now,
            };
            state.catalogUpdates.tasksRunning.set(updateId, update);
            return {
                ...state,
                catalogUpdates: {
                    ...state.catalogUpdates,
                    tasksRunning: state.catalogUpdates.tasksRunning,
                }
            };
        }
        case CATALOG_UPDATE_CANCELLED:
            update = {
                ...update,
                status: CatalogUpdateTaskStatus.CANCELLED,
                error: action.value[1],
                finishedAt: now,
                lastUpdateAt: now,
            };
            state.catalogUpdates.tasksRunning.delete(updateId);
            state.catalogUpdates.tasksFinished.set(updateId, update);
            return {
                ...state,
                catalogUpdates: {
                    tasksRunning: state.catalogUpdates.tasksRunning,
                    tasksFinished: state.catalogUpdates.tasksFinished,
                    restoredAt: state.catalogUpdates.restoredAt,
                    currentFullRefresh: updateId,
                    lastFullRefresh: updateId,
                }
            };
        case CATALOG_UPDATE_FAILED:
            update = {
                ...update,
                status: CatalogUpdateTaskStatus.FAILED,
                error: action.value[1],
                finishedAt: now,
                lastUpdateAt: now,
            };
            state.catalogUpdates.tasksRunning.delete(updateId);
            state.catalogUpdates.tasksFinished.set(updateId, update);
            return {
                ...state,
                catalogUpdates: {
                    tasksRunning: state.catalogUpdates.tasksRunning,
                    tasksFinished: state.catalogUpdates.tasksFinished,
                    restoredAt: state.catalogUpdates.restoredAt,
                    currentFullRefresh: updateId,
                    lastFullRefresh: updateId,
                }
            };
        case CATALOG_UPDATE_SUCCEEDED:
            update = {
                ...update,
                status: CatalogUpdateTaskStatus.SUCCEEDED,
                finishedAt: now,
                lastUpdateAt: now,
            };
            state.catalogUpdates.tasksRunning.delete(updateId);
            state.catalogUpdates.tasksFinished.set(updateId, update);
            let newState = {
                ...state,
                catalogUpdates: {
                    tasksRunning: state.catalogUpdates.tasksRunning,
                    tasksFinished: state.catalogUpdates.tasksFinished,
                    restoredAt: state.catalogUpdates.restoredAt,
                    currentFullRefresh: updateId,
                    lastFullRefresh: updateId,
                }
            };
            // Persist the updated catalog script so it survives reloads.
            // Debounced on the schema path so bursts of updates collapse to a single write.
            if (newState.active) {
                storage.write(
                    groupSessionSchemaWrites(newState.sessionId),
                    { type: WRITE_SESSION_CATALOG_SCRIPT, value: [newState.sessionId, newState.catalogRelationScript] },
                    DEBOUNCE_DURATION_SESSION_WRITE,
                );
                storage.write(
                    groupSessionFunctionWrites(newState.sessionId),
                    { type: WRITE_SESSION_FUNCTION_SCRIPT, value: [newState.sessionId, newState.catalogFunctionScript] },
                    DEBOUNCE_DURATION_SESSION_WRITE,
                );
            }
            return newState;
        default:
            return state;
    }
}
