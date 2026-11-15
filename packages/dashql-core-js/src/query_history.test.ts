import * as dashql from './index.js';

import { loadCoreWasm } from './test_fixture.js';

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await loadCoreWasm() });
});
afterEach(() => {
    dql!.resetUnsafe();
});

const METRICS: dashql.DashQLStreamMetrics = {
    totalDataBytesReceived: 0,
    totalBatchesReceived: 1,
    totalRowsReceived: 3,
    totalQueryRequestsStarted: 1,
    totalQueryRequestsSucceeded: 1,
    totalQueryRequestsFailed: 0,
    totalQueryRequestDurationMs: 5,
    durationUntilFirstBatchMs: 2,
};

const SHELL_QUERY: dashql.DashQLQueryMetadata = {
    queryType: 0,
    title: 'Shell Query',
    description: null,
    issuer: 'DashQL Shell',
    userProvided: true,
};

describe('DashQL query histories', () => {
    it('track the queries like a connection', () => {
        const history = dql!.createQueryHistory();
        expect(history.executeQuery(1, 1, 'select 1', SHELL_QUERY, 10).changed).toBe(true);
        history.queryRunning(1, 11);
        expect(history.queryReceivedAllBatches(1, 100, 3, METRICS, 12).effects).toEqual([]);
        history.querySucceeded(1, 15);
        expect(history.queries()).toMatchObject({ active: [], finished: [[1, expect.any(Number)]] });
        expect(history.query(1)).toMatchObject({ status: 9, resultTable: { id: 100, rows: 3 }, metrics: { queryRequestedAt: 10, querySucceededAt: 15, queryDurationMs: 4 } });
        // A late action changes nothing
        const revision = history.revision();
        expect(history.queryFailed(1, 'late', null, null, 20).changed).toBe(false);
        expect(history.revision()).toBe(revision);
        history.destroy();
    });

    it('drop the oldest queries beyond their limit and release their tables', () => {
        const history = dql!.createQueryHistory(2);
        history.executeQuery(1, 1, 'select 1', SHELL_QUERY, 10);
        history.queryReceivedAllBatches(1, 100, 3, METRICS, 11);
        history.querySucceeded(1, 12);
        history.executeQuery(2, 2, 'select 2', SHELL_QUERY, 13);
        expect(history.executeQuery(3, 3, 'select 3', SHELL_QUERY, 14).effects).toEqual([
            { type: 'releaseResultTable', queryId: 1, tableId: 100 },
        ]);
        expect(history.queries()).toMatchObject({ active: [[2, expect.any(Number)], [3, expect.any(Number)]], finished: [] });
        expect(history.query(1)).toBeNull();
        history.destroy();
    });
});
