import * as arrow from 'apache-arrow';

import { ArrowTableFormatter } from '../compute/arrow_formatter.js';
import type {
    ColumnAggregationVariant,
    ComputationStateVersion,
    OrdinalColumnAggregation,
    StringColumnAggregation,
    SummaryColumn,
    TableAggregation,
    WithFilterEpoch,
} from '../compute/computation_types.js';
import { TestLogger } from './test_logger.js';

// The summaries of a column as the app resolves them from the views of the runtime (computation_types.ts), built from
// the bins or the frequent values that the summary query returns. The runtime computes the numbers
// (`packages/dashql-core-runtime/src/compute`), the plots read only these objects.

/// The statistics of a table
export function tableAggregation(table: arrow.Table, countStarFieldName: string): TableAggregation {
    return {
        table,
        tableFieldsByName: new Map(table.schema.fields.map((field, i) => [field.name, i])),
        tableFormatter: new ArrowTableFormatter(table.schema, table.batches, new TestLogger()),
        countStarFieldName,
    };
}

/// A value column of a summary
export function summaryColumn(name: string, inputFieldType: arrow.DataType, fields: Partial<SummaryColumn> = {}): SummaryColumn {
    return {
        inputFieldName: name,
        inputFieldType,
        inputFieldNullable: true,
        statsFields: null,
        binFieldName: null,
        binCount: 0,
        valueIdFieldName: null,
        ...fields,
    };
}

/// The number of rows of the statistics of a table
function rowCount(table: TableAggregation): number {
    return Number((table.table.getChild(table.countStarFieldName) as arrow.Vector<arrow.Int64>).get(0) ?? 0n);
}

/// The summary of an ordinal column from its bins: `bin`, `count`, `binWidth`, `binLowerBound`, `binUpperBound`, the
/// last bin holds the null values. `selectionRowCount` is the number of the selected rows of a filtered summary.
export function ordinalAggregate(table: TableAggregation, column: SummaryColumn, bins: arrow.Table, selectionRowCount: number | null = null): OrdinalColumnAggregation {
    const formatter = new ArrowTableFormatter(bins.schema, bins.batches, new TestLogger());
    const rows = rowCount(table);
    const totalCount = selectionRowCount ?? rows;
    const counts = bins.getChild('count') as arrow.Vector<arrow.Int64>;
    const countNull = Number(counts.get(bins.numRows - 1) ?? 0n);
    const statistic = (field: string | null) => table.tableFormatter.getValue(0, table.tableFieldsByName.get(field!)!) ?? '';
    const binValueCounts = new BigInt64Array(column.binCount);
    const binPercentages = new Float64Array(column.binCount);
    const binLowerBounds: string[] = [];
    for (let i = 0; i < column.binCount; ++i) {
        binValueCounts[i] = counts.get(i) ?? 0n;
        binPercentages[i] = totalCount == 0 ? 0 : Number(binValueCounts[i]) / totalCount;
        binLowerBounds.push(formatter.getValue(i, 3) ?? '');
    }
    return {
        columnEntry: column,
        binnedValues: bins as never,
        binnedValuesFormatter: formatter,
        columnAnalysis: {
            totalCount,
            countNotNull: rows - countNull,
            countNull,
            minValue: statistic(column.statsFields!.minAggregateFieldName),
            maxValue: statistic(column.statsFields!.maxAggregateFieldName),
            binCount: column.binCount,
            binValueCounts,
            binPercentages,
            binLowerBounds,
        },
    };
}

/// The summary of a string column from its frequent values: `key`, `keyId` and `count`, most frequent first
export function stringAggregate(table: TableAggregation, column: SummaryColumn, frequentValues: arrow.Table, selectionRowCount: number | null = null): StringColumnAggregation {
    const formatter = new ArrowTableFormatter(frequentValues.schema, frequentValues.batches, new TestLogger());
    const rows = rowCount(table);
    const totalCount = selectionRowCount ?? rows;
    const countOf = (field: string | null) => Number((table.table.getChild(field!) as arrow.Vector<arrow.Int64>).get(0) ?? 0n);
    const notNull = countOf(column.statsFields!.countFieldName);
    const distinct = countOf(column.statsFields!.distinctCountFieldName);
    const frequentValueCounts = frequentValues.getChild('count')!.toArray() as BigInt64Array;
    const frequentValueStrings: (string | null)[] = [];
    for (let i = 0; i < frequentValues.numRows; ++i) {
        frequentValueStrings.push(formatter.getValue(i, 0));
    }
    return {
        columnEntry: column,
        frequentValuesTable: frequentValues as never,
        frequentValuesFormatter: formatter,
        analysis: {
            totalCount,
            countNotNull: notNull,
            countNull: rows - notNull,
            countDistinct: distinct,
            isUnique: notNull == distinct,
            frequentValueStrings,
            frequentValueIds: frequentValues.getChild('keyId')!.toArray() as BigInt64Array,
            frequentValueCounts,
            frequentValuePercentages: Float64Array.from(frequentValueCounts, count => totalCount == 0 ? 0 : Number(count) / totalCount),
        },
    };
}

/// A summary among the selected rows, computed for a version of the filters
export function filteredAggregate(aggregate: ColumnAggregationVariant, filterVersion: ComputationStateVersion = { data: 1, filter: 1 }, dataSearchRequestId: number | null = null): WithFilterEpoch<ColumnAggregationVariant> {
    return { ...aggregate, filterVersion, dataSearchRequestId };
}
