// @vitest-environment node
import {
    EXECUTE_QUERY,
    QUERY_FAILED,
    QUERY_SUCCEEDED,
    createQueryExecutionState,
    QueryExecutionStatus,
    QueryType,
} from '../query/query_execution_state.js';
import { LoggableException } from '../platform/logger/logger.js';
import { SHELL_QUERY_HISTORY_LIMIT, ShellQueryExecutionTracker } from './query_execution.js';

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
        const tracker = new ShellQueryExecutionTracker();
        const listener = vi.fn();
        const unsubscribe = tracker.subscribe(listener);

        tracker.dispatch({ type: EXECUTE_QUERY, value: [1, createExecution(1, 'SELECT 1')] });
        tracker.dispatch({ type: QUERY_SUCCEEDED, value: [1] });

        expect(listener).toHaveBeenCalledTimes(2);
        expect(tracker.getSnapshot()).toMatchObject([{
            queryId: 1,
            status: QueryExecutionStatus.SUCCEEDED,
        }]);

        unsubscribe();
        tracker.dispatch({
            type: QUERY_FAILED,
            value: [1, new LoggableException('late failure'), null],
        });
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('retains only the most recent shell executions', () => {
        const tracker = new ShellQueryExecutionTracker();

        for (let i = 0; i < SHELL_QUERY_HISTORY_LIMIT + 5; ++i) {
            const queryId = i + 1;
            tracker.dispatch({ type: EXECUTE_QUERY, value: [queryId, createExecution(queryId, `SELECT ${i}`)] });
        }

        const executions = tracker.getSnapshot();
        expect(executions).toHaveLength(SHELL_QUERY_HISTORY_LIMIT);
        expect(executions[0].queryText).toBe('SELECT 5');
        expect(executions[executions.length - 1].queryText).toBe(`SELECT ${SHELL_QUERY_HISTORY_LIMIT + 4}`);
    });
});
