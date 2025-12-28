import * as arrow from 'apache-arrow';
import * as React from 'react';
import * as styles from './data_table.module.css';
import symbols from '../../../static/svg/symbols.generated.svg';

import { GridChildComponentProps } from 'react-window';

import { classNames } from '../../utils/classnames.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../view/foundations/button.js';
import { ArrowTableFormatter } from './arrow_formatter.js';
import { ColumnSummaryVariant, ColumnGroup, LIST_COLUMN, ORDINAL_COLUMN, SKIPPED_COLUMN, STRING_COLUMN, TableSummary, TaskStatus } from '../../compute/computation_types.js';
import { RectangleWaveSpinner } from '../../view/foundations/spinners.js';
import { HistogramCell, HistogramFilterCallback } from './histogram_cell.js';
import { MostFrequentCell, MostFrequentValueFilterCallback } from './mostfrequent_cell.js';
import { AsyncDataFrame } from '../../compute/compute_worker_bindings.js';
import { DataTableLayout } from './data_table_layout.js';

export enum TableColumnHeader {
    OnlyColumnName = 0,
    WithColumnPlots = 1
}

var COLUMN_HEADER: TableColumnHeader = TableColumnHeader.WithColumnPlots;

export interface TableCellData {
    headerVariant: TableColumnHeader,
    columnGroupSummaries: (ColumnSummaryVariant | null)[];
    columnGroupSummariesStatus: (TaskStatus | null)[];
    columnGroups: ColumnGroup[];
    dataFrame: AsyncDataFrame | null,
    dataFilter: arrow.Vector<arrow.Uint64> | null;
    focusedField: number | null,
    focusedRow: number | null,
    gridLayout: DataTableLayout,
    table: arrow.Table,
    tableFormatter: ArrowTableFormatter,
    tableSummary: TableSummary | null;
    onMouseEnter: (event: React.PointerEvent<HTMLDivElement>) => void,
    onMouseLeave: (event: React.PointerEvent<HTMLDivElement>) => void,
    onOrderByColumn: (col: number) => void,
    onHistogramFilter: HistogramFilterCallback;
    onMostFrequentValueFilter: MostFrequentValueFilterCallback;
}


