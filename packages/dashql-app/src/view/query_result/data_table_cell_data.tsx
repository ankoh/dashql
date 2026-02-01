import * as arrow from 'apache-arrow';
import * as React from 'react';
import * as styles from './data_table.module.css';

import type { CellComponentProps } from 'react-window';

import { ArrowTableFormatter } from './arrow_formatter.js';
import { ColumnGroup } from '../../compute/computation_types.js';
import { DataTableLayout } from './data_table_layout.js';

/// ---------------------------------------------------------------------------
/// Data Cell
/// ---------------------------------------------------------------------------

export interface DataCellData {
    columnGroups: ColumnGroup[];
    dataFilter: arrow.Vector<arrow.Uint64> | null;
    focusedField: number | null;
    focusedRow: number | null;
    gridLayout: DataTableLayout;
    isBrushing: boolean;
    table: arrow.Table;
    tableFormatter: ArrowTableFormatter;
    onMouseEnter: (event: React.PointerEvent<HTMLDivElement>) => void;
    onMouseLeave: (event: React.PointerEvent<HTMLDivElement>) => void;
}

export function DataCell(props: CellComponentProps<DataCellData>): React.ReactElement | null {
    if (props.columnIndex >= props.gridLayout.arrowFieldByColumnIndex.length) {
        return <div style={props.style} />;
    }
    const fieldId = props.gridLayout.arrowFieldByColumnIndex[props.columnIndex];
    let dataRow = props.rowIndex;

    // Translate the row index through the filter table, if there is one
    if (props.dataFilter != null) {
        dataRow = Math.max(Number(props.dataFilter.get(dataRow)), 1) - 1;
    }

    // Show skeleton placeholder while brushing (except for row header column)
    if (props.isBrushing && props.columnIndex > 0) {
        return null;
    }

    // Abort if no formatter is available
    if (!props.tableFormatter) {
        return (
            <div
                className={styles.data_cell}
                style={props.style}
                data-table-col={fieldId}
                data-table-row={dataRow}
                onMouseEnter={props.onMouseEnter}
                onMouseLeave={props.onMouseLeave}
            />
        );
    }

    // Format the value
    const formatted = props.tableFormatter.getValue(dataRow, fieldId);
    const focusedRow = props.focusedRow;
    const isRowFocused = dataRow === focusedRow;

    if (props.columnIndex == 0) {
        // Row number column - inline class computation to avoid object allocation
        const className = isRowFocused
            ? `${styles.row_header_cell} ${styles.data_cell_focused_secondary}`
            : styles.row_header_cell;
        return (
            <div className={className} style={props.style}>
                {formatted ?? ""}
            </div>
        );
    } else {
        // Compute class name inline to avoid object allocation in classNames()
        const focusedField = props.focusedField;
        const isMetadata = props.gridLayout.isSystemColumn[props.columnIndex] === 1;
        const isNull = formatted == null;

        // Build class string directly - avoids object creation and iteration
        let className: string;
        if (isNull) {
            className = `${styles.data_cell} ${styles.data_cell_null}`;
        } else {
            className = styles.data_cell;
        }
        if (isRowFocused) {
            className += fieldId === focusedField
                ? ` ${styles.data_cell_focused_primary}`
                : ` ${styles.data_cell_focused_secondary}`;
        }
        if (isMetadata) {
            className += ` ${styles.data_cell_metadata}`;
        }

        return (
            <div
                className={className}
                style={props.style}
                data-table-col={fieldId}
                data-table-row={dataRow}
                onMouseEnter={props.onMouseEnter}
                onMouseLeave={props.onMouseLeave}
            >
                {isNull ? "NULL" : formatted}
            </div>
        );
    }
}
