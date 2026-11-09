import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    EXECUTE_QUERY,
    QUERY_SUCCEEDED,
    createQueryExecutionState,
    QueryType,
} from '../query/query_execution_state.js';
import { SHELL_QUERY_HISTORY_LIMIT, ShellQueryExecutionTracker } from '../shell/query_execution.js';
import { useShellQueryResult } from './use_shell_query_result.js';

function createExecution(queryId: number) {
    return createQueryExecutionState(
        queryId,
        queryId,
        `SELECT ${queryId}`,
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

describe('useShellQueryResult', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('keeps the open result after shell history evicts its query', () => {
        const tracker = new ShellQueryExecutionTracker();
        tracker.dispatch({ type: EXECUTE_QUERY, value: [1, createExecution(1)] });
        tracker.dispatch({ type: QUERY_SUCCEEDED, value: [1] });

        let result!: ReturnType<typeof useShellQueryResult>;
        const Harness = () => {
            result = useShellQueryResult(tracker, () => {});
            return null;
        };
        act(() => root.render(<Harness />));
        act(() => result.showResultQuery(1));

        for (let queryId = 2; queryId <= SHELL_QUERY_HISTORY_LIMIT + 1; ++queryId) {
            tracker.dispatch({ type: EXECUTE_QUERY, value: [queryId, createExecution(queryId)] });
            tracker.dispatch({ type: QUERY_SUCCEEDED, value: [queryId] });
        }

        expect(tracker.getSnapshot().some(query => query.queryId === 1)).toBe(false);
        expect(result.resultQuery?.queryId).toBe(1);

        act(() => result.closeResultQuery());
        expect(result.resultQuery).toBeNull();
    });

    describe('with two results', () => {
        let result: ReturnType<typeof useShellQueryResult>;
        let release: ReturnType<typeof vi.fn<(queryId: number) => void>>;

        beforeEach(() => {
            const tracker = new ShellQueryExecutionTracker();
            for (const queryId of [1, 2]) {
                tracker.dispatch({ type: EXECUTE_QUERY, value: [queryId, createExecution(queryId)] });
                tracker.dispatch({ type: QUERY_SUCCEEDED, value: [queryId] });
            }
            release = vi.fn<(queryId: number) => void>();
            const Harness = () => {
                result = useShellQueryResult(tracker, release);
                return null;
            };
            act(() => root.render(<Harness />));
        });

        it('has nothing to open again before the first result', () => {
            let reopened = true;
            act(() => { reopened = result.reopenResultQuery(); });
            expect(reopened).toBe(false);
            expect(result.resultQuery).toBeNull();
        });

        it('keeps a closed result until the next one replaces it', () => {
            act(() => result.showResultQuery(1));
            act(() => result.closeResultQuery());
            expect(result.resultQuery).toBeNull();
            expect(release).not.toHaveBeenCalled();

            let reopened = false;
            act(() => { reopened = result.reopenResultQuery(); });
            expect(reopened).toBe(true);
            expect(result.resultQuery?.queryId).toBe(1);

            act(() => result.showResultQuery(2));
            expect(result.resultQuery?.queryId).toBe(2);
            expect(release.mock.calls).toEqual([[1]]);
        });

        it('releases a dropped result and does not open it again', () => {
            act(() => result.showResultQuery(1));
            act(() => result.dropResultQuery());
            expect(result.resultQuery).toBeNull();
            expect(release.mock.calls).toEqual([[1]]);

            let reopened = true;
            act(() => { reopened = result.reopenResultQuery(); });
            expect(reopened).toBe(false);
        });

        it('releases the result with the page', () => {
            act(() => result.showResultQuery(2));
            act(() => root.render(<div />));
            expect(release.mock.calls).toEqual([[2]]);
        });
    });
});
