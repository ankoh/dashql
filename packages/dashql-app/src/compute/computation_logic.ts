import * as arrow from 'apache-arrow';

import { ArrowTableFormatter } from '../view/query_result/arrow_formatter.js';
import { DataFrame, generateTableName } from './data_frame.js';
import { AsyncValue } from '../utils/async_value.js';
import { COLUMN_AGGREGATION_TASK, FILTERED_COLUMN_AGGREGATION_TASK, SYSTEM_COLUMN_COMPUTATION_TASK, TABLE_AGGREGATION_TASK, TABLE_FILTERING_TASK, TABLE_ORDERING_TASK, TaskVariant } from './computation_scheduler.js';
import { COMPUTATION_FROM_QUERY_RESULT, ComputationAction, createArrowFieldIndex, CREATED_DATA_FRAME, SCHEDULE_TASK } from './computation_state.js';
import { ColumnAggregationVariant, ColumnAggregationTask, TableAggregationTask, TableOrderingTask, TableAggregation, OrderingTable, ORDINAL_COLUMN, STRING_COLUMN, LIST_COLUMN, ColumnGroup, SKIPPED_COLUMN, OrdinalColumnAnalysis, StringColumnAnalysis, ListColumnAnalysis, ListGridColumnGroup, StringGridColumnGroup, OrdinalGridColumnGroup, BinnedValuesTable, FrequentValuesTable, SystemColumnComputationTask, ROWNUMBER_COLUMN, getGridColumnTypeName, TableFilteringTask, FilterTable, WithFilter, WithFilterEpoch } from './computation_types.js';
import { Dispatch } from '../utils/variant.js';
import { LoggableException, Logger } from '../platform/logger.js';
import { assert } from '../utils/assert.js';
import { SQLFrame } from '../sql/sqlframe_builder.js';
import { DuckDB } from '../duckdb/duckdb_api.js';

const LOG_CTX = "compute";

function isTemporalType(typeId: arrow.Type): boolean {
    switch (typeId) {
        case arrow.Type.Date:
        case arrow.Type.DateDay:
        case arrow.Type.DateMillisecond:
        case arrow.Type.Time:
        case arrow.Type.TimeSecond:
        case arrow.Type.TimeMillisecond:
        case arrow.Type.TimeMicrosecond:
        case arrow.Type.TimeNanosecond:
        case arrow.Type.Timestamp:
        case arrow.Type.TimestampSecond:
        case arrow.Type.TimestampMillisecond:
        case arrow.Type.TimestampMicrosecond:
        case arrow.Type.TimestampNanosecond:
        case arrow.Type.DurationSecond:
        case arrow.Type.DurationMillisecond:
        case arrow.Type.DurationMicrosecond:
        case arrow.Type.DurationNanosecond:
            return true;
        default:
            return false;
    }
}

/// Analyze a table.
///
/// This function computes multiple summaries for displaying the data in the table grid component.
///
/// It consists of multiple steps:
///   1) We first global table aggregates.
///      For each of the columns we compute minimum, maximum, counts and distinct counts depending on the column type.
///   2) We then compute auxiliary system columns storing the input row number and (fractional) bin values in the domain.
///   3) We then compute summary tables per column based on these bin values.
///      (For example an aggregated histogram table for ordinal columns)
///
/// On Cross-Filters:
///   One option for fast cross-filters is to pre-compute summed area tables from Dominik's Falcon paper:
///     https://osf.io/preprints/osf/szpqm_v1
///   This paper proposes to precompute a summation table to assist brushing.
///   The idea is the following:
///     A) Aggregate counts for the cube of all cross-filter dimensions (N table columns -> 2^N fields).
///        (A, B, C) -> grouping sets ((A, B, C), (A, B), (A, C), (B, C), (A), (B), (C), ())
///     B) Compute comulative sums for the aggregates.
///        When brushing, we want to compute the count between two boundaries, for which we need cumulative sums.
///     C) Cross-filtering then becomes a O(1) lookup in this cube.
///
///   Problem:
///     This is simple when doing this for ordinal columns only, where we control the dimension count.
///     For categorical columns, we have the problem that we might want to cross-filter with a *specific* distinct value.
///     Precomputing for that is infeasible with higher distinct counts, so we'll have to maintain a non-precomputed path anyway?
///     Also, 2^N is not exactly cheap for very wide tables where the user would never visibly see the cross-filter.
///
///   Alternative:
///     We do ad-hoc cross-filter computations on the pre-computed bin fields and only for what is currently visible (!).
///     The upside here is that the bin count is dictated by what we can show in the UI and is thus usually small.
///     Whenever a user updates a cross-filter (by brushing or selecting a distinct value), we just recompute the column summaries
///     with the new set of cross-filters and update the UI.
///
export async function analyzeTable(tableId: number, table: arrow.Table, dispatch: Dispatch<ComputationAction>, duckdb: DuckDB, logger: Logger): Promise<void> {
    let gridColumnGroups = buildGridColumnGroups(table!);
    const computeAbortCtrl = new AbortController();
    dispatch({
        type: COMPUTATION_FROM_QUERY_RESULT,
        value: [tableId, table!, gridColumnGroups, computeAbortCtrl]
    });

    const inputTableName = generateTableName("__input");
    let dataFrame = await DataFrame.fromArrowTable(duckdb, table, inputTableName);
    dispatch({
        type: CREATED_DATA_FRAME,
        value: [tableId, dataFrame]
    });

    const tableAggregationTask: TableAggregationTask = {
        tableId,
        tableEpoch: null,
        columnEntries: gridColumnGroups,
        inputDataFrame: dataFrame
    };
    const [tableAggregate, initialColumnGroups] = await computeTableAggregatesDispatched(tableAggregationTask, dispatch);
    gridColumnGroups = initialColumnGroups;

    const precomputationTask: SystemColumnComputationTask = {
        tableId,
        tableEpoch: null,
        columnEntries: gridColumnGroups,
        inputTable: table,
        inputDataFrame: dataFrame,
        tableAggregate
    };
    const [_newTable, newDataFrame, updatedColumnGroups] = await computeSystemColumnsDispatched(precomputationTask, dispatch);
    gridColumnGroups = updatedColumnGroups;

    for (let columnId = 0; columnId < gridColumnGroups.length; ++columnId) {
        if (gridColumnGroups[columnId].type == SKIPPED_COLUMN || gridColumnGroups[columnId].type == ROWNUMBER_COLUMN) {
            continue;
        }
        const columnAggregationTask: ColumnAggregationTask = {
            tableId,
            tableEpoch: null,
            columnId,
            tableAggregate,
            columnEntry: gridColumnGroups[columnId],
            inputDataFrame: newDataFrame,
        };
        await computeColumnAggregatesDispatched(columnAggregationTask, dispatch);
    }
}

