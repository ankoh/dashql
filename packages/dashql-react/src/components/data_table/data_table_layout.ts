import * as arrow from 'apache-arrow';

import { ArrowTableFormatter } from "@akohn/dashql/platform/compute/arrow_formatter";
import type { ComputationColumnGroup } from '@akohn/dashql';
import { LIST_COLUMN, ORDINAL_COLUMN, ROWNUMBER_COLUMN, SKIPPED_COLUMN, STRING_COLUMN } from "@akohn/dashql/platform/compute/computation_types";

export interface DataTableLayout {
    columnCount: number;
    arrowFieldByColumnIndex: Uint32Array;
    columnXOffsets: Float64Array;
    columnAggregateByColumnIndex: Int32Array;
    columnGroupByColumnIndex: Uint32Array;
    isTextColumn: Uint8Array;
    headerRowCount: number;
}

const MAX_VALUE_COLUMN_WIDTH = 300;
export const MIN_COLUMN_WIDTH = 120;
const COLUMN_HEADER_ACTION_WIDTH = 24;
export const ROW_HEADER_WIDTH = 48;
const FORMATTER_PIXEL_SCALING = 10;

function computeColumnCount(columnGroups: ComputationColumnGroup[], visibleColumnGroups?: ReadonlySet<number> | null): number {
    let columnCount = 0;
    for (let groupIndex = 0; groupIndex < columnGroups.length; ++groupIndex) {
        const columnGroup = columnGroups[groupIndex];
        if (columnGroup.type !== ROWNUMBER_COLUMN && visibleColumnGroups != null && !visibleColumnGroups.has(groupIndex)) {
            continue;
        }
        if (columnGroup.type !== SKIPPED_COLUMN) {
            ++columnCount;
        }
    }
    return columnCount;
}

/// What the layout of a table reads: its column groups and the table
export interface DataTableLayoutInput {
    columnGroups: ComputationColumnGroup[];
    dataTable: arrow.Table;
}

export function computeTableLayout(formatter: ArrowTableFormatter, state: DataTableLayoutInput, headerRowCount: number, containerWidth: number = 0, visibleColumnGroups?: ReadonlySet<number> | null, resizedColumnWidths?: ReadonlyMap<string, number> | null): DataTableLayout {
    // Index table fields by name
    const tableSchema = state.dataTable.schema;
    const fieldIndexByName = new Map<string, number>();
    for (let i = 0; i < tableSchema.fields.length; ++i) {
        fieldIndexByName.set(tableSchema.fields[i].name, i);
    }

    // Allocate column offsets
    const columnCount = computeColumnCount(state.columnGroups, visibleColumnGroups);
    const columnFields = new Uint32Array(columnCount);
    const columnOffsets = new Float64Array(columnCount + 1);
    const columnAggregateIndex = new Int32Array(columnCount);
    const columnGroupByColumnIndex = new Uint32Array(columnCount);
    const isTextColumn = new Uint8Array(columnCount);

    for (let i = 0; i < columnCount; ++i) {
        columnAggregateIndex[i] = -1;
    }

    // Allocate column offsets
    let nextDisplayColumn = 0;
    let nextDisplayOffset = 0;
    for (let groupIndex = 0; groupIndex < state.columnGroups.length; ++groupIndex) {
        const columnGroup = state.columnGroups[groupIndex];
        if (columnGroup.type !== ROWNUMBER_COLUMN && visibleColumnGroups != null && !visibleColumnGroups.has(groupIndex)) {
            continue;
        }
        switch (columnGroup.type) {
            case ROWNUMBER_COLUMN: {
                const outputIndex = nextDisplayColumn++;
                columnFields[outputIndex] = fieldIndexByName.get(columnGroup.value.rowNumberFieldName)!;
                columnOffsets[outputIndex] = nextDisplayOffset;
                columnGroupByColumnIndex[outputIndex] = groupIndex;
                nextDisplayOffset += ROW_HEADER_WIDTH;
                break;
            }
            case SKIPPED_COLUMN:
                break;
            case ORDINAL_COLUMN:
            case STRING_COLUMN:
            case LIST_COLUMN: {
                const outputIndex = nextDisplayColumn++;
                const valueColumnFormatter = formatter.columns[fieldIndexByName.get(columnGroup.value.inputFieldName)!];
                let valueColumnWidth = Math.max(
                    COLUMN_HEADER_ACTION_WIDTH + Math.max(
                        valueColumnFormatter.getLayoutInfo().valueAvgWidth,
                        valueColumnFormatter.getColumnName().length) * FORMATTER_PIXEL_SCALING,
                    MIN_COLUMN_WIDTH
                );
                valueColumnWidth = Math.min(valueColumnWidth, MAX_VALUE_COLUMN_WIDTH);
                columnFields[outputIndex] = fieldIndexByName.get(columnGroup.value.inputFieldName)!;
                columnOffsets[outputIndex] = nextDisplayOffset;
                columnAggregateIndex[outputIndex] = groupIndex;
                columnGroupByColumnIndex[outputIndex] = groupIndex;
                nextDisplayOffset += valueColumnWidth;
                break;
            }
        }
    }
    columnOffsets[nextDisplayColumn] = nextDisplayOffset;

    // Mark text columns for format peek hints
    for (let i = 0; i < nextDisplayColumn; ++i) {
        const typeId = tableSchema.fields[columnFields[i]].type.typeId;
        if (typeId === arrow.Type.Utf8 || typeId === arrow.Type.LargeUtf8) {
            isTextColumn[i] = 1;
        }
    }

    // Replace the widths of the columns that the user resized, keyed by field name
    const isResizedColumn = new Uint8Array(columnCount);
    if (resizedColumnWidths != null && resizedColumnWidths.size > 0) {
        let naturalStart = columnOffsets[0];
        for (let i = 0; i < nextDisplayColumn; ++i) {
            const naturalEnd = columnOffsets[i + 1];
            const resizedWidth = resizedColumnWidths.get(tableSchema.fields[columnFields[i]].name);
            let width = naturalEnd - naturalStart;
            if (resizedWidth !== undefined) {
                width = resizedWidth;
                isResizedColumn[i] = 1;
            }
            columnOffsets[i + 1] = columnOffsets[i] + width;
            naturalStart = naturalEnd;
        }
        nextDisplayOffset = columnOffsets[nextDisplayColumn];
    }

    // If columns don't fill the container, distribute extra space across data columns (not row-number or resized columns)
    if (containerWidth > 0 && nextDisplayOffset < containerWidth) {
        const stretchesColumn = (i: number) => isResizedColumn[i] == 0
            && state.columnGroups[columnGroupByColumnIndex[i]].type !== ROWNUMBER_COLUMN;
        let dataColumnCount = 0;
        for (let i = 0; i < nextDisplayColumn; ++i) {
            if (stretchesColumn(i)) {
                dataColumnCount++;
            }
        }
        if (dataColumnCount > 0) {
            const extraPerColumn = (containerWidth - nextDisplayOffset) / dataColumnCount;
            let accumulatedExtra = 0;
            for (let i = 0; i < nextDisplayColumn; ++i) {
                if (stretchesColumn(i)) {
                    accumulatedExtra += extraPerColumn;
                }
                columnOffsets[i + 1] += accumulatedExtra;
            }
        }
    }

    return {
        columnCount,
        arrowFieldByColumnIndex: columnFields,
        columnXOffsets: columnOffsets,
        columnAggregateByColumnIndex: columnAggregateIndex,
        columnGroupByColumnIndex: columnGroupByColumnIndex,
        isTextColumn: isTextColumn,
        headerRowCount
    };
}
