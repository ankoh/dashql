import * as arrow from 'apache-arrow';
import * as React from 'react';
import * as styles from './data_table.module.css';
import symbols from '../../../static/svg/symbols.generated.svg';

import { GridChildComponentProps } from 'react-window';

import { classNames } from '../../utils/classnames.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../view/foundations/button.js';
import { ArrowTableFormatter } from './arrow_formatter.js';
import { ColumnAggregationTask, ColumnAggregationVariant, ColumnGroup, LIST_COLUMN, ORDINAL_COLUMN, SKIPPED_COLUMN, STRING_COLUMN, TableAggregation, TaskStatus, WithFilter, WithFilterEpoch, WithProgress } from '../../compute/computation_types.js';
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
    columnGroups: ColumnGroup[];
    columnAggregations: (ColumnAggregationVariant | null)[];
    columnAggregationTasks: (WithProgress<ColumnAggregationTask> | null)[];
    filteredColumnAggregations: (WithFilterEpoch<ColumnAggregationVariant> | null)[];
    filteredColumnAggregationTasks: (WithProgress<WithFilter<ColumnAggregationTask>> | null)[];
    dataFrame: AsyncDataFrame | null,
    dataFilter: arrow.Vector<arrow.Uint64> | null;
    focusedField: number | null,
    focusedRow: number | null,
    gridLayout: DataTableLayout,
    table: arrow.Table,
    tableFormatter: ArrowTableFormatter,
    tableAggregation: TableAggregation | null;
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
        let columnAggregate: ColumnAggregationVariant | null = null;
        let columnAggregationTask: WithProgress<ColumnAggregationTask> | null = null;
        let filteredColumnAggregate: WithFilterEpoch<ColumnAggregationVariant> | null = null;
        const columnAggregateId = props.data.gridLayout.columnAggregateByColumnIndex[props.columnIndex];
        if (columnAggregateId != -1) {
            columnAggregate = props.data.columnAggregations[columnAggregateId];
            columnAggregationTask = props.data.columnAggregationTasks[columnAggregateId];
            filteredColumnAggregate = props.data.filteredColumnAggregations[columnAggregateId];
        }

        // Special case, corner cell, top-left
        if (props.columnIndex == 0) {
            return <div className={styles.plots_corner_cell} style={props.style} />;
        } else if (columnAggregate == null) {
            // Special case, cell without summary
            return <div className={classNames(styles.plots_cell, styles.plots_empty_cell)} style={props.style} />;
        } else {
            // Check summary status
            const tableAggregation = props.data.tableAggregation;
            if (tableAggregation == null) {
                return (
                    <div className={styles.plots_cell} style={props.style}>
                        Table summary is null
                    </div>
                );
            }
            switch (columnAggregationTask?.progress.status) {
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
                    switch (columnAggregate?.type) {
                        case ORDINAL_COLUMN:
                            return (
                                <HistogramCell
                                    className={styles.plots_cell}
                                    style={props.style}
                                    tableAggregation={tableAggregation}
                                    filteredColumnAggregation={filteredColumnAggregate}
                                    columnIndex={props.columnIndex}
                                    columnAggregate={columnAggregate.value}
                                    onFilter={props.data.onHistogramFilter}
                                />
                            );
                        case STRING_COLUMN:
                            return (
                                <MostFrequentCell
                                    className={styles.plots_cell}
                                    style={props.style}
                                    tableAggregation={tableAggregation}
                                    columnIndex={props.columnIndex}
                                    columnAggregate={columnAggregate.value}
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

        // Format the value
        const formatted = props.data.tableFormatter.getValue(dataRow, fieldId);
        const focusedRow = props.data.focusedRow;
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
            const focusedField = props.data.focusedField;
            const isMetadata = props.data.gridLayout.isSystemColumn[props.columnIndex] === 1;
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
                    onMouseEnter={props.data.onMouseEnter}
                    onMouseLeave={props.data.onMouseLeave}
                >
                    {isNull ? "NULL" : formatted}
                </div>
            );
        }
    }
}

