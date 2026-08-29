// @vitest-environment node
import { QUERY_STATEMENT_STARTED, QueryExecutionStatus, QueryType } from './query_execution_state.js';
import { allocateQueryId, executeTrackedQuery } from './tracked_query_execution.js';
import { ShellQueryExecutionTracker } from '../shell/query_execution.js';
import { createQueryExecutionMetrics, reduceQueryAction, type QueryExecutionHistoryState } from './query_execution_state.js';

const metadata = {
    queryType: QueryType.INTERNAL_SQLFRAME,
    title: 'Internal query',
    description: null,
    issuer: 'SQLFrame',
    userProvided: false,
};

describe('executeTrackedQuery', () => {
    it('uses the shared query lifecycle for successful executions', async () => {
        const tracker = new ShellQueryExecutionTracker();

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
        const tracker = new ShellQueryExecutionTracker();
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

    it('does not count internal executions as connector metrics', async () => {
        let state: QueryExecutionHistoryState = {
            queriesActive: new Map(),
            queriesActiveOrdered: [],
            queriesFinished: new Map(),
            queriesFinishedOrdered: [],
            snapshotQueriesActiveFinished: 1,
            metrics: createQueryExecutionMetrics(),
        };
        await executeTrackedQuery({
            query: 'SELECT 1',
            metadata,
            tracker: { dispatch: action => { state = reduceQueryAction(state, action); } },
            execute: async () => undefined,
        });

        expect(state.metrics.successfulQueries?.totalQueries).toBe(0);
        expect(state.queriesFinished.size).toBe(1);
    });

    it('records the active script statement', async () => {
        const tracker = new ShellQueryExecutionTracker();

        await executeTrackedQuery({
            query: 'CREATE TABLE t(a INT); SELECT * FROM t',
            metadata,
            tracker,
            execute: async context => {
                context.dispatch({ type: QUERY_STATEMENT_STARTED, value: [context.queryId, 1, 2] });
            },
        });

        expect(tracker.getSnapshot()[0]).toMatchObject({
            statementIndex: 1,
            statementCount: 2,
        });
    });
});