export async function computeSystemColumnsDispatched(task: SystemColumnComputationTask, dispatch: Dispatch<ComputationAction>): Promise<[arrow.Table, DataFrame, ColumnGroup[]]> {
    const result = new AsyncValue<[arrow.Table, DataFrame, ColumnGroup[]], LoggableException>();
    const variant: TaskVariant = {
        type: SYSTEM_COLUMN_COMPUTATION_TASK,
        value: task,
        result
    };
    dispatch({
        type: SCHEDULE_TASK,
        value: variant
    });
    return result.getValue();
}

export async function computeSystemColumns(task: SystemColumnComputationTask, logger: Logger): Promise<[arrow.Table, DataFrame, ColumnGroup[]]> {
    try {
        const [sqlFrame, columnGroups] = buildSystemColumnSQLFrame(task.inputTable.schema, task.columnEntries, task.inputDataFrame.tableName, task.tableAggregate);

        const transformStart = performance.now();
        const tableName = generateTableName("__syscols");
        const transformed = await DataFrame.fromSQL(task.inputDataFrame.duckdb, sqlFrame.toSQL(), tableName);
        const transformEnd = performance.now();
        const transformedTable = await transformed.readTable();
        logger.info("precomputed system columns", {
            "duration": Math.floor(transformEnd - transformStart).toString()
        }, LOG_CTX);

        let rowNumColumnName: string | null = null;
        for (let i = 0; i < columnGroups.length; ++i) {
            const group = columnGroups[i];
            switch (group.type) {
                case ROWNUMBER_COLUMN:
                    rowNumColumnName = group.value.rowNumberFieldName;
                    break;
            }
        }
        if (!rowNumColumnName) {
            throw new LoggableException("missing rownum column group", {}, LOG_CTX);
        }
        return [transformedTable, transformed, columnGroups];

    } catch (error: any) {
        if (error instanceof LoggableException) {
            throw error;
        } else {
            throw new LoggableException("column precomputation failed", { "error": error.toString() }, LOG_CTX);
        }
    }
}

function createUniqueColumnName(prefix: string, fieldNames: Set<string>) {
    let name = prefix;
    while (true) {
        if (fieldNames.has(name)) {
            name = `_${name}`;
        } else {
            fieldNames.add(name);
            return name;
        }
    }
}

function buildSystemColumnSQLFrame(schema: arrow.Schema, columns: ColumnGroup[], inputTableName: string, tableAggregate: TableAggregation): [SQLFrame, ColumnGroup[]] {
    let fieldNames = new Set<string>();
    for (const field of schema.fields) {
        fieldNames.add(field.name);
    }

    const rowNumberFieldName = createUniqueColumnName(`_rownum`, fieldNames);
    const rowNumberGridColumn: ColumnGroup = {
        type: ROWNUMBER_COLUMN,
        value: {
            rowNumberFieldName: rowNumberFieldName
        }
    };
    let gridColumns: ColumnGroup[] = [
        rowNumberGridColumn,
        ...columns
    ];

    let frame = SQLFrame.from(inputTableName)
        .rowNumber(rowNumberFieldName);

    for (let i = 1; i <= columns.length; ++i) {
        let column = gridColumns[i];
        switch (column.type) {
            case ROWNUMBER_COLUMN:
            case SKIPPED_COLUMN:
                break;
            case ORDINAL_COLUMN: {
                const binFieldName = createUniqueColumnName(`_${i}_bin`, fieldNames);
                frame = frame.binning({
                    fieldName: column.value.inputFieldName,
                    statsTable: tableAggregate.dataFrame.tableName,
                    statsMinField: column.value.statsFields!.minAggregateFieldName!,
                    statsMaxField: column.value.statsFields!.maxAggregateFieldName!,
                    binCount: column.value.binCount,
                    outputAlias: binFieldName,
                    toNumericFn: isTemporalType(column.value.inputFieldType.typeId) ? "EPOCH" : undefined,
                });
                gridColumns[i] = {
                    type: ORDINAL_COLUMN,
                    value: {
                        ...column.value,
                        binFieldName: binFieldName,
                    }
                };
                break;
            }
            case STRING_COLUMN: {
                const valueFieldName = createUniqueColumnName(`_${i}_id`, fieldNames);
                frame = frame.valueIdentifier(column.value.inputFieldName, valueFieldName);
                gridColumns[i] = {
                    type: STRING_COLUMN,
                    value: {
                        ...column.value,
                        valueIdFieldName: valueFieldName
                    }
                };
                break;
            }
            case LIST_COLUMN: {
                const valueFieldName = createUniqueColumnName(`_${i}_id`, fieldNames);
                frame = frame.valueIdentifier(column.value.inputFieldName, valueFieldName);
                gridColumns[i] = {
                    type: LIST_COLUMN,
                    value: {
                        ...column.value,
                        valueIdFieldName: valueFieldName
                    }
                };
                break;
            }
        }
    }

    frame = frame.orderBy([{ field: rowNumberFieldName, ascending: true }]);

    return [frame, gridColumns];
}

