import * as arrow from 'apache-arrow';

import { appendRowNumbers } from '../analyze_table.js';
import { createArrowFieldIndex } from '../computation_state.js';
import { ComputationStateVersion } from '../computation_types.js';
import { DataFrame } from '../data_frame.js';
import { filterTable } from './table_filtering.js';
import { setupWebHyperDB } from '../../platform/hyperdb/hyperdb_provider_web.js';
import { HyperDB } from '../../platform/hyperdb/hyperdb_wasm.js';
import { TestLogger } from '../../platform/logger/test_logger.js';

describe('filterTable', () => {
    let database: HyperDB | null = null;

    beforeEach(async () => {
        database = await setupWebHyperDB('table_filtering_test', new TestLogger());
    }, 60_000);

    afterEach(async () => {
        await database?.terminate();
    });

    it('lists the rows of the filter in the order of the input', async () => {
        const values = Float64Array.from({ length: 100 }, (_, i) => (i * 37) % 100);
        const [table, rowNumberFieldName] = appendRowNumbers(arrow.tableFromArrays({ value: values }));
        const inputDataFrame = await DataFrame.fromArrowTable(database!, table, 'input');

        const filter = await filterTable({
            tableId: 1,
            tableVersion: new ComputationStateVersion(0, 0),
            inputDataTable: table,
            inputDataTableFieldIndex: createArrowFieldIndex(table),
            inputDataFrame,
            rowNumberColumnName: rowNumberFieldName,
            filters: [{ fieldName: 'value', op: '>=', value: 50 }],
        }, new TestLogger());

        const expected = Array.from(values, (value, i) => value >= 50 ? BigInt(i + 1) : null).filter(rowNumber => rowNumber != null);
        expect(filter!.dataTable.toArray().map(row => row[rowNumberFieldName])).toEqual(expected);
    });
});
