import type * as core from '@ankoh/dashql-core';

import {
    EXECUTE_QUERY,
    QUERY_FAILED,
    QUERY_RECEIVED_ALL_BATCHES,
    QUERY_SUCCEEDED,
    createQueryExecutionState,
    createQueryResponseStreamMetrics,
    QueryExecutionStatus,
    QueryType,
} from './query_execution_state.js';
import { LoggableException } from '../platform/logger/logger.js';
import { SHELL_QUERY_HISTORY_LIMIT, ShellQueryExecutionTracker } from './shell_query_execution.js';
import { tableFromArrays } from '../testing/arrow_fixtures.js';
import { testCore } from '../testing/test_runtime.js';

let dql: core.DashQL;
beforeAll(async () => {
    dql = await testCore();
});

function createExecution(queryId: number, queryText: string) {
    return createQueryExecutionState(
        queryId,
        queryId,
        queryText,
        {
            queryType: QueryType.USER_PROVIDED,
            title: 'Shell Query',
            description: null,
            issuer: 'DashQL Shell',
            userProvided: true,
        },
        new AbortController(),
    );
}

describe('shell query execution tracker', () => {
    it('tracks the shared query lifecycle actions and notifies subscribers', () => {
        const tracker = new ShellQueryExecutionTracker(dql);
        const listener = vi.fn();
        const unsubscribe = tracker.subscribe(listener);

        tracker.dispatch({ type: EXECUTE_QUERY, value: [1, createExecution(1, 'SELECT 1')] });
        tracker.dispatch({ type: QUERY_SUCCEEDED, value: [1] });

        expect(listener).toHaveBeenCalledTimes(2);
        expect(tracker.getSnapshot()).toMatchObject([{
            queryId: 1,
            status: QueryExecutionStatus.SUCCEEDED,
        }]);

        // A late action on a finished query changes nothing and keeps the snapshot
        const snapshot = tracker.getSnapshot();
        tracker.dispatch({
            type: QUERY_FAILED,
            value: [1, new LoggableException('late failure'), null],
        });
        expect(listener).toHaveBeenCalledTimes(2);
        expect(tracker.getSnapshot()).toBe(snapshot);
        unsubscribe();
        tracker.release();
    });

    it('retains only the most recent shell executions', () => {
        const tracker = new ShellQueryExecutionTracker(dql);

        for (let i = 0; i < SHELL_QUERY_HISTORY_LIMIT + 5; ++i) {
            const queryId = i + 1;
            tracker.dispatch({ type: EXECUTE_QUERY, value: [queryId, createExecution(queryId, `SELECT ${i}`)] });
        }

        const executions = tracker.getSnapshot();
        expect(executions).toHaveLength(SHELL_QUERY_HISTORY_LIMIT);
        expect(executions[0].queryText).toBe('SELECT 5');
        expect(executions[executions.length - 1].queryText).toBe(`SELECT ${SHELL_QUERY_HISTORY_LIMIT + 4}`);
        tracker.release();
    });

    it('lists the finished queries before the active ones and keeps their result tables', () => {
        const tracker = new ShellQueryExecutionTracker(dql);
        const table = tableFromArrays({ a: new Int32Array([1, 2]) });
        tracker.dispatch({ type: EXECUTE_QUERY, value: [1, createExecution(1, 'SELECT 1')] });
        tracker.dispatch({ type: EXECUTE_QUERY, value: [2, createExecution(2, 'SELECT 2')] });
        tracker.dispatch({ type: QUERY_RECEIVED_ALL_BATCHES, value: [2, table, createQueryResponseStreamMetrics()] });
        tracker.dispatch({ type: QUERY_SUCCEEDED, value: [2] });

        expect(tracker.getSnapshot().map(query => [query.queryId, query.status])).toEqual([
            [2, QueryExecutionStatus.SUCCEEDED],
            [1, QueryExecutionStatus.REQUESTED],
        ]);
        expect(tracker.getSnapshot()[0].resultTable).toBe(table);
        tracker.release();
    });

    it('waits for the core that it sets up', async () => {
        const tracker = new ShellQueryExecutionTracker(() => testCore());
        tracker.dispatch({ type: EXECUTE_QUERY, value: [1, createExecution(1, 'SELECT 1')] });
        tracker.dispatch({ type: QUERY_SUCCEEDED, value: [1] });
        expect(tracker.getSnapshot()).toEqual([]);

        await vi.waitFor(() => expect(tracker.getSnapshot()).toMatchObject([{ queryId: 1, status: QueryExecutionStatus.SUCCEEDED }]));
        tracker.release();
        expect(tracker.getSnapshot()).toEqual([]);
    });
});