function buildGridColumnGroups(table: arrow.Table): ColumnGroup[] {
    const columnGroups: ColumnGroup[] = [];
    for (let i = 0; i < table.schema.fields.length; ++i) {
        const field = table.schema.fields[i];
        switch (field.typeId) {
            case arrow.Type.Int:
            case arrow.Type.Int8:
            case arrow.Type.Int16:
            case arrow.Type.Int32:
            case arrow.Type.Int64:
            case arrow.Type.Uint8:
            case arrow.Type.Uint16:
            case arrow.Type.Uint32:
            case arrow.Type.Uint64:
            case arrow.Type.Float:
            case arrow.Type.Float16:
            case arrow.Type.Float32:
            case arrow.Type.Float64:
            case arrow.Type.Bool:
            case arrow.Type.Decimal:
            case arrow.Type.Date:
            case arrow.Type.DateDay:
            case arrow.Type.DateMillisecond:
            case arrow.Type.Time:
            case arrow.Type.TimeSecond:
            case arrow.Type.TimeMillisecond:
            case arrow.Type.TimeMicrosecond:
            case arrow.Type.TimeNanosecond:
            case arrow.Type.Timestamp:
            case arrow.Type.TimestampSecond:
            case arrow.Type.TimestampMillisecond:
            case arrow.Type.TimestampMicrosecond:
            case arrow.Type.TimestampNanosecond:
            case arrow.Type.DurationSecond:
            case arrow.Type.DurationMillisecond:
            case arrow.Type.DurationMicrosecond:
            case arrow.Type.DurationNanosecond:
                columnGroups.push({
                    type: ORDINAL_COLUMN,
                    value: {
                        inputFieldName: field.name,
                        inputFieldType: field.type,
                        inputFieldNullable: field.nullable,
                        statsFields: null,
                        binFieldName: null,
                        binCount: BIN_COUNT
                    }
                });
                break;
            case arrow.Type.Utf8:
            case arrow.Type.LargeUtf8:
                columnGroups.push({
                    type: STRING_COLUMN,
                    value: {
                        inputFieldName: field.name,
                        inputFieldType: field.type,
                        inputFieldNullable: field.nullable,
                        statsFields: null,
                        valueIdFieldName: null,
                    }
                });
                break;
            case arrow.Type.List:
            case arrow.Type.FixedSizeList:
                columnGroups.push({
                    type: LIST_COLUMN,
                    value: {
                        inputFieldName: field.name,
                        inputFieldType: field.type,
                        inputFieldNullable: field.nullable,
                        statsFields: null,
                        valueIdFieldName: null,
                    }
                });
                break;
            default:
                columnGroups.push({
                    type: SKIPPED_COLUMN,
                    value: {
                        inputFieldName: field.name,
                        inputFieldType: field.type,
                        inputFieldNullable: field.nullable,
                    }
                });
                break;
        }
    }
    return columnGroups;
}

export async function sortTableDispatched(task: TableOrderingTask, dispatch: Dispatch<ComputationAction>): Promise<OrderingTable> {
    const result = new AsyncValue<OrderingTable, LoggableException>();
    const variant: TaskVariant = {
        type: TABLE_ORDERING_TASK,
        value: task,
        result
    };
    dispatch({
        type: SCHEDULE_TASK,
        value: variant
    });
    return result.getValue();
}

