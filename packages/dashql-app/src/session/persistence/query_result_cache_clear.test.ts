import { describe, expect, it, vi } from 'vitest';

import { markDeletedQueryResults } from './query_result_cache_clear.js';
import { QUERY_CACHE_DELETED } from '../../query/query_execution_state.js';

describe('Query result cache clearing', () => {
    it('marks the finished queries of every connection whose results were deleted', () => {
        const database = (connectionId: string, queries: [number, string | null, boolean][]) => ({
            connectionId,
            queriesFinished: new Map(queries.map(([queryId, cacheKey, cacheDeleted]) => [queryId, { queryId, cacheKey, cacheDeleted }])),
        });
        const registry = {
            connections: new Map<string, any>([
                ['main', database('main', [[1, 'a', false], [2, 'other', false], [3, null, false], [4, 'b', true]])],
                ['attached', database('attached', [[5, 'b', false]])],
                ['unrelated', database('unrelated', [[6, 'a', false]])],
            ]),
        };
        const dispatch = vi.fn();
        // The cache belongs to the app, a query of any connection may advertise a deleted key
        expect(markDeletedQueryResults(registry as any, dispatch, ['a', 'b'])).toBe(3);
        expect(dispatch.mock.calls).toEqual([
            ['main', { type: QUERY_CACHE_DELETED, value: [1] }],
            ['attached', { type: QUERY_CACHE_DELETED, value: [5] }],
            ['unrelated', { type: QUERY_CACHE_DELETED, value: [6] }],
        ]);
    });
});
