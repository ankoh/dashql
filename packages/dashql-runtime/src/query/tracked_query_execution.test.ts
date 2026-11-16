// @vitest-environment node
import { tableFromArrays } from '@ankoh/dashql-platform/testing/arrow_fixtures';
import type * as core from '@ankoh/dashql-core';

import { QueryExecutionStatus, QueryType } from '@ankoh/dashql-platform/query/query_execution_state';
import { executeTrackedQuery, type QueryTracker } from './tracked_query_execution.js';
import { testCore } from '../testing/test_runtime.js';
import { connectorState, testRuntime } from '../testing/mocks/connector_state.js';
import type { Runtime } from '../runtime.js';
import { ConnectorType } from '@ankoh/dashql-platform/connections/connector_info';

let dql: core.DashQL;
let runtime: Runtime;
beforeAll(async () => {
    dql = await testCore();
});
beforeEach(() => {
    runtime = testRuntime(dql);
    runtime.dispatch({ history: 'shell' }, { kind: 'createHistory', value: { limit: 100 } });
});
afterEach(() => runtime.destroy());

const metadata = {
    queryType: QueryType.INTERNAL_SQLFRAME,
    title: 'Internal query',
    description: null,
    issuer: 'SQLFrame',
    userProvided: false,
};

/// The queries of the history of the shell
function shellQueries() {
    runtime.flush();
    return (runtime.store.get('history', 'shell')?.queries ?? []).map(queryId => runtime.store.get('query', queryId));
}

describe('executeTrackedQuery', () => {
    const tracker = (): QueryTracker => ({ runtime, target: { history: 'shell' } });

    it('uses the shared query lifecycle for successful executions', async () => {
        // A query of the user keeps its result, an internal one hands it back to its caller only
        const user = { ...metadata, queryType: QueryType.USER_PROVIDED, userProvided: true };
        // Arrow builds its vectors with generated code, which the CSP of the browser tests refuses
        const table = tableFromArrays({ a: [1, 2] });
        await expect(executeTrackedQuery({
            query: 'SELECT 1',
            metadata: user,
            tracker: tracker(),
            execute: async context => {
                context.receivedAllBatches(table);
                return 42;
            },
        })).resolves.toBe(42);

        const [query] = shellQueries();
        expect(query).toMatchObject({
            queryText: 'SELECT 1',
            queryMetadata: user,
            status: QueryExecutionStatus.SUCCEEDED,
            resultTable: { rows: 2 },
        });
        // The history keeps the result table in the handle table of the runtime
        expect(runtime.table(query!.resultTable!.id)).toBe(table);
    });

    it('records failures once and preserves the original error', async () => {
        const error = new Error('boom');
        await expect(executeTrackedQuery({
            query: 'SELECT bad',
            metadata,
            tracker: tracker(),
            execute: async context => {
                context.fail(error);
                throw error;
            },
        })).rejects.toBe(error);

        const queries = shellQueries();
        expect(queries).toHaveLength(1);
        expect(queries[0]).toMatchObject({ status: QueryExecutionStatus.FAILED, error: { message: 'boom' } });
    });

    it('hands out the ids of one sequence and runs untracked without a history', async () => {
        let ids: number[] = [];
        for (let i = 0; i < 2; ++i) {
            await executeTrackedQuery({ query: 'SELECT 1', metadata, tracker: tracker(), execute: async context => { ids.push(context.queryId); } });
        }
        expect(ids[1]).toBe(ids[0] + 1);
        ids = [];
        await executeTrackedQuery({ query: 'SELECT 1', metadata, tracker: { runtime, target: { history: 'none' } }, execute: async context => { ids.push(context.queryId); } });
        expect(ids).toEqual([0]);
    });

    it('aborts a query of a connection that is reset', async () => {
        connectorState(runtime, ConnectorType.HYPER, { protocol: 'WASM', endpoint: '' }, 'main');
        let reason: unknown = null;
        const execution = executeTrackedQuery({
            query: 'SELECT 1',
            metadata,
            tracker: { runtime, target: { connection: 'main' } },
            execute: context => new Promise((_resolve, reject) => {
                context.cancellation.signal.addEventListener('abort', () => {
                    reason = context.cancellation.signal.reason;
                    reject(reason);
                });
            }),
        });
        runtime.flush();
        expect(runtime.connection('main')!.queriesActiveOrdered).toHaveLength(1);
        runtime.dispatch({ connection: 'main' }, { kind: 'resetConnection' });
        runtime.flush();
        await expect(execution).rejects.toBeInstanceOf(DOMException);
        expect((reason as DOMException).message).toBe('Connection was reset');
        expect(runtime.connection('main')!.queriesActiveOrdered).toEqual([]);
    });
});