export async function sortTable(task: TableOrderingTask, logger: Logger): Promise<OrderingTable> {
    if (task.orderingConstraints.length == 1) {
        logger.info("sorting table by field", {
            "field": task.orderingConstraints[0].field
        }, LOG_CTX);
    } else {
        logger.info("sorting table by multiple fields", {}, LOG_CTX);
    }

    try {
        let frame = SQLFrame.from(task.inputDataFrame.tableName);
        if (task.filterTable != null) {
            frame = frame.semiJoinFilter(
                task.rowNumberColumnName,
                task.filterTable.dataFrame.tableName,
                task.filterTable.dataTable.schema.fields[0].name,
            );
        }
        const sql = frame
            .orderBy(task.orderingConstraints)
            .project([task.rowNumberColumnName])
            .toSQL();

        const sortStart = performance.now();
        const tableName = generateTableName("__ordered");
        const transformed = await DataFrame.fromSQL(task.inputDataFrame.duckdb, sql, tableName);
        const sortEnd = performance.now();
        const orderedTable = await transformed.readTable();
        logger.info("sorted table", {
            "duration": Math.floor(sortEnd - sortStart).toString(),
            "inputRows": task.inputDataTable.numRows.toString(),
            "outputRows": orderedTable.numRows.toString(),
        }, LOG_CTX);
        const out: OrderingTable = {
            inputRowNumberColumnName: task.rowNumberColumnName,
            orderingConstraints: task.orderingConstraints,
            dataTable: orderedTable,
            dataFrame: transformed,
            tableEpoch: task.tableEpoch,
        };
        return out;

    } catch (error: any) {
        if (error instanceof LoggableException) {
            throw error;
        } else {
            throw new LoggableException(`sorting table failed`, { "error": error.toString() }, LOG_CTX);
        }
    }
}

export async function filterTableDispatched(task: TableFilteringTask, dispatch: Dispatch<ComputationAction>): Promise<FilterTable | null> {
    const result = new AsyncValue<FilterTable | null, LoggableException>();
    const variant: TaskVariant = {
        type: TABLE_FILTERING_TASK,
        value: task,
        result
    };
    dispatch({
        type: SCHEDULE_TASK,
        value: variant
    });
    return result.getValue();
}

export async function filterTable(task: TableFilteringTask, logger: Logger): Promise<FilterTable | null> {
    if (task.filters.length == 0) {
        return null;
    }

    try {
        let frame = SQLFrame.from(task.inputDataFrame.tableName);
        for (const f of task.filters) {
            frame = frame.filter(f.fieldName, f.op, f.value);
        }
        frame = frame.project([task.rowNumberColumnName]);
        const sql = frame.toSQL();

        const filterStart = performance.now();
        const tableName = generateTableName("__filter");
        const transformed = await DataFrame.fromSQL(task.inputDataFrame.duckdb, sql, tableName);
        const filterEnd = performance.now();
        const filterResultTable = await transformed.readTable();

        logger.info("filtered table", {
            "duration": Math.floor(filterEnd - filterStart).toString(),
            "inputRows": task.inputDataTable.numRows.toString(),
            "outputRows": filterResultTable.numRows.toString(),
        }, LOG_CTX);

        const out: FilterTable = {
            inputRowNumberColumnName: task.rowNumberColumnName,
            dataTable: filterResultTable,
            dataFrame: transformed,
            tableEpoch: task.tableEpoch,
        };
        return out;

    } catch (error: any) {
        if (error instanceof LoggableException) {
            throw error;
        } else {
            throw new LoggableException(`filtering table failed`, { "error": error.toString() }, LOG_CTX);
        }
    }
}

export async function computeTableAggregatesDispatched(task: TableAggregationTask, dispatch: Dispatch<ComputationAction>): Promise<[TableAggregation, ColumnGroup[]]> {
    const result = new AsyncValue<[TableAggregation, ColumnGroup[]], LoggableException>();
    const variant: TaskVariant = {
        type: TABLE_AGGREGATION_TASK,
        value: task,
        result
    };
    dispatch({
        type: SCHEDULE_TASK,
        value: variant
    });
    return result.getValue();
}

export async function computeTableAggregates(task: TableAggregationTask, logger: Logger): Promise<[TableAggregation, ColumnGroup[]]> {
    const [sql, columnEntries, countStarColumn] = buildTableAggregationSQL(task);

    try {
        const summaryStart = performance.now();
        const tableName = generateTableName("__tbl_agg");
        const transformedDataFrame = await DataFrame.fromSQL(task.inputDataFrame.duckdb, sql, tableName);
        const summaryEnd = performance.now();
        logger.info("aggregated table", {
            "table": task.tableId.toString(),
            "duration": Math.floor(summaryEnd - summaryStart).toString()
        }, LOG_CTX);

        const statsTable = await transformedDataFrame.readTable();
        const statsTableFields = createArrowFieldIndex(statsTable);
        const statsTableFormatter = new ArrowTableFormatter(statsTable.schema, statsTable.batches, logger);

        const summary: TableAggregation = {
            table: statsTable,
            tableFormatter: statsTableFormatter,
            tableFieldsByName: statsTableFields,
            dataFrame: transformedDataFrame,
            countStarFieldName: countStarColumn,
        };
        return [summary, columnEntries];

    } catch (error: any) {
        if (error instanceof LoggableException) {
            throw error;
        } else {
            throw new LoggableException("computing aggregate failed", {
                "table": task.tableId.toString(),
                "error": error.toString()
            }, LOG_CTX);
        }
    }
}