export function TableCell(props: GridChildComponentProps<TableCellData>) {
    if (props.columnIndex >= props.data.gridLayout.arrowFieldByColumnIndex.length) {
        return <div />;
    }
    const fieldId = props.data.gridLayout.arrowFieldByColumnIndex[props.columnIndex];

    if (props.rowIndex == 0) {
        if (props.columnIndex == 0) {
            return (
                <div className={styles.header_corner_cell} style={props.style}>
                    <span className={styles.header_cell_actions}>
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            size={ButtonSize.Small}
                            aria-label="sort-column"
                            onClick={() => props.data.onOrderByColumn(fieldId)}
                            disabled={props.data.dataFrame == null}
                        >
                            <svg width="16px" height="16px">
                                <use xlinkHref={`${symbols}#sort_desc_16`} />
                            </svg>
                        </IconButton>
                    </span>
                </div>
            );
        } else {
            return (
                <div
                    className={classNames(styles.header_cell, {
                        [styles.header_metadata_cell]: props.data.gridLayout.isSystemColumn[props.columnIndex] == 1
                    })}
                    style={props.style}
                >
                    <span className={styles.header_cell_name}>
                        {props.data.table.schema.fields[fieldId].name}
                    </span>
                    <span className={styles.header_cell_actions}>
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            size={ButtonSize.Small}
                            aria-label="sort-column"
                            onClick={() => props.data.onOrderByColumn(fieldId)}
                            disabled={props.data.dataFrame == null}
                        >
                            <svg width="16px" height="16px">
                                <use xlinkHref={`${symbols}#sort_desc_16`} />
                            </svg>
                        </IconButton>
                    </span>
                </div>
            );
        }
    } else if (props.rowIndex == 1 && COLUMN_HEADER == TableColumnHeader.WithColumnPlots) {
        // Resolve the column summary
        let columnSummary: ColumnSummaryVariant | null = null;
        let columnSummaryStatus: TaskStatus | null = null;
        const columnSummaryId = props.data.gridLayout.columnSummaryByColumnIndex[props.columnIndex];
        if (columnSummaryId != -1) {
            columnSummary = props.data.columnGroupSummaries[columnSummaryId];
            columnSummaryStatus = props.data.columnGroupSummariesStatus[columnSummaryId];
        }

        // Special case, corner cell, top-left
        if (props.columnIndex == 0) {
            return <div className={styles.plots_corner_cell} style={props.style} />;
        } else if (columnSummary == null) {
            // Special case, cell without summary
            return <div className={classNames(styles.plots_cell, styles.plots_empty_cell)} style={props.style} />;
        } else {
            // Check summary status
            const tableSummary = props.data.tableSummary;
            if (tableSummary == null) {
                return (
                    <div className={styles.plots_cell} style={props.style}>
                        Table summary is null
                    </div>
                );
            }
            switch (columnSummaryStatus) {
                case TaskStatus.TASK_RUNNING:
                    return (
                        <div className={classNames(styles.plots_cell, styles.plots_progress)} style={props.style}>
                            <RectangleWaveSpinner
                                className={styles.plots_progress_spinner}
                                active={true}
                                color={"rgb(208, 215, 222)"}
                            />
                        </div>
                    );
                case TaskStatus.TASK_FAILED:
                    return (
                        <div className={styles.plots_cell} style={props.style}>
                            Failed
                        </div>
                    );
                case TaskStatus.TASK_SUCCEEDED:
                    switch (columnSummary?.type) {
                        case ORDINAL_COLUMN:
                            return (
                                <HistogramCell
                                    className={styles.plots_cell}
                                    style={props.style}
                                    tableSummary={tableSummary}
                                    columnIndex={props.columnIndex}
                                    columnSummary={columnSummary.value}
                                    onFilter={props.data.onHistogramFilter}
                                />
                            );
                        case STRING_COLUMN:
                            return (
                                <MostFrequentCell
                                    className={styles.plots_cell}
                                    style={props.style}
                                    tableSummary={tableSummary}
                                    columnIndex={props.columnIndex}
                                    columnSummary={columnSummary.value}
                                    onFilter={props.data.onMostFrequentValueFilter}
                                />
                            );
                        case LIST_COLUMN:
                        case SKIPPED_COLUMN: break;
                    }
            }
        }
    } else {
        // Otherwise, it's a normal data cell
        let dataRow = props.rowIndex - props.data.gridLayout.headerRowCount;
        // XXX Translate the row index through the filter table, if there is one
        if (props.data.dataFilter != null) {
            dataRow = Math.max(Number(props.data.dataFilter.get(dataRow)), 1) - 1;

        }

        // Abort if no formatter is available
        if (!props.data.tableFormatter) {
            return (
                <div
                    className={styles.data_cell}
                    style={props.style}
                    data-table-col={fieldId}
                    data-table-row={dataRow}
                    onMouseEnter={props.data.onMouseEnter}
                    onMouseLeave={props.data.onMouseLeave}
                />
            )
        }

        // XXX Introduce special calls for certain types


        // Format the value
        const formatted = props.data.tableFormatter.getValue(dataRow, fieldId);
        const focusedRow = props.data.focusedRow;
        const focusedField = props.data.focusedField;

        if (props.columnIndex == 0) {
            // Treat the row number column separately
            return (
                <div
                    className={classNames(styles.row_header_cell, {
                        [styles.data_cell_focused_secondary]: dataRow == focusedRow,
                    })}
                    style={props.style}
                >
                    {formatted ?? ""}
                </div>
            );
        } else {
            // Is the value NULL?
            // We want to format the cell differently
            if (formatted == null) {
                return (
                    <div
                        className={classNames(styles.data_cell, styles.data_cell_null, {
                            [styles.data_cell_focused_primary]: dataRow == focusedRow && fieldId == focusedField,
                            [styles.data_cell_focused_secondary]: dataRow == focusedRow && fieldId != focusedField,
                            [styles.data_cell_metadata]: props.data.gridLayout.isSystemColumn[props.columnIndex] == 1,
                        })}
                        style={props.style}
                        data-table-col={fieldId}
                        data-table-row={dataRow}
                        onMouseEnter={props.data.onMouseEnter}
                        onMouseLeave={props.data.onMouseLeave}
                    >
                        NULL
                    </div>
                );
            } else {
                // Otherwise draw a normal cell
                return (
                    <div
                        className={classNames(styles.data_cell, {
                            [styles.data_cell_focused_primary]: dataRow == focusedRow && fieldId == focusedField,
                            [styles.data_cell_focused_secondary]: dataRow == focusedRow && fieldId != focusedField,
                            [styles.data_cell_metadata]: props.data.gridLayout.isSystemColumn[props.columnIndex] == 1,
                        })}
                        style={props.style}
                        data-table-col={fieldId}
                        data-table-row={dataRow}
                        onMouseEnter={props.data.onMouseEnter}
                        onMouseLeave={props.data.onMouseLeave}
                    >
                        {formatted}
                    </div>
                );
            }
        }
    }
}

