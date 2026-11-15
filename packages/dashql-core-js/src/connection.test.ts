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

const USER_QUERY: dashql.DashQLQueryMetadata = {
    queryType: 0,
    title: null,
    description: null,
    issuer: null,
    userProvided: true,
    resultOwner: 'alpha',
};

function hyper(): dashql.DashQLConnection {
    return dql!.createConnection('main', dashql.DashQLConnectorType.HYPER, {
        setupParams: { protocol: 'WASM', endpoint: '' },
    });
}

describe('DashQL connections', () => {
    it('apply the steps of a setup and keep the channel by its id', () => {
        const connection = hyper();
        expect(connection.snapshot().params).toEqual({ hyper: { protocol: 'WASM', endpoint: '' } });
        const revision = connection.revision();
        expect(connection.hyperChannelSetupStarted({ protocol: 'WASM', endpoint: '' }, 1000).effects).toEqual([]);
        expect(connection.hyperChannelReady(7, { protocol: 'WASM', endpoint: '' }, 2000).changed).toBe(true);
        const snapshot = connection.snapshot();
        expect(snapshot.revision).toBeGreaterThan(revision);
        expect(snapshot.health).toBe(3);
        expect(snapshot.active).toBe(true);
        expect(snapshot.details.channel).toBe(7);
        expect(snapshot.details.setupTimings).toEqual({ channelSetupStartedAt: 1000, channelReadyAt: 2000 });
        // A reset closes the channel and stops the connection
        expect(connection.reset().effects).toEqual([
            { type: 'cancelSetup' },
            { type: 'invalidateCatalogBatch' },
            { type: 'stopQueries', queryIds: [] },
            { type: 'closeChannel', channel: 7 },
        ]);
        expect(connection.snapshot().health).toBe(0);
    });

    it('track queries and release the result tables that nothing shows', () => {
        const connection = hyper();
        expect(connection.executeQuery(1, 0, 'select 1', USER_QUERY, 10).changed).toBe(true);
        connection.querySending(1, 11);
        connection.queryReceivedAllBatches(1, 100, 3, METRICS, 12);
        connection.querySucceeded(1, 15);
        expect(connection.queries()).toMatchObject({ active: [], finished: [[1, expect.any(Number)]] });
        expect(connection.query(1)).toMatchObject({ status: 9, resultTable: { id: 100, rows: 3 }, metrics: { queryRequestedAt: 10, querySucceededAt: 15 } });
        expect(connection.queries().metrics.successfulQueries.totalRowsReceived).toBe(3);

        // A later result of the same owner releases the earlier one
        connection.executeQuery(2, 0, 'select 2', USER_QUERY, 20);
        connection.queryReceivedAllBatches(2, 101, 1, METRICS, 21);
        expect(connection.querySucceeded(2, 22).effects).toEqual([{ type: 'releaseResultTable', queryId: 1, tableId: 100 }]);

        // Stopping the connection drops the queries
        connection.executeQuery(3, 0, 'select 3', USER_QUERY, 30);
        const snapshot = connection.queries().snapshot;
        expect(connection.delete().effects).toEqual([
            { type: 'cancelSetup' },
            { type: 'invalidateCatalogBatch' },
            { type: 'stopQueries', queryIds: [3] },
            { type: 'releaseResultTable', queryId: 2, tableId: 101 },
        ]);
        expect(connection.queries()).toMatchObject({ active: [], finished: [] });
        expect(connection.queries().snapshot).toBeGreaterThan(snapshot);
        expect(connection.functionScriptText()).toBeNull();
    });

    it('share their catalog with one handle', () => {
        const connection = hyper();
        const catalog = connection.catalog;
        expect(connection.catalog).toBe(catalog);
        const snapshot = connection.snapshot();
        // The connection allocated its entries in the shared catalog
        const script = dql!.createScript(catalog);
        expect(script.getCatalogEntryId()).not.toBe(snapshot.relationEntryId);
        expect(script.getCatalogEntryId()).not.toBe(snapshot.functionScriptEntryId);
        script.replaceText('create table t (a int)');
        script.analyze();
        catalog.loadScript(script, dashql.buffers.catalog.CatalogLayer.CONNECTION);
        const version = catalog.version();
        expect(version).toBeGreaterThan(0);
        // A reset clears the catalog that the handle shows
        connection.reset();
        expect(catalog.version()).toBeGreaterThan(version);
        expect(catalog.containsEntryId(script.getCatalogEntryId())).toBe(false);
    });

    it('keep the text of the function script and the catalog updates', () => {
        const connection = hyper();
        expect(connection.functionScriptText()).toContain('DashQL Connection Functions');
        connection.replaceFunctionScriptText('create function f() returns int;');
        expect(connection.functionScriptText()).toBe('create function f() returns int;');
        const relation = { databaseName: 'hyper', schemaName: 'public', tableName: 't' };
        connection.updateCatalog(1, 1, 5, [relation]);
        expect(connection.snapshot().catalogUpdates.tasksRunning).toMatchObject([{ taskId: 1, variant: 1, status: 0, startedAt: 5 }]);
        connection.catalogUpdateFinished(1, 2, { message: 'down' });
        expect(connection.snapshot().catalogUpdates).toMatchObject({
            tasksRunning: [],
            tasksFinished: [{ taskId: 1, status: 2, error: { message: 'down' } }],
            touchedRelations: [relation],
            touchedFailures: 1,
        });
        connection.restoreCatalogUpdates(true, []);
        expect(connection.snapshot().catalogUpdates).toMatchObject({ described: true, touchedRelations: [] });
    });
});
