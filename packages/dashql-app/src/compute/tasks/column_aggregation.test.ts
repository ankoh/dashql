import * as arrow from 'apache-arrow';
import { describe, expect, it, vi } from 'vitest';

import { TestLogger } from '../../platform/logger/test_logger.js';
import { ArrowTableFormatter } from '../arrow_formatter.js';
import type { ComputeQueryExecution } from '../computation_tasks.js';
import {
    ColumnAggregationTask,
    ColumnAggregationVariant,
    type ColumnGroup,
    ComputationStateVersion,
    DataSearchTable,
    FilterTable,
    LIST_COLUMN,
    ORDINAL_COLUMN,
    STRING_COLUMN,
    WithFilter,
} from '../computation_types.js';
import { executeReturning, mockDataFrame as frame } from '../../tests/mocks/compute_query.js';
import { computeFilteredColumnAggregates } from './column_aggregation.js';

/// The table aggregate with the stats of the string column name (_0) and the ordinal column score (_1)
const statsTable = arrow.tableFromArrays({
    _count_star: BigInt64Array.from([10n]),
    _0_count: BigInt64Array.from([8n]),
    _0_distinct: BigInt64Array.from([3n]),
    _1_count: BigInt64Array.from([9n]),
    _1_min: Float64Array.from([1]),
    _1_max: Float64Array.from([9]),
});
const NAME: ColumnGroup = {
    type: STRING_COLUMN,
    value: {
        inputFieldName: 'name',
        inputFieldType: new arrow.Utf8(),
        inputFieldNullable: true,
        statsFields: { countFieldName: '_0_count', distinctCountFieldName: '_0_distinct', minAggregateFieldName: null, maxAggregateFieldName: null },
        valueIdFieldName: 'name_id',
    },
};
const SCORE: ColumnGroup = {
    type: ORDINAL_COLUMN,
    value: {
        inputFieldName: 'score',
        inputFieldType: new arrow.Float64(),
        inputFieldNullable: true,
        statsFields: { countFieldName: '_1_count', distinctCountFieldName: null, minAggregateFieldName: '_1_min', maxAggregateFieldName: '_1_max' },
        binFieldName: null,
        binCount: 2,
    },
};

/// A filtered aggregation task of the column, filtered by a cross-filter and a data search
function filteredTask(columnEntry: ColumnGroup = NAME): WithFilter<ColumnAggregationTask> {
    return {
        tableId: 1,
        tableVersion: new ComputationStateVersion(1, 2),
        columnId: 0,
        columnEntry,
        inputDataFrame: frame('input'),
        tableAggregate: {
            dataFrame: frame('stats'),
            table: statsTable,
            tableFieldsByName: new Map(statsTable.schema.fields.map((field, index) => [field.name, index])),
            tableFormatter: new ArrowTableFormatter(statsTable.schema, statsTable.batches, new TestLogger()),
            countStarFieldName: '_count_star',
        },
        filterTable: { inputRowNumberColumnName: 'rownum', dataFrame: frame('filter'), dataTable: arrow.tableFromArrays({ row: Int32Array.from([0]) }) } as unknown as FilterTable,
        dataSearchTable: { inputRowNumberColumnName: 'rownum', dataFrame: frame('search'), dataTable: arrow.tableFromArrays({ row_idx: Int32Array.from([0]) }) } as unknown as DataSearchTable,
        selectionRowCount: 5,
        unfilteredAggregate: {} as ColumnAggregationVariant,
    };
}

describe('computeFilteredColumnAggregates', () => {
    it('counts the frequent values of the selected rows', async () => {
        const { executeQuery } = executeReturning(arrow.tableFromArrays({
            key: ['a', 'b'],
            keyId: BigInt64Array.from([1n, 2n]),
            count: BigInt64Array.from([4n, 2n]),
        }));
        const result = await computeFilteredColumnAggregates(filteredTask(), new TestLogger(), executeQuery);

        const sql = vi.mocked(executeQuery).mock.calls[0][0];
        expect(sql).toContain('filter');
        expect(sql).toContain('search');
        expect(result?.type).toEqual(STRING_COLUMN);
        expect(result?.filterVersion).toEqual(new ComputationStateVersion(1, 2));
        const analysis = result?.type === STRING_COLUMN ? result.value.analysis : null;
        expect(analysis).toMatchObject({ totalCount: 5, countNotNull: 8, countNull: 2, countDistinct: 3, frequentValueStrings: ['a', 'b'] });
        expect([...analysis!.frequentValuePercentages]).toEqual([0.8, 0.4]);
    });

    it('counts the bins of the selected rows', async () => {
        const { executeQuery } = executeReturning(arrow.tableFromArrays({
            bin: Int32Array.from([0, 1, 2]),
            count: BigInt64Array.from([3n, 1n, 1n]),
            binWidth: Float64Array.from([4, 4, 0]),
            binLowerBound: Float64Array.from([1, 5, 0]),
            binUpperBound: Float64Array.from([5, 9, 0]),
        }));
        const result = await computeFilteredColumnAggregates(filteredTask(SCORE), new TestLogger(), executeQuery);
        expect(result?.type).toEqual(ORDINAL_COLUMN);
        const analysis = result?.type === ORDINAL_COLUMN ? result.value.columnAnalysis : null;
        expect(analysis).toMatchObject({ totalCount: 5, countNull: 1, minValue: '1', maxValue: '9' });
        expect([...analysis!.binValueCounts]).toEqual([3n, 1n]);
    });

    it('rejects columns that cannot be aggregated', async () => {
        const task = { ...filteredTask(), columnEntry: { type: LIST_COLUMN, value: {} } } as WithFilter<ColumnAggregationTask>;
        await expect(computeFilteredColumnAggregates(task, new TestLogger(), executeReturning(statsTable).executeQuery)).rejects.toThrow('cannot be aggregated');
    });

    it('wraps failing queries', async () => {
        const executeQuery = vi.fn(async () => { throw new Error('query failed'); }) as unknown as ComputeQueryExecution;
        await expect(computeFilteredColumnAggregates(filteredTask(), new TestLogger(), executeQuery)).rejects.toThrow('Failed to compute filtered column aggregate');
    });
});