function buildTableAggregationSQL(task: TableAggregationTask): [string, ColumnGroup[], string] {
    const countColumn = `_count`;
    const aggregates: { fieldName?: string; outputAlias: string; func: "min" | "max" | "count" | "count_star"; distinct?: boolean }[] = [];

    aggregates.push({ outputAlias: `_count`, func: "count_star" });

    const updatedEntries: ColumnGroup[] = [];
    for (let i = 0; i < task.columnEntries.length; ++i) {
        const entry = task.columnEntries[i];
        switch (entry.type) {
            case SKIPPED_COLUMN:
            case ROWNUMBER_COLUMN:
                updatedEntries.push(entry);
                break;
            case ORDINAL_COLUMN: {
                const countAggregateColumn = `_${i}_count`;
                const minAggregateColumn = `_${i}_min`;
                const maxAggregateColumn = `_${i}_max`;
                aggregates.push({ fieldName: entry.value.inputFieldName, outputAlias: countAggregateColumn, func: "count" });
                aggregates.push({ fieldName: entry.value.inputFieldName, outputAlias: minAggregateColumn, func: "min" });
                aggregates.push({ fieldName: entry.value.inputFieldName, outputAlias: maxAggregateColumn, func: "max" });
                updatedEntries.push({
                    type: ORDINAL_COLUMN,
                    value: {
                        ...entry.value,
                        statsFields: {
                            countFieldName: countAggregateColumn,
                            distinctCountFieldName: null,
                            minAggregateFieldName: minAggregateColumn,
                            maxAggregateFieldName: maxAggregateColumn,
                        }
                    }
                });
                break;
            }
            case STRING_COLUMN: {
                const countAggregateColumn = `_${i}_count`;
                const countDistinctAggregateColumn = `_${i}_countd`;
                aggregates.push({ fieldName: entry.value.inputFieldName, outputAlias: countAggregateColumn, func: "count" });
                aggregates.push({ fieldName: entry.value.inputFieldName, outputAlias: countDistinctAggregateColumn, func: "count", distinct: true });
                updatedEntries.push({
                    type: STRING_COLUMN,
                    value: {
                        ...entry.value,
                        statsFields: {
                            countFieldName: countAggregateColumn,
                            distinctCountFieldName: countDistinctAggregateColumn,
                            minAggregateFieldName: null,
                            maxAggregateFieldName: null,
                        }
                    }
                });
                break;
            }
            case LIST_COLUMN: {
                const countAggregateColumn = `_${i}_count`;
                const countDistinctAggregateColumn = `_${i}_countd`;
                aggregates.push({ fieldName: entry.value.inputFieldName, outputAlias: countAggregateColumn, func: "count" });
                aggregates.push({ fieldName: entry.value.inputFieldName, outputAlias: countDistinctAggregateColumn, func: "count", distinct: true });
                updatedEntries.push({
                    type: LIST_COLUMN,
                    value: {
                        ...entry.value,
                        statsFields: {
                            countFieldName: countAggregateColumn,
                            distinctCountFieldName: countDistinctAggregateColumn,
                            minAggregateFieldName: null,
                            maxAggregateFieldName: null,
                        }
                    }
                });
                break;
            }
        }
    }

    const sql = SQLFrame.from(task.inputDataFrame.tableName)
        .groupBy({
            keys: [],
            aggregates,
        })
        .toSQL();
    return [sql, updatedEntries, countColumn];
}

function analyzeOrdinalColumn(tableSummary: TableAggregation, columnEntry: OrdinalGridColumnGroup, binnedValues: BinnedValuesTable, binnedValuesFormatter: ArrowTableFormatter): OrdinalColumnAnalysis {
    const totalCountVector = tableSummary.table.getChild(tableSummary.countStarFieldName!) as arrow.Vector<arrow.Int64>;

    const totalCount = Number(totalCountVector.get(0) ?? BigInt(0));
    const minFieldId = tableSummary.tableFieldsByName.get(columnEntry.statsFields!.minAggregateFieldName!)!;
    const maxFieldId = tableSummary.tableFieldsByName.get(columnEntry.statsFields!.maxAggregateFieldName!)!;
    const minValue = tableSummary.tableFormatter.getValue(0, minFieldId) ?? "";
    const maxValue = tableSummary.tableFormatter.getValue(0, maxFieldId) ?? "";

    assert(binnedValues.schema.fields[0].name == "bin");
    assert(binnedValues.schema.fields[1].name == "count");
    assert(binnedValues.schema.fields[3].name == "binLowerBound");
    const binIdVector = binnedValues.getChildAt(0) as arrow.Vector<arrow.Uint32>;
    const binCountVector = binnedValues.getChildAt(1) as arrow.Vector<arrow.Int64>;

    const nullBinRowIdx = binnedValues.numRows - 1;
    const nullBinId = Number(binIdVector.get(nullBinRowIdx) ?? -1);
    assert(binnedValues.numRows === (BIN_COUNT + 1));
    assert(nullBinId === BIN_COUNT);

    const countNull = Number(binCountVector.get(nullBinRowIdx) ?? BigInt(0));
    const countNotNull = totalCount - countNull;

    const regularBinCount = BIN_COUNT;
    const binLowerBounds: string[] = [];
    const binPercentages = new Float64Array(regularBinCount);
    const regularBinValueCounts = new BigInt64Array(regularBinCount);

    const isTemporal = isTemporalType(columnEntry.inputFieldType.typeId);
    const temporalFmt = isTemporal ? Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'medium' }) : null;
    const lbCol = isTemporal ? binnedValues.getChildAt(3)! : null;

    for (let i = 0; i < regularBinCount; ++i) {
        const binCount = binCountVector.get(i) ?? BigInt(0);
        let binLB: string;
        if (isTemporal && lbCol) {
            const epochMs = lbCol.get(i);
            binLB = epochMs == null ? "" : temporalFmt!.format(new Date(epochMs));
        } else {
            binLB = binnedValuesFormatter.getValue(i, 3) ?? "";
        }
        const binPercentage = (totalCount == 0) ? 0 : (Number(binCount) / totalCount);
        binLowerBounds.push(binLB);
        binPercentages[i] = binPercentage;
        regularBinValueCounts[i] = binCount;
    }

    return {
        countNotNull: countNotNull,
        countNull: countNull,
        minValue: minValue,
        maxValue: maxValue,
        binCount: regularBinCount,
        binValueCounts: regularBinValueCounts,
        binPercentages: binPercentages,
        binLowerBounds: binLowerBounds,
    };
}

