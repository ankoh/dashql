
import { appendRowNumbers, buildGridColumnGroups } from '../analyze_table.js';
import { ComputationStateVersion } from '../computation_types.js';
import { DataFrame } from '../data_frame.js';
import { computeSystemColumns } from './system_columns.js';
import { computeTableAggregates } from './table_aggregation.js';
import { openTestHyperDB } from '../../testing/test_hyperdb.js';
import type { HyperDB } from '../../platform/hyperdb/hyperdb_wasm.js';
import { TestLogger } from '../../testing/test_logger.js';
import { tableFromArrays } from '../../testing/arrow_fixtures.js';

describe('computeSystemColumns', () => {
    let database: HyperDB | null = null;

    beforeEach(async () => {
        database = await openTestHyperDB('system_columns_test');
    }, 60_000);

    afterEach(async () => {
        await database?.terminate();
    });

    it('keeps the order of the rows of the input', async () => {
        // Hyper numbers the rows of a table of 20 rows or more in another order with row_number() OVER ()
        const queries = Array.from({ length: 100 }, (_, i) => `select ${String.fromCharCode(97 + (i * 7) % 26)} from t${i}`);
        const table = tableFromArrays({
            query: queries,
            total_ms: Float64Array.from(queries, (_, i) => 10_000 - i * 100),
        });
        const logger = new TestLogger();
        const [numberedTable, rowNumberFieldName] = appendRowNumbers(table);
        const inputDataFrame = await DataFrame.fromArrowTable(database!, numberedTable, 'input');
        const tableVersion = new ComputationStateVersion(0, 0);
        const [tableAggregate, columnEntries] = await computeTableAggregates({
            tableId: 1,
            tableVersion,
            columnEntries: buildGridColumnGroups(table),
            inputDataFrame,
        }, logger);

        const [result] = await computeSystemColumns({
            tableId: 1,
            tableVersion,
            columnEntries,
            inputTable: table,
            inputDataFrame,
            rowNumberFieldName,
            tableAggregate,
        }, logger);

        expect(result.toArray().map(row => row.query)).toEqual(queries);
        expect(result.toArray().map(row => row[rowNumberFieldName])).toEqual(queries.map((_, i) => BigInt(i + 1)));
    });
});
