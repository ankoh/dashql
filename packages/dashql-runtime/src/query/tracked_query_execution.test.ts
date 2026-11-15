// @vitest-environment node
import type * as core from '@ankoh/dashql-core';

import { QueryExecutionStatus, QueryType } from './query_execution_state.js';
import { allocateQueryId, executeTrackedQuery } from './tracked_query_execution.js';
import { ShellQueryExecutionTracker } from './shell_query_execution.js';
import { testCore } from '../testing/test_runtime.js';

let dql: core.DashQL;
beforeAll(async () => {
    dql = await testCore();
});

const metadata = {
    queryType: QueryType.INTERNAL_SQLFRAME,
    title: 'Internal query',
    description: null,
    issuer: 'SQLFrame',
    userProvided: false,
};

describe('executeTrackedQuery', () => {
    it('uses the shared query lifecycle for successful executions', async () => {
        const tracker = new ShellQueryExecutionTracker(dql);

        await expect(executeTrackedQuery({
            query: 'SELECT 1',
            metadata,
            tracker,
            execute: async () => 42,
        })).resolves.toBe(42);

        expect(tracker.getSnapshot()).toMatchObject([{
            queryText: 'SELECT 1',
            queryMetadata: metadata,
            status: QueryExecutionStatus.SUCCEEDED,
        }]);
    });

    it('records failures once and preserves the original error', async () => {
        const tracker = new ShellQueryExecutionTracker(dql);
        const error = new Error('boom');

        await expect(executeTrackedQuery({
            query: 'SELECT bad',
            metadata,
            tracker,
            execute: async context => {
                context.fail(error);
                throw error;
            },
        })).rejects.toBe(error);

        expect(tracker.getSnapshot()).toHaveLength(1);
        expect(tracker.getSnapshot()[0]).toMatchObject({
            status: QueryExecutionStatus.FAILED,
            error: { message: 'boom' },
        });
    });

    it('allocates query ids from one shared sequence', () => {
        expect(allocateQueryId() + 1).toBe(allocateQueryId());
    });
});