function analyzeStringColumn(tableSummary: TableAggregation, columnEntry: StringGridColumnGroup, frequentValueTable: FrequentValuesTable, frequentValuesFormatter: ArrowTableFormatter): StringColumnAnalysis {
    const totalCountVector = tableSummary.table.getChild(tableSummary.countStarFieldName!) as arrow.Vector<arrow.Int64>;
    const notNullCountVector = tableSummary.table.getChild(columnEntry.statsFields!.countFieldName) as arrow.Vector<arrow.Int64>;
    const distinctCountVector = tableSummary.table.getChild(columnEntry.statsFields!.distinctCountFieldName!) as arrow.Vector<arrow.Int64>;

    const totalCount = Number(totalCountVector.get(0) ?? BigInt(0));
    const notNullCount = Number(notNullCountVector.get(0) ?? BigInt(0));
    const distinctCount = Number(distinctCountVector.get(0) ?? BigInt(0));

    assert(frequentValueTable.schema.fields[0].name == "key");
    assert(frequentValueTable.getChild("count") != null);

    const frequentValueCounts = frequentValueTable.getChild("count")!.toArray();
    const frequentValuePercentages = new Float64Array(frequentValueTable.numRows);
    const frequentValueStrings = [];
    for (let i = 0; i < frequentValueTable.numRows; ++i) {
        frequentValuePercentages[i] = totalCount == 0 ? 0 : (Number(frequentValueCounts[i]) / totalCount);
        frequentValueStrings.push(frequentValuesFormatter.getValue(i, 0));
    }

    const keyIdColumn = (frequentValueTable as arrow.Table).getChild("keyId");
    if (keyIdColumn == null) {
        throw new Error("missing keyId column in frequent values table");
    }
    const frequentValueIds = keyIdColumn.toArray() as BigInt64Array;

    return {
        countNotNull: notNullCount,
        countNull: totalCount - notNullCount,
        countDistinct: distinctCount,
        isUnique: notNullCount == distinctCount,
        frequentValueStrings: frequentValueStrings,
        frequentValueIds: frequentValueIds,
        frequentValueCounts: frequentValueCounts,
        frequentValuePercentages: frequentValuePercentages,
    };
}

function analyzeListColumn(tableSummary: TableAggregation, columnEntry: ListGridColumnGroup, frequentValueTable: FrequentValuesTable): ListColumnAnalysis {
    const totalCountVector = tableSummary.table.getChild(tableSummary.countStarFieldName!) as arrow.Vector<arrow.Int64>;
    const notNullCountVector = tableSummary.table.getChild(columnEntry.statsFields!.countFieldName) as arrow.Vector<arrow.Int64>;
    const distinctCountVector = tableSummary.table.getChild(columnEntry.statsFields!.distinctCountFieldName!) as arrow.Vector<arrow.Int64>;

    const totalCount = Number(totalCountVector.get(0) ?? BigInt(0));
    const notNullCount = Number(notNullCountVector.get(0) ?? BigInt(0));
    const distinctCount = Number(distinctCountVector.get(0) ?? BigInt(0));

    assert(frequentValueTable.schema.fields[0].name == "key");
    assert(frequentValueTable.schema.fields[1].name == "count");

    const frequentValueIsNull = new Uint8Array(frequentValueTable.numRows);
    const frequentValueKeys = frequentValueTable.getChild("key")!;
    const frequentValueCounts = frequentValueTable.getChild("count")!.toArray();
    const frequentValuePercentages = new Float64Array(frequentValueTable.numRows);
    for (let i = 0; i < frequentValueTable.numRows; ++i) {
        frequentValuePercentages[i] = totalCount == 0 ? 0 : (Number(frequentValueCounts[i]) / totalCount);
        if (frequentValueKeys.nullable) {
            for (let i = 0; i < frequentValueTable.numRows; ++i) {
                frequentValueIsNull[i] = frequentValueKeys.isValid(i) ? 0 : 1;
            }
        }
    }

    return {
        countNotNull: Number(notNullCount),
        countNull: Number(totalCount - notNullCount),
        countDistinct: Number(distinctCount),
        isUnique: notNullCount == distinctCount,
        frequentValueIsNull: frequentValueIsNull,
        frequentValueCounts: frequentValueCounts,
        frequentValuePercentages: frequentValuePercentages,
    };
}

export async function computeColumnAggregatesDispatched(task: ColumnAggregationTask, dispatch: Dispatch<ComputationAction>): Promise<ColumnAggregationVariant> {
    const result = new AsyncValue<ColumnAggregationVariant, LoggableException>();
    const variant: TaskVariant = {
        type: COLUMN_AGGREGATION_TASK,
        value: task,
        result
    };
    dispatch({
        type: SCHEDULE_TASK,
        value: variant
    });
    return result.getValue();
}

