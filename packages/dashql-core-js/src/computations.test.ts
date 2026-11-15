import * as dashql from './index.js';

import { loadCoreWasm } from './test_fixture.js';

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await loadCoreWasm() });
});
afterEach(() => {
    dql!.resetUnsafe();
});

const SCORE: dashql.ComputationColumnGroup = {
    type: 'ORDINAL',
    inputFieldName: 'score',
    inputFieldType: 'Float64',
    inputFieldNullable: true,
    statsFields: null,
    binFieldName: '_score_bin',
    binCount: 16,
};
const GROUPS: dashql.ComputationColumnGroup[] = [{ type: 'ROWNUMBER', rowNumberFieldName: 'rownum' }, SCORE];
const TABLE = { id: 100, rows: 4 };

/// Table 1 of the Arrow table 100 with the data frame 1, the lifetime 7
function withTable(): dashql.DashQLComputations {
    const computations = dql!.createComputations();
    expect(computations.computationFromQueryResult(1, TABLE, ['rownum', 'score'], GROUPS, 7, 'main', null).changed).toBe(true);
    expect(computations.createdDataFrame(1, 1).changed).toBe(true);
    return computations;
}

describe('DashQL computations', () => {
    it('take the tables that the host registers and hand them out as Arrow IPC', () => {
        const computations = withTable();
        const ipc = computations.arrowTableIpc(100);
        expect(ipc.length).toBeGreaterThan(0);
        const id = computations.registerArrowTable(ipc);
        expect(computations.systemColumnsSucceeded(1, { id }, 2, GROUPS, 1000).changed).toBe(true);
        expect(computations.computationSnapshot(1).dataTable).toEqual({ id, rows: 0 });
        expect(computations.arrowTableIds()).toEqual([id]);
        // A registered table that no action took goes with the next action
        const unused = computations.registerArrowTable(ipc);
        computations.clearTableOrdering(1);
        expect(computations.holdsArrowTable(unused)).toBe(false);
        expect(() => computations.registerArrowTable(new Uint8Array([1, 2, 3]))).toThrow();
        computations.destroy();
    });

    it('start a computation and read it as a snapshot', () => {
        const computations = withTable();
        expect(computations.tableIds()).toEqual([1]);
        const snapshot = computations.computationSnapshot(1);
        expect(snapshot).toMatchObject({
            tableId: 1,
            connectionId: 'main',
            lifetime: 7,
            version: { data: 1, filter: 0 },
            dataTable: { id: 100 },
            dataFrame: 1,
            filterTable: null,
            columnAggregates: [null, null],
            filteredColumnAggregatesOutdated: [false, false],
        });
        expect(snapshot.revision).toBe(computations.computationRevision(1));
        expect(computations.computationRevision(2)).toBeNull();
        computations.destroy();
    });

    it('schedule a filtering for the next filter version and track its progress', () => {
        const computations = withTable();
        const scheduled = computations.scheduleTask({
            kind: 'tableFiltering',
            tableId: 1,
            tableVersion: { data: 1, filter: 0 },
            inputDataTable: TABLE,
            inputDataFrame: 1,
            rowNumberColumnName: 'rownum',
            filters: [{ fieldName: '_score_bin', op: '>=', value: 3 }],
        }, 1000);
        expect(scheduled.taskId).toBe(1);
        expect(computations.nextTaskId()).toBe(2);
        expect(computations.schedulerTaskIds()).toEqual([1]);
        expect(computations.schedulerTaskSnapshot(1)).toEqual({ tableId: 1, version: { data: 1, filter: 1 } });
        expect(computations.computationSnapshot(1).tasks.filtering).toEqual({
            taskId: 1,
            version: { data: 1, filter: 1 },
            progress: { status: 1, startedAt: 1000, completedAt: null, failedAt: null, failedWithError: null },
        });

        computations.updateSchedulerTask(1, { status: 3, failedAt: 1001, failedWithError: 'boom' }, 1001);
        expect(computations.computationSnapshot(1).tasks.filtering?.progress).toMatchObject({ status: 3, failedAt: 1001, failedWithError: 'boom' });
        expect(computations.unregisterSchedulerTask(1).effects).toEqual([]);
        expect(computations.schedulerTaskIds()).toEqual([]);
        // The computation still tracks the task
        expect(computations.taskIds()).toEqual([1]);

        // A task of an unknown table is dropped
        expect(computations.scheduleTask({ kind: 'tableAggregation', tableId: 2, tableVersion: { data: 0, filter: 0 }, columnEntries: [], inputDataFrame: 1 }, 1002))
            .toEqual({ changed: false, effects: [], taskId: null });
        computations.destroy();
    });

    it('release the results that the state no longer holds', () => {
        const computations = withTable();
        const version = computations.computationSnapshot(1).version;
        computations.scheduleTask({
            kind: 'tableOrdering',
            tableId: 1,
            tableVersion: version,
            inputDataTable: TABLE,
            inputDataFrame: 1,
            filterTable: null,
            dataSearchTable: null,
            rowNumberColumnName: 'rownum',
            orderingConstraints: [{ field: 'score', ascending: false }],
        }, 1000);
        const ordering = (id: number, dataFrame: number): dashql.ComputationOrderingTable => ({
            inputRowNumberColumnName: 'rownum',
            orderingConstraints: [{ field: 'score', ascending: false }],
            table: { id, rows: 4 },
            dataFrame,
            version,
            dataSearchRequestId: null,
        });
        expect(computations.tableOrderingSucceeded(1, ordering(200, 2), 1001)).toEqual({ changed: true, effects: [], taskId: null });
        expect(computations.computationSnapshot(1)).toMatchObject({ orderingTable: { table: 200, dataFrame: 2 }, dataTableOrdering: [{ field: 'score', ascending: false }] });
        expect(computations.holdsDataFrame(2)).toBe(true);
        expect(computations.holdsArrowTable(200)).toBe(true);

        // A newer ordering replaces the older one
        expect(computations.tableOrderingSucceeded(1, ordering(201, 3), 1002).effects).toEqual([
            { type: 'releaseDataFrame', dataFrame: 2 },
        ]);
        // The Arrow tables go with the state
        expect(computations.holdsArrowTable(200)).toBe(false);
        // Dropping the computation aborts its lifetime and releases what it holds
        computations.unregisterSchedulerTask(1);
        expect(computations.deleteComputation(1).effects).toEqual([
            { type: 'abortComputation', tableId: 1, lifetime: 7 },
            { type: 'releaseDataFrame', dataFrame: 1 },
            { type: 'releaseDataFrame', dataFrame: 3 },
        ]);
        expect(computations.arrowTableIds()).toEqual([]);
        expect(computations.tableIds()).toEqual([]);
        computations.destroy();
    });

    it('keep the cross filters and the searches', () => {
        const computations = withTable();
        const filters: dashql.ComputationCrossFilter[] = [
            { column: 1, kind: 'histogram', selection: [3, 5], filters: [{ fieldName: '_score_bin', op: '>=', value: 3 }, { fieldName: '_score_bin', op: '<=', value: 5 }] },
        ];
        expect(computations.setCrossFilters(1, filters).changed).toBe(true);
        expect(computations.setCrossFilters(1, filters).changed).toBe(false);

        expect(computations.setResultSearchPattern(1, 'data', 'ann').changed).toBe(true);
        const search: dashql.ComputationDataSearchTable = {
            inputRowNumberColumnName: 'rownum', table: { id: 300, rows: 2 }, dataFrame: 4, version: { data: 1, filter: 0 }, requestId: 1,
        };
        expect(computations.dataSearchSucceeded(1, 1, 1, search, new Map([[2, [1]], [4, [0, 1]]]), 1000).changed).toBe(true);
        expect(computations.computationSnapshot(1)).toMatchObject({
            dataSearchTable: { table: 300, requestId: 1 },
            dataSearch: { appliedPattern: 'ann', appliedRequestId: 1, hasMatchingRows: true, pending: false },
        });
        // Ending the search drops its rows
        expect(computations.setResultSearchPattern(1, 'data', '').effects).toEqual([
            { type: 'releaseDataFrame', dataFrame: 4 },
        ]);
        expect(computations.computationSnapshot(1).dataSearch.hasMatchingRows).toBe(false);
        computations.destroy();
    });
});
