import { describe, expect, it, vi } from 'vitest';

import { CatalogUpdateTaskStatus, CatalogUpdateVariant, isCatalogRefreshRunning, reduceCatalogAction } from './catalog_update_state.js';
import { CATALOG_UPDATE_PARTIALLY_SUCCEEDED, type ConnectionState } from './connection_state.js';

function createConnection(currentFullRefresh: number | null, runningTaskIds: number[]): ConnectionState {
    return {
        catalogUpdates: {
            currentFullRefresh,
            tasksRunning: new Map(runningTaskIds.map(taskId => [taskId, {}])),
        },
    } as unknown as ConnectionState;
}

describe('isCatalogRefreshRunning', () => {
    it('returns true while the current full refresh is running', () => {
        expect(isCatalogRefreshRunning(createConnection(7, [7]))).toBe(true);
    });

    it('returns false after the current full refresh completes', () => {
        expect(isCatalogRefreshRunning(createConnection(7, []))).toBe(false);
    });

    it('ignores other running catalog tasks', () => {
        expect(isCatalogRefreshRunning(createConnection(7, [8]))).toBe(false);
    });

    it('returns false without a connection', () => {
        expect(isCatalogRefreshRunning(null)).toBe(false);
    });
});

describe('reduceCatalogAction', () => {
    it('finishes and persists a partially successful refresh', () => {
        const error = new Error('second: unavailable');
        const task = {
            taskId: 7,
            taskVariant: CatalogUpdateVariant.FULL_CATALOG_REFRESH,
            status: CatalogUpdateTaskStatus.STARTED,
            cancellation: new AbortController(),
            queries: [],
            error: null,
            startedAt: new Date(),
            finishedAt: null,
            lastUpdateAt: new Date(),
        };
        const state = {
            active: true,
            notebookId: 'notebook',
            catalogRelationScript: {},
            catalogFunctionScript: {},
            catalogUpdates: {
                tasksRunning: new Map([[7, task]]),
                tasksFinished: new Map(),
                currentFullRefresh: 7,
                lastFullRefresh: null,
                restoredAt: null,
            },
        } as unknown as ConnectionState;
        const storage = { write: vi.fn() };

        const next = reduceCatalogAction(state, {
            type: CATALOG_UPDATE_PARTIALLY_SUCCEEDED,
            value: [7, error],
        }, storage as any);

        const finished = next.catalogUpdates.tasksFinished.get(7)!;
        expect(finished.status).toBe(CatalogUpdateTaskStatus.PARTIALLY_SUCCEEDED);
        expect(finished.error).toBe(error);
        expect(next.catalogUpdates.tasksRunning.has(7)).toBe(false);
        expect(storage.write).toHaveBeenCalledTimes(2);
    });
});
