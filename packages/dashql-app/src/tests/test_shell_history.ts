import type * as core from '@akohn/dashql';

import type { Runtime } from '@akohn/dashql/runtime';
import type { QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import { newDefaultHyperWasmConnection } from '@akohn/dashql/platform/connections/connection_params';
import { testRuntime } from '@akohn/dashql/runtime/testing/test_runtime';

/// The connection of the shell in a runtime of a test, the history of the shell is its history
export interface TestShellHistory {
    runtime: Runtime;
    connectionId: string;
    /// The queries of the history, the finished ones first
    queries(): QueryExecutionState[];
}

/// Create the connection of the shell in a new runtime on the core of the test
export function testShellHistory(dql: core.DashQL, connectionId: string = 'shell'): TestShellHistory {
    const runtime = testRuntime(dql);
    runtime.createConnection(newDefaultHyperWasmConnection(), connectionId);
    return {
        runtime,
        connectionId,
        queries: () => {
            runtime.flush();
            const connection = runtime.connection(connectionId);
            return [...connection?.queriesFinishedOrdered ?? [], ...connection?.queriesActiveOrdered ?? []]
                .map(queryId => runtime.store.get('query', queryId))
                .filter((query): query is QueryExecutionState => query != null);
        },
    };
}
