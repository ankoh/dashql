import { TableComputationState } from "../../compute/computation_state.js";
import { ArrowTableFormatter } from "./arrow_formatter.js";
import { GridColumnGroup, LIST_COLUMN, ORDINAL_COLUMN, ROWNUMBER_COLUMN, SKIPPED_COLUMN, STRING_COLUMN } from "../../compute/computation_types.js";

export interface DataTableLayout {
    columnCount: number;
    columnFields: Uint32Array;
    columnOffsets: Float64Array;
    columnSummaryIds: Int32Array;
    columnGroups: Uint32Array;
    isSystemColumn: Uint8Array;
    headerRowCount: number;
}

const MAX_VALUE_COLUMN_WIDTH = 300;
const MIN_COLUMN_WIDTH = 120;
const COLUMN_HEADER_ACTION_WIDTH = 24;
const ROW_HEADER_WIDTH = 48;
const FORMATTER_PIXEL_SCALING = 10;

function computeColumnCount(columnGroups: GridColumnGroup[], showMetaColumns: boolean): number {
    let columnCount = 0;
    for (const columnGroup of columnGroups) {
        switch (columnGroup.type) {
            case ROWNUMBER_COLUMN:
                ++columnCount;
                break;
            case SKIPPED_COLUMN:
                break;
            case STRING_COLUMN:
            case LIST_COLUMN:
                ++columnCount;
                if (showMetaColumns && columnGroup.value.valueIdFieldName != null) {
                    ++columnCount;
                }
                break;
            case ORDINAL_COLUMN:
                ++columnCount;
                if (showMetaColumns && columnGroup.value.binFieldId != null) {
                    ++columnCount;
                }
                break;
        }
    }
    return columnCount;
}

