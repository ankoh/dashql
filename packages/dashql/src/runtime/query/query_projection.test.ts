import * as dashql from '../../core/index.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryProjection } from './query_projection.js';
import type { QueryExecutionState } from '../../platform/query/query_execution_state.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let core: dashql.DashQL;

beforeAll(async () => {
    core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

afterEach(() => {
    vi.restoreAllMocks();
});

/// The progress view of a Trino query with a plan of two operators
function profileView(): dashql.QueryProfileProgressView {
    const plan = { id: '1', name: 'Output', children: [{ id: '2', name: 'TableScan', descriptor: { table: 'tpch:sf1:lineitem' }, children: [] }] };
    const info = { queryId: 'q', stages: { stages: [{ stageId: 'q.0', plan: { jsonRepresentation: JSON.stringify(plan) } }] } };
    const recording = { version: 1, payloads: [{ elapsedMs: 0, payload: { kind: 'trino_query_info', info, receivedAt: 1 } }] };
    return core.replayQueryProgress(JSON.stringify(recording), Number.MAX_SAFE_INTEGER)!;
}

/// A fresh view of a query as the module returns it
function queryView(phase: string, profile: dashql.QueryProfileProgressView | null): dashql.QueryView {
    return {
        queryId: 7,
        status: dashql.QueryExecutionStatus.RUNNING,
        latestProgressUpdate: {
            isQueued: false,
            progressPercent: 10,
            resultRows: null,
            rowsProcessed: 100,
            executionTimeMs: 5,
            metrics: { totalRowsReceived: 0 },
            phase,
            profile,
        },
    } as unknown as dashql.QueryView;
}

describe('the query projection', () => {
    it('projects the progress of a query once per change of its view', () => {
        const projection = createQueryProjection(core, {} as dashql.Runtime);
        const read = vi.spyOn(core, 'readQueryProfile');
        const profile = profileView();

        const first = projection.project(7, null, queryView('RUNNING', profile));
        const progress = first.progress!;
        expect(progress.phase).toBe('RUNNING');
        expect(progress.profileProgress?.structure).not.toBeNull();
        expect(progress.profileProgress?.source).toEqual({ runtime: {}, queryId: 7 });
        expect(read).toHaveBeenCalledTimes(1);

        // The module leaves out the payloads of the keys that the store holds, the view is unchanged
        const omitted = { ...profile, structure: null, execution: null };
        const second = projection.project(7, first, queryView('RUNNING', omitted));
        expect(second).toBe(first);
        expect(second.progress).toBe(progress);
        expect(read).toHaveBeenCalledTimes(1);

        // Another phase is a new progress over the same structure, it isn't read again
        const third = projection.project(7, second, queryView('FINISHING', { ...profile, structure: null, execution: null }));
        expect(third).not.toBe(second);
        expect(third.progress).not.toBe(progress);
        expect(third.progress!.phase).toBe('FINISHING');
        expect(third.progress!.profileProgress).toBe(progress.profileProgress);
        expect(third.latestProgressUpdate!.profile!.structure).toBe(profile.structure);
        expect(read).toHaveBeenCalledTimes(1);
    });

    it('has no progress without a progress update', () => {
        const projection = createQueryProjection(core, {} as dashql.Runtime);
        const view = { queryId: 8, status: dashql.QueryExecutionStatus.SUCCEEDED, latestProgressUpdate: null } as unknown as dashql.QueryView;
        const first: QueryExecutionState = projection.project(8, null, view);
        expect(first.progress).toBeNull();
        const again = { queryId: 8, status: dashql.QueryExecutionStatus.SUCCEEDED, latestProgressUpdate: null } as unknown as dashql.QueryView;
        expect(projection.project(8, first, again)).toBe(first);
    });
});
