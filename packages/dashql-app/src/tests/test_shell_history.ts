import type * as core from '@ankoh/dashql';

import type { Runtime } from '@ankoh/dashql/runtime/runtime';
import type { QueryExecutionState } from '@ankoh/dashql/platform/query/query_execution_state';
import type { QueryTracker } from '@ankoh/dashql/runtime/query/tracked_query_execution';
import { testRuntime } from '@ankoh/dashql/runtime/testing/mocks/connector_state';
import { SHELL_QUERY_HISTORY_LIMIT } from '../shell_app/shell_query_history.js';

/// A history without a connection in a runtime of a test, as the shell keeps its queries
export interface TestShellHistory {
    runtime: Runtime;
    tracker: QueryTracker;
    /// The queries of the history, the oldest first
    queries(): QueryExecutionState[];
}

/// Create a history of the shell in a new runtime on the core of the test
export function testShellHistory(dql: core.DashQL, limit: number = SHELL_QUERY_HISTORY_LIMIT, history: string = 'shell'): TestShellHistory {
    const runtime = testRuntime(dql);
    const tracker: QueryTracker = { runtime, target: { history } };
    const created = runtime.dispatch(tracker.target, { kind: 'createHistory', value: { limit } });
    if (!created.ok) throw new Error(created.error ?? 'the history was not created');
    return {
        runtime,
        tracker,
        queries: () => {
            runtime.flush();
            return (runtime.store.get('history', history)?.queries ?? [])
                .map(queryId => runtime.module.views('query', [queryId])[0] ?? null)
                .map(query => (query === 'busy' ? null : query) as QueryExecutionState | null)
                .filter((query): query is QueryExecutionState => query != null);
        },
    };
}
