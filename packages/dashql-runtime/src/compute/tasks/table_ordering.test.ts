
import { appendRowNumbers } from '../analyze_table.js';
import { createArrowFieldIndex } from '../computation_state.js';
import { ComputationStateVersion } from '../computation_types.js';
import { DataFrame } from '../data_frame.js';
import { sortTable } from './table_ordering.js';
import { openTestHyperDB } from '../../testing/test_hyperdb.js';
import type { HyperDB } from '../../platform/hyperdb/hyperdb_wasm.js';
import { TestLogger } from '../../testing/test_logger.js';
import { tableFromArrays } from '../../testing/arrow_fixtures.js';

describe('sortTable', () => {
    let database: HyperDB | null = null;

    beforeEach(async () => {
        database = await openTestHyperDB('table_ordering_test');
    }, 60_000);

    afterEach(async () => {
        await database?.terminate();
    });

    it('orders the rows by the constraints and equal rows by their row number', async () => {
        const groups = Int32Array.from({ length: 100 }, (_, i) => (i * 7) % 5);
        const [table, rowNumberFieldName] = appendRowNumbers(tableFromArrays({ group: groups }));
        const inputDataFrame = await DataFrame.fromArrowTable(database!, table, 'input');

        const ordering = await sortTable({
            tableId: 1,
            tableVersion: new ComputationStateVersion(0, 0),
            inputDataTable: table,
            inputDataTableFieldIndex: createArrowFieldIndex(table),
            inputDataFrame,
            filterTable: null,
            dataSearchTable: null,
            rowNumberColumnName: rowNumberFieldName,
            orderingConstraints: [{ field: 'group', ascending: false }],
        }, new TestLogger());

        const expected = Array.from(groups, (group, i) => ({ group, rowNumber: i + 1 }))
            .sort((l, r) => r.group - l.group || l.rowNumber - r.rowNumber)
            .map(row => BigInt(row.rowNumber));
        expect(ordering.dataTable.schema.fields.map(field => field.name)).toEqual([rowNumberFieldName]);
        expect(ordering.dataTable.toArray().map(row => row[rowNumberFieldName])).toEqual(expected);
    });
});