export async function computeFilteredColumnAggregatesDispatched(task: WithFilter<ColumnAggregationTask>, dispatch: Dispatch<ComputationAction>): Promise<WithFilterEpoch<ColumnAggregationVariant> | null> {
    const result = new AsyncValue<WithFilterEpoch<ColumnAggregationVariant> | null, LoggableException>();
    const variant: TaskVariant = {
        type: FILTERED_COLUMN_AGGREGATION_TASK,
        value: task,
        result
    };
    dispatch({
        type: SCHEDULE_TASK,
        value: variant
    });
    return result.getValue();
}

export async function computeColumnAggregates(task: ColumnAggregationTask, logger: Logger): Promise<ColumnAggregationVariant> {
    if (task.columnEntry.type == SKIPPED_COLUMN || task.columnEntry.type == ROWNUMBER_COLUMN) {
        throw new LoggableException(`Column of type cannot be aggregated`, {
            type: getGridColumnTypeName(task.columnEntry),
        }, LOG_CTX);
    }

    const sql = buildColumnAggregationSQL(task);

    try {
        const transformStart = performance.now();
        const tableName = generateTableName("__col_agg");
        const aggregateDataFrame = await DataFrame.fromSQL(task.inputDataFrame.duckdb, sql, tableName);
        const transformEnd = performance.now();
        logger.info("aggregated table column", {
            "table": task.tableId.toString(),
            "columnIndex": task.columnId.toString(),
            "columnName": task.columnEntry.value.inputFieldName,
            "groupType": getGridColumnTypeName(task.columnEntry),
            "duration": Math.floor(transformEnd - transformStart).toString()
        }, LOG_CTX);

        const aggregateTable = await aggregateDataFrame.readTable();
        const aggregateTableFormatter = new ArrowTableFormatter(aggregateTable.schema, aggregateTable.batches, logger);

        let columnAggregate: ColumnAggregationVariant;
        switch (task.columnEntry.type) {
            case ORDINAL_COLUMN: {
                const analysis = analyzeOrdinalColumn(task.tableAggregate, task.columnEntry.value, aggregateTable, aggregateTableFormatter);
                columnAggregate = {
                    type: ORDINAL_COLUMN,
                    value: {
                        columnEntry: task.columnEntry.value,
                        binnedDataFrame: aggregateDataFrame,
                        binnedValues: aggregateTable,
                        binnedValuesFormatter: aggregateTableFormatter,
                        columnAnalysis: analysis,
                    }
                };
                break;
            }
            case STRING_COLUMN: {
                const analysis = analyzeStringColumn(task.tableAggregate, task.columnEntry.value, aggregateTable, aggregateTableFormatter);
                columnAggregate = {
                    type: STRING_COLUMN,
                    value: {
                        columnEntry: task.columnEntry.value,
                        frequentValuesDataFrame: aggregateDataFrame,
                        frequentValuesTable: aggregateTable,
                        frequentValuesFormatter: aggregateTableFormatter,
                        analysis,
                    }
                };
                break;
            }
            case LIST_COLUMN: {
                const analysis = analyzeListColumn(task.tableAggregate, task.columnEntry.value, aggregateTable);
                columnAggregate = {
                    type: LIST_COLUMN,
                    value: {
                        columnEntry: task.columnEntry.value,
                        frequentValuesDataFrame: aggregateDataFrame,
                        frequentValuesTable: aggregateTable,
                        frequentValuesFormatter: aggregateTableFormatter,
                        analysis,
                    }
                };
                break;
            }
        }
        return columnAggregate;

    } catch (error: any) {
        if (error instanceof LoggableException) {
            throw error;
        } else {
            const exception = new LoggableException("computing column aggregate failed", {
                "table": task.tableId.toString(),
                "error": error.toString(),
            }, LOG_CTX);
            logger.exception(exception);
            throw exception;
        }
    }
}

export const BIN_COUNT = 16;

