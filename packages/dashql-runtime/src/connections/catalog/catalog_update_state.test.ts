import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as dashql from '@ankoh/dashql-core';

import { CatalogUpdateTaskStatus, CatalogUpdateVariant, isCatalogRefreshRunning, type CatalogUpdateTaskState } from './catalog_update_state.js';
import {
    CATALOG_UPDATE_CANCELLED,
    CATALOG_UPDATE_FAILED,
    CATALOG_UPDATE_PARTIALLY_SUCCEEDED,
    CATALOG_UPDATE_SUCCEEDED,
    createConnectionState,
    reduceConnectionState,
    UPDATE_CATALOG,
    type ConnectionState,
    type CatalogAction,
} from '../connection_state.js';
import { CONNECTOR_INFOS, ConnectorType } from '../connector_info.js';
import { createConnectionStateDetails } from '../connection_state_details.js';
import { TestLogger } from '../../testing/test_logger.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: dashql.DashQL;
beforeAll(async () => { dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });
afterEach(() => dql.resetUnsafe());

/// A connection on the Rust connection of the core
function hyper(): ConnectionState {
    const details = createConnectionStateDetails(ConnectorType.HYPER);
    return { ...createConnectionState(dql, CONNECTOR_INFOS[ConnectorType.HYPER], details, { active: true }), connectionId: 'database' };
}

const reduce = (state: ConnectionState, action: CatalogAction) => reduceConnectionState(state, action, new TestLogger());

function createConnection(currentFullRefresh: number | null, runningTaskIds: number[]): ConnectionState {
    return {
        catalogUpdates: {
            touchedRelations: [], touchedFailures: 0,
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

// The Rust connection of the runtime applies the actions, `packages/dashql-runtime-rs/src/connections/catalog_updates.rs`
describe('catalog updates of a connection', () => {
    const terminalActions: CatalogAction[] = [
        { type: CATALOG_UPDATE_CANCELLED, value: [7, new Error('cancelled')] },
        { type: CATALOG_UPDATE_FAILED, value: [7, new Error('failed')] },
        { type: CATALOG_UPDATE_SUCCEEDED, value: [7] },
        { type: CATALOG_UPDATE_PARTIALLY_SUCCEEDED, value: [7, new Error('partial')] },
    ];
    const task = (taskId: number): CatalogUpdateTaskState => ({
        taskId,
        taskVariant: CatalogUpdateVariant.FULL_CATALOG_REFRESH,
        status: CatalogUpdateTaskStatus.STARTED,
        cancellation: new AbortController(),
        queries: [],
        error: null,
        startedAt: new Date(),
        finishedAt: null,
    });

    it.each(terminalActions)('preserves a superseding refresh for terminal action $type', action => {
        for (const newerFinishedFirst of [false, true]) {
            let state = hyper();
            state = reduce(state, { type: UPDATE_CATALOG, value: [7, task(7)] });
            state = reduce(state, { type: UPDATE_CATALOG, value: [8, task(8)] });
            if (newerFinishedFirst) {
                state = reduce(state, { type: CATALOG_UPDATE_SUCCEEDED, value: [8] });
            }
            state = reduce(state, action);
            expect(state.catalogUpdates.tasksRunning.has(7)).toBe(false);
            expect(state.catalogUpdates.tasksFinished.has(7)).toBe(true);
            expect(state.catalogUpdates.currentFullRefresh).toBe(8);
            expect(isCatalogRefreshRunning(state)).toBe(!newerFinishedFirst);
            if (!newerFinishedFirst) {
                state = reduce(state, { type: CATALOG_UPDATE_SUCCEEDED, value: [8] });
            }
            expect(state.catalogUpdates.currentFullRefresh).toBe(8);
            expect(state.catalogUpdates.described).toBe(true);
            expect(isCatalogRefreshRunning(state)).toBe(false);
        }
    });

    it('finishes a partially successful refresh for the registry to persist', () => {
        const error = new Error('second: unavailable');
        const state = reduce(hyper(), { type: UPDATE_CATALOG, value: [7, task(7)] });
        expect(state.catalogUpdates.currentFullRefresh).toBe(7);

        const next = reduce(state, {
            type: CATALOG_UPDATE_PARTIALLY_SUCCEEDED,
            value: [7, error],
        });

        const finished = next.catalogUpdates.tasksFinished.get(7)!;
        expect(finished.status).toBe(CatalogUpdateTaskStatus.PARTIALLY_SUCCEEDED);
        expect(finished.error).toBe(error);
        expect(next.catalogUpdates.tasksRunning.has(7)).toBe(false);
        // A partial catalog doesn't describe the connection
        expect(next.catalogUpdates.described).toBe(false);
    });

    it('keeps the cancellation of a task and ignores the actions of unknown tasks', () => {
        const started = task(7);
        const state = reduce(hyper(), { type: UPDATE_CATALOG, value: [7, started] });
        expect(state.catalogUpdates.tasksRunning.get(7)!.cancellation).toBe(started.cancellation);
        expect(reduce(state, { type: CATALOG_UPDATE_SUCCEEDED, value: [9] })).toBe(state);
    });
});