export function computeTableLayout(formatter: ArrowTableFormatter, state: TableComputationState, showSystemColumns: boolean, headerRowCount: number): DataTableLayout {
    // Allocate column offsets
    let columnCount = computeColumnCount(state.columnGroups, showSystemColumns);
    const columnFields = new Uint32Array(columnCount);
    const columnOffsets = new Float64Array(columnCount + 1);
    const columnSummaryIndex = new Int32Array(columnCount);
    const columnGroups = new Uint32Array(columnCount);
    const isSystemColumn = new Uint8Array(columnCount);
    const tableSchema = state.dataTable.schema;

    // Index table fields by name
    const fieldIndexByName = new Map<string, number>();
    for (let i = 0; i < tableSchema.fields.length; ++i) {
        fieldIndexByName.set(tableSchema.fields[i].name, i);
    }

    for (let i = 0; i < columnCount; ++i) {
        columnSummaryIndex[i] = -1;
    }

    // Allocate column offsets
    let nextDisplayColumn = 0;
    let nextDisplayOffset = 0;
    for (let groupIndex = 0; groupIndex < state.columnGroups.length; ++groupIndex) {
        const columnGroup = state.columnGroups[groupIndex];
        switch (columnGroup.type) {
            case ROWNUMBER_COLUMN: {
                const columnId = nextDisplayColumn++;
                columnFields[columnId] = fieldIndexByName.get(columnGroup.value.rowNumberFieldName)!;
                columnOffsets[columnId] = nextDisplayOffset;
                columnGroups[columnId] = groupIndex;
                nextDisplayOffset += ROW_HEADER_WIDTH;
                break;
            }
            case SKIPPED_COLUMN:
                break;
            case ORDINAL_COLUMN:
                const valueColumnId = nextDisplayColumn++;
                const valueColumnFormatter = formatter.columns[fieldIndexByName.get(columnGroup.value.inputFieldName)!];
                let valueColumnWidth = Math.max(
                    COLUMN_HEADER_ACTION_WIDTH + Math.max(
                        valueColumnFormatter.getLayoutInfo().valueAvgWidth,
                        valueColumnFormatter.getColumnName().length) * FORMATTER_PIXEL_SCALING,
                    MIN_COLUMN_WIDTH
                );
                valueColumnWidth = Math.min(valueColumnWidth, MAX_VALUE_COLUMN_WIDTH);
                columnFields[valueColumnId] = fieldIndexByName.get(columnGroup.value.inputFieldName)!;
                columnOffsets[valueColumnId] = nextDisplayOffset;
                columnSummaryIndex[valueColumnId] = groupIndex;
                columnGroups[valueColumnId] = groupIndex;
                nextDisplayOffset += valueColumnWidth;
                if (showSystemColumns && columnGroup.value.binFieldId != null) {
                    const idColumnId = nextDisplayColumn++;
                    const idColumn = formatter.columns[columnGroup.value.binFieldId];
                    const idColumnWidth = Math.max(
                        COLUMN_HEADER_ACTION_WIDTH + Math.max(
                            idColumn.getLayoutInfo().valueAvgWidth,
                            idColumn.getColumnName().length) * FORMATTER_PIXEL_SCALING,
                        MIN_COLUMN_WIDTH
                    );
                    columnFields[idColumnId] = columnGroup.value.binFieldId;
                    columnOffsets[idColumnId] = nextDisplayOffset;
                    columnGroups[idColumnId] = groupIndex;
                    isSystemColumn[idColumnId] = 1;
                    nextDisplayOffset += idColumnWidth;
                }
                break;
            case STRING_COLUMN:
            case LIST_COLUMN: {
                const valueColumnId = nextDisplayColumn++;
                const valueColumnFormatter = formatter.columns[fieldIndexByName.get(columnGroup.value.inputFieldName)!];
                let valueColumnWidth = Math.max(
                    COLUMN_HEADER_ACTION_WIDTH + Math.max(
                        valueColumnFormatter.getLayoutInfo().valueAvgWidth,
                        valueColumnFormatter.getColumnName().length) * FORMATTER_PIXEL_SCALING,
                    MIN_COLUMN_WIDTH
                );
                valueColumnWidth = Math.min(valueColumnWidth, MAX_VALUE_COLUMN_WIDTH);
                columnFields[valueColumnId] = fieldIndexByName.get(columnGroup.value.inputFieldName)!;
                columnOffsets[valueColumnId] = nextDisplayOffset;
                columnSummaryIndex[valueColumnId] = groupIndex;
                columnGroups[valueColumnId] = groupIndex;
                nextDisplayOffset += valueColumnWidth;
                if (showSystemColumns && columnGroup.value.valueIdFieldName != null) {
                    const idColumnId = nextDisplayColumn++;
                    const idColumn = formatter.columns[fieldIndexByName.get(columnGroup.value.valueIdFieldName)!];
                    const idColumnWidth = Math.max(
                        COLUMN_HEADER_ACTION_WIDTH + Math.max(
                            idColumn.getLayoutInfo().valueAvgWidth,
                            idColumn.getColumnName().length) * FORMATTER_PIXEL_SCALING,
                        MIN_COLUMN_WIDTH
                    );
                    columnFields[idColumnId] = fieldIndexByName.get(columnGroup.value.valueIdFieldName)!;
                    columnOffsets[idColumnId] = nextDisplayOffset;
                    columnGroups[idColumnId] = groupIndex;
                    isSystemColumn[idColumnId] = 1;
                    nextDisplayOffset += idColumnWidth;
                }
                break;
            }
        }
    }
    columnOffsets[nextDisplayColumn] = nextDisplayOffset;

    return {
        columnCount,
        columnFields,
        columnOffsets,
        columnSummaryIds: columnSummaryIndex,
        columnGroups,
        isSystemColumn: isSystemColumn,
        headerRowCount
    };
}

export function skipTableLayoutUpdate(old: DataTableLayout, next: DataTableLayout) {
    if (old.columnOffsets.length != next.columnOffsets.length) {
        return false;
    }
    for (let i = 0; i < old.columnOffsets.length; ++i) {
        const delta = next.columnOffsets[i] - old.columnOffsets[i];
        if (delta > 0.01) {
            return false;
        }
    }
    return true;
}