function buildColumnAggregationSQL(task: ColumnAggregationTask, filtered: [FilterTable, ColumnAggregationVariant] | null = null): string {
    if (task.columnEntry.type == SKIPPED_COLUMN || task.columnEntry.type == ROWNUMBER_COLUMN || task.columnEntry.value.statsFields == null) {
        throw new Error("column summary requires precomputed table summary");
    }

    let frame = SQLFrame.from(task.inputDataFrame.tableName);

    if (filtered != null) {
        const filterTable = filtered[0];
        frame = frame.semiJoinFilter(
            filterTable.inputRowNumberColumnName,
            filterTable.dataFrame.tableName,
            filterTable.dataTable.schema.fields[0].name
        );
    }

    const targetFieldName = task.columnEntry.value.inputFieldName;

    switch (task.columnEntry.type) {
        case ORDINAL_COLUMN: {
            const minField = task.columnEntry.value.statsFields.minAggregateFieldName!;
            const maxField = task.columnEntry.value.statsFields.maxAggregateFieldName!;
            frame = frame.groupBy({
                keys: [{
                    fieldName: targetFieldName,
                    outputAlias: "bin",
                    binning: {
                        preBinnedFieldName: task.columnEntry.value.binFieldName ?? undefined,
                        statsTable: task.tableAggregate.dataFrame.tableName,
                        statsMinField: minField,
                        statsMaxField: maxField,
                        binCount: BIN_COUNT,
                        outputBinWidthAlias: "binWidth",
                        outputBinLbAlias: "binLowerBound",
                        outputBinUbAlias: "binUpperBound",
                        includeNullBin: true,
                        toNumericFn: isTemporalType(task.columnEntry.value.inputFieldType.typeId) ? "EPOCH" : undefined,
                    }
                }],
                aggregates: [{
                    func: "count_star",
                    outputAlias: "count",
                }]
            }).orderBy([{ field: "bin", ascending: true }]);
            break;
        }
        case STRING_COLUMN: {
            if (task.columnEntry.value.valueIdFieldName == null) {
                throw new Error("cannot aggregate string column without precomputed value id");
            }
            frame = frame.groupBy({
                keys: [
                    { fieldName: targetFieldName, outputAlias: "key" },
                    { fieldName: task.columnEntry.value.valueIdFieldName, outputAlias: "keyId" },
                ],
                aggregates: [{
                    func: "count_star",
                    outputAlias: "count",
                }]
            }).orderBy([{ field: "count", ascending: false }], 32);
            break;
        }
        case LIST_COLUMN: {
            frame = frame.groupBy({
                keys: [
                    { fieldName: targetFieldName, outputAlias: "key" },
                ],
                aggregates: [{
                    func: "count_star",
                    outputAlias: "count",
                }]
            }).orderBy([{ field: "count", ascending: false }], 32);
            break;
        }
    }

    return frame.toSQL();
}

export async function computeFilteredColumnAggregates(task: WithFilter<ColumnAggregationTask>, logger: Logger): Promise<WithFilterEpoch<ColumnAggregationVariant> | null> {
    if (task.columnEntry.type == SKIPPED_COLUMN || task.columnEntry.type == ROWNUMBER_COLUMN) {
        throw new LoggableException(`Column of type cannot be aggregated`, {
            type: getGridColumnTypeName(task.columnEntry),
        }, LOG_CTX);
    }

    const sql = buildColumnAggregationSQL(task, [task.filterTable, task.unfilteredAggregate]);

    try {
        const transformStart = performance.now();
        const tableName = generateTableName("__filt_col_agg");
        const aggregateDataFrame = await DataFrame.fromSQL(task.inputDataFrame.duckdb, sql, tableName);
        const transformEnd = performance.now();
        logger.info("aggregated filtered table column", {
            "table": task.tableId.toString(),
            "columnIndex": task.columnId.toString(),
            "columnName": task.columnEntry.value.inputFieldName,
            "groupType": getGridColumnTypeName(task.columnEntry),
            "duration": Math.floor(transformEnd - transformStart).toString()
        }, LOG_CTX);

        const aggregateTable = await aggregateDataFrame.readTable();
        const aggregateTableFormatter = new ArrowTableFormatter(aggregateTable.schema, aggregateTable.batches, logger);

        let columnAggregate: WithFilterEpoch<ColumnAggregationVariant>;
        switch (task.columnEntry.type) {
            case ORDINAL_COLUMN: {
                const analysis = analyzeOrdinalColumn(task.tableAggregate, task.columnEntry.value, aggregateTable, aggregateTableFormatter);
                columnAggregate = {
                    type: ORDINAL_COLUMN,
                    value: {
                        columnEntry: task.columnEntry.value,
                        binnedDataFrame: aggregateDataFrame,
                        binnedValues: aggregateTable,
                        binnedValuesFormatter: aggregateTableFormatter,
                        columnAnalysis: analysis,
                    },
                    filterTableEpoch: task.filterTable.tableEpoch,
                };
                break;
            }
            case STRING_COLUMN: {
                const analysis = analyzeStringColumn(task.tableAggregate, task.columnEntry.value, aggregateTable, aggregateTableFormatter);
                columnAggregate = {
                    type: STRING_COLUMN,
                    value: {
                        columnEntry: task.columnEntry.value,
                        frequentValuesDataFrame: aggregateDataFrame,
                        frequentValuesTable: aggregateTable,
                        frequentValuesFormatter: aggregateTableFormatter,
                        analysis,
                    },
                    filterTableEpoch: task.filterTable.tableEpoch,
                };
                break;
            }
            case LIST_COLUMN: {
                const analysis = analyzeListColumn(task.tableAggregate, task.columnEntry.value, aggregateTable);
                columnAggregate = {
                    type: LIST_COLUMN,
                    value: {
                        columnEntry: task.columnEntry.value,
                        frequentValuesDataFrame: aggregateDataFrame,
                        frequentValuesTable: aggregateTable,
                        frequentValuesFormatter: aggregateTableFormatter,
                        analysis,
                    },
                    filterTableEpoch: task.filterTable.tableEpoch,
                };
                break;
            }
        }
        return columnAggregate;

    } catch (error: any) {
        if (error instanceof LoggableException) {
            throw error;
        } else {
            const exception = new LoggableException("computing filtered column aggregate failed", {
                "table": task.tableId.toString(),
                "columnIndex": task.columnId.toString(),
                "columnName": task.columnEntry.value.inputFieldName,
                "error": error.toString(),
            }, LOG_CTX);
            logger.exception(exception);
            throw exception;
        }
    }
}
