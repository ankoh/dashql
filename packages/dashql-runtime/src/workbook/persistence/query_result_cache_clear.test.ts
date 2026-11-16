import { describe, expect, it, vi } from 'vitest';

import { markDeletedQueryResults } from './query_result_cache_clear.js';
import type { Runtime } from '../../runtime.js';

describe('Query result cache clearing', () => {
    it('marks the finished queries of every connection whose results were deleted', () => {
        const queries = new Map<number, { cacheKey: string | null; cacheDeleted: boolean }>();
        const database = (connectionId: string, finished: [number, string | null, boolean][]) => {
            for (const [queryId, cacheKey, cacheDeleted] of finished) queries.set(queryId, { cacheKey, cacheDeleted });
            return { connectionId, queriesFinishedOrdered: finished.map(([queryId]) => queryId) };
        };
        const connections = new Map<string, unknown>([
            ['main', database('main', [[1, 'a', false], [2, 'other', false], [3, null, false], [4, 'b', true]])],
            ['attached', database('attached', [[5, 'b', false]])],
            ['unrelated', database('unrelated', [[6, 'a', false]])],
        ]);
        const dispatch = vi.fn();
        const runtime = {
            store: {
                all: () => connections,
                get: (_kind: string, queryId: number) => queries.get(queryId) ?? null,
            },
            dispatch,
        } as unknown as Runtime;
        // The cache belongs to the app, a query of any connection may advertise a deleted key
        expect(markDeletedQueryResults(runtime, ['a', 'b'])).toBe(3);
        expect(dispatch.mock.calls).toEqual([
            [{ connection: 'main' }, { kind: 'queryCacheDeleted', value: { queryId: 1 } }],
            [{ connection: 'attached' }, { kind: 'queryCacheDeleted', value: { queryId: 5 } }],
            [{ connection: 'unrelated' }, { kind: 'queryCacheDeleted', value: { queryId: 6 } }],
        ]);
    });
});
