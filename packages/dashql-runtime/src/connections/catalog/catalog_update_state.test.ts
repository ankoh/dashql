import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as dashql from '@ankoh/dashql-core';

import { CatalogUpdateTaskStatus, CatalogUpdateVariant, isCatalogRefreshRunning } from './catalog_update_state.js';
import type { ConnectionState } from '../connection_state.js';
import { ConnectorType } from '../connector_info.js';
import type { CoreRuntime } from '../../core_runtime.js';
import { connectorState, testCoreRuntime } from '../../testing/mocks/connector_state.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: dashql.DashQL;
let runtime: CoreRuntime;
beforeAll(async () => { dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });
beforeEach(() => { runtime = testCoreRuntime(dql); });
afterEach(() => runtime.destroy());

/// A connection of the runtime
function hyper(): ConnectionState {
    return connectorState(runtime, ConnectorType.HYPER, { protocol: 'WASM', endpoint: '' }, 'database');
}

/// Apply an action of the catalog loader to the connection, returns the connection
function reduce(action: dashql.RuntimeAction): ConnectionState {
    runtime.dispatch({ connection: 'database' }, action);
    return runtime.connection('database')!;
}

function createConnection(currentFullRefresh: number | null, runningTaskIds: number[]): ConnectionState {
    return {
        catalogUpdates: {
            touchedRelations: [], touchedFailures: 0,
            currentFullRefresh,
            tasksRunning: runningTaskIds.map(taskId => ({ taskId })),
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

// The runtime applies the actions of the catalog loader, `packages/dashql-core-runtime/src/connections/catalog_updates.rs`
describe('catalog updates of a connection', () => {
    const update = (taskId: number): dashql.RuntimeAction => ({
        kind: 'updateCatalog',
        value: { taskId, handle: runtime.handles.register({ abort: () => { } }), variant: CatalogUpdateVariant.FULL_CATALOG_REFRESH, startedAt: Date.now() },
    });
    const finished = (taskId: number, status: CatalogUpdateTaskStatus): dashql.RuntimeAction => ({
        kind: 'catalogUpdateFinished',
        value: { taskId, status, error: status === CatalogUpdateTaskStatus.SUCCEEDED ? undefined : { message: 'ended' } },
    });
    const terminal = [CatalogUpdateTaskStatus.CANCELLED, CatalogUpdateTaskStatus.FAILED, CatalogUpdateTaskStatus.SUCCEEDED, CatalogUpdateTaskStatus.PARTIALLY_SUCCEEDED];
    const has = (tasks: dashql.ConnectionCatalogUpdateTask[], taskId: number) => tasks.some(task => task.taskId === taskId);

    it.each(terminal)('preserves a superseding refresh for the final status %s', status => {
        for (const newerFinishedFirst of [false, true]) {
            hyper();
            reduce(update(7));
            let state = reduce(update(8));
            if (newerFinishedFirst) {
                state = reduce(finished(8, CatalogUpdateTaskStatus.SUCCEEDED));
            }
            state = reduce(finished(7, status));
            expect(has(state.catalogUpdates.tasksRunning, 7)).toBe(false);
            expect(has(state.catalogUpdates.tasksFinished, 7)).toBe(true);
            expect(state.catalogUpdates.currentFullRefresh).toBe(8);
            expect(isCatalogRefreshRunning(state)).toBe(!newerFinishedFirst);
            if (!newerFinishedFirst) {
                state = reduce(finished(8, CatalogUpdateTaskStatus.SUCCEEDED));
            }
            expect(state.catalogUpdates.currentFullRefresh).toBe(8);
            expect(state.catalogUpdates.described).toBe(true);
            expect(isCatalogRefreshRunning(state)).toBe(false);
            runtime.dispatch({ connection: 'database' }, { kind: 'resetConnection' });
            runtime.destroy();
            runtime = testCoreRuntime(dql);
        }
    });

    it('finishes a partially successful refresh for the runtime to persist', () => {
        hyper();
        const state = reduce(update(7));
        expect(state.catalogUpdates.currentFullRefresh).toBe(7);
        const next = reduce({ kind: 'catalogUpdateFinished', value: { taskId: 7, status: CatalogUpdateTaskStatus.PARTIALLY_SUCCEEDED, error: { message: 'second: unavailable' } } });
        const task = next.catalogUpdates.tasksFinished.find(task => task.taskId === 7)!;
        expect(task.status).toBe(CatalogUpdateTaskStatus.PARTIALLY_SUCCEEDED);
        expect(task.error).toEqual({ message: 'second: unavailable' });
        expect(has(next.catalogUpdates.tasksRunning, 7)).toBe(false);
        // A partial catalog doesn't describe the connection
        expect(next.catalogUpdates.described).toBe(false);
    });

    it('aborts the record of a running update when the connection is reset, an unknown task changes nothing', () => {
        hyper();
        let aborted: unknown = null;
        const handle = runtime.handles.register({ abort: (reason: unknown) => { aborted = reason; } });
        const state = reduce({ kind: 'updateCatalog', value: { taskId: 7, handle, variant: CatalogUpdateVariant.FULL_CATALOG_REFRESH } });
        expect(state.catalogUpdates.tasksRunning[0]).toMatchObject({ taskId: 7, handle });
        expect(runtime.dispatch({ connection: 'database' }, finished(9, CatalogUpdateTaskStatus.SUCCEEDED)).changed).toBe(false);
        runtime.dispatch({ connection: 'database' }, { kind: 'resetConnection' });
        runtime.flush();
        expect(aborted).toBeInstanceOf(DOMException);
    });
});
