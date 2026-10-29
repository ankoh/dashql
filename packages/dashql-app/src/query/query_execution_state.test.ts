// @vitest-environment node
import * as arrow from 'apache-arrow';

import {
    EXECUTE_QUERY,
    INTERNAL_QUERY_HISTORY_LIMIT,
    QUERY_FAILED,
    QUERY_RECEIVED_ALL_BATCHES,
    QUERY_RECEIVED_BATCH,
    QUERY_SUCCEEDED,
    QueryType,
    createQueryExecutionMetrics,
    createQueryExecutionState,
    createQueryResponseStreamMetrics,
    reduceQueryAction,
    type QueryExecutionHistoryState,
    type QueryMetadata,
} from './query_execution_state.js';
import { LoggableException } from '../platform/logger/logger.js';

function history(): QueryExecutionHistoryState {
    return {
        queriesActive: new Map(),
        queriesActiveOrdered: [],
        queriesFinished: new Map(),
        queriesFinishedOrdered: [],
        snapshotQueriesActiveFinished: 1,
        metrics: createQueryExecutionMetrics(),
    };
}

function metadata(queryType: QueryType, resultOwner?: string): QueryMetadata {
    return { queryType, title: null, description: null, issuer: null, userProvided: queryType == QueryType.USER_PROVIDED, resultOwner };
}

function start(state: QueryExecutionHistoryState, queryId: number, meta: QueryMetadata): QueryExecutionHistoryState {
    return reduceQueryAction(state, { type: EXECUTE_QUERY, value: [queryId, createQueryExecutionState(queryId, 0, 'select 1', meta, new AbortController())] });
}

/// Finish a started query with a one-row table
function finish(state: QueryExecutionHistoryState, queryId: number): QueryExecutionHistoryState {
    const table = arrow.tableFromArrays({ a: new Int32Array([queryId]) });
    state = reduceQueryAction(state, { type: QUERY_RECEIVED_BATCH, value: [queryId, table.batches[0], createQueryResponseStreamMetrics()] });
    state = reduceQueryAction(state, { type: QUERY_RECEIVED_ALL_BATCHES, value: [queryId, table, new Map(), createQueryResponseStreamMetrics()] });
    return reduceQueryAction(state, { type: QUERY_SUCCEEDED, value: [queryId] });
}

function succeed(state: QueryExecutionHistoryState, queryId: number, meta: QueryMetadata): QueryExecutionHistoryState {
    return finish(start(state, queryId, meta), queryId);
}

describe('finished queries', () => {
    it('keep the result table of user queries but not their batches', () => {
        const state = succeed(history(), 1, metadata(QueryType.USER_PROVIDED));
        const query = state.queriesFinished.get(1)!;
        expect(query.resultTable?.numRows).toBe(1);
        expect(query.resultBatches).toEqual([]);
    });

    it('keep only the metrics of internal queries', () => {
        const state = succeed(history(), 1, metadata(QueryType.CATALOG_QUERY_INFORMATION_SCHEMA));
        expect(state.queriesFinished.get(1)?.resultTable).toBeNull();
        expect(state.queriesFinished.get(1)?.metrics.querySucceededAt).not.toBeNull();
    });

    it('keep the latest result of an owner', () => {
        let state = history();
        state = succeed(state, 1, metadata(QueryType.USER_PROVIDED, 's/1'));
        state = succeed(state, 2, metadata(QueryType.USER_PROVIDED, 's/2'));
        state = succeed(state, 3, metadata(QueryType.USER_PROVIDED, 's/1'));
        expect(state.queriesFinished.get(1)?.resultTable).toBeNull();
        expect(state.queriesFinished.get(2)?.resultTable).not.toBeNull();
        expect(state.queriesFinished.get(3)?.resultTable).not.toBeNull();

        // An earlier query of the owner that finishes later does not replace the later result
        state = start(state, 4, metadata(QueryType.USER_PROVIDED, 's/1'));
        state = succeed(state, 5, metadata(QueryType.USER_PROVIDED, 's/1'));
        state = finish(state, 4);
        expect(state.queriesFinished.get(3)?.resultTable).toBeNull();
        expect(state.queriesFinished.get(4)?.resultTable).toBeNull();
        expect(state.queriesFinished.get(5)?.resultTable).not.toBeNull();
    });

    it('keep the result of an owner when a later query fails', () => {
        let state = succeed(history(), 1, metadata(QueryType.USER_PROVIDED, 's/1'));
        state = start(state, 2, metadata(QueryType.USER_PROVIDED, 's/1'));
        state = reduceQueryAction(state, { type: QUERY_FAILED, value: [2, new LoggableException('failed', {}, 'test'), null] });
        expect(state.queriesFinished.get(1)?.resultTable).not.toBeNull();
    });

    it('keep a bounded history of internal queries', () => {
        let state = succeed(history(), 0, metadata(QueryType.USER_PROVIDED));
        for (let i = 1; i <= INTERNAL_QUERY_HISTORY_LIMIT + 10; ++i) {
            state = succeed(state, i, metadata(QueryType.INTERNAL_SQLFRAME));
        }
        expect(state.queriesFinished.size).toBe(INTERNAL_QUERY_HISTORY_LIMIT + 1);
        expect(state.queriesFinishedOrdered.length).toBe(INTERNAL_QUERY_HISTORY_LIMIT + 1);
        // The user query stays, the oldest internal queries leave
        expect(state.queriesFinishedOrdered[0]).toBe(0);
        expect(state.queriesFinished.has(1)).toBe(false);
        expect(state.queriesFinished.has(INTERNAL_QUERY_HISTORY_LIMIT + 10)).toBe(true);
    });
});
