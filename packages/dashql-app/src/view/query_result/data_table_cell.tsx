import * as arrow from 'apache-arrow';
import * as React from 'react';
import * as styles from './data_table.module.css';
import symbols from '../../../static/svg/symbols.generated.svg';

import type { CellComponentProps } from 'react-window';

import { classNames } from '../../utils/classnames.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../view/foundations/button.js';
import { ArrowTableFormatter } from './arrow_formatter.js';
import { ColumnAggregationTask, ColumnAggregationVariant, ColumnGroup, LIST_COLUMN, ORDINAL_COLUMN, SKIPPED_COLUMN, STRING_COLUMN, TableAggregation, TaskStatus, WithFilterEpoch, WithProgress } from '../../compute/computation_types.js';
import { RectangleWaveSpinner } from '../../view/foundations/spinners.js';
import { BrushingStateCallback, HistogramCell, HistogramFilterCallback } from './histogram_cell.js';
import { MostFrequentCell, MostFrequentValueFilterCallback } from './mostfrequent_cell.js';
import { AsyncDataFrame } from '../../compute/compute_worker_bindings.js';
import { DataTableLayout } from './data_table_layout.js';

export enum TableColumnHeader {
    OnlyColumnName = 0,
    WithColumnPlots = 1
}

/// ---------------------------------------------------------------------------
/// Header Name Cell
/// ---------------------------------------------------------------------------

export interface HeaderNameCellProps {
    columnIndex: number;
    style: React.CSSProperties;
    table: arrow.Table;
    gridLayout: DataTableLayout;
    dataFrame: AsyncDataFrame | null;
    onOrderByColumn: (col: number) => void;
}

export function HeaderNameCell(props: HeaderNameCellProps): React.ReactElement {
    if (props.columnIndex >= props.gridLayout.arrowFieldByColumnIndex.length) {
        return <div style={props.style} />;
    }
    const fieldId = props.gridLayout.arrowFieldByColumnIndex[props.columnIndex];

    if (props.columnIndex == 0) {
        // Corner cell (top-left)
        return (
            <div className={styles.header_corner_cell} style={props.style}>
                <span className={styles.header_cell_actions}>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label="sort-column"
                        onClick={() => props.onOrderByColumn(fieldId)}
                        disabled={props.dataFrame == null}
                    >
                        <svg width="16px" height="16px">
                            <use xlinkHref={`${symbols}#sort_desc_16`} />
                        </svg>
                    </IconButton>
                </span>
            </div>
        );
    } else {
        // Regular header cell
        return (
            <div
                className={classNames(styles.header_cell, {
                    [styles.header_metadata_cell]: props.gridLayout.isSystemColumn[props.columnIndex] == 1
                })}
                style={props.style}
            >
                <span className={styles.header_cell_name}>
                    {props.table.schema.fields[fieldId].name}
                </span>
                <span className={styles.header_cell_actions}>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label="sort-column"
                        onClick={() => props.onOrderByColumn(fieldId)}
                        disabled={props.dataFrame == null}
                    >
                        <svg width="16px" height="16px">
                            <use xlinkHref={`${symbols}#sort_desc_16`} />
                        </svg>
                    </IconButton>
                </span>
            </div>
        );
    }
}

/// ---------------------------------------------------------------------------
/// Header Plots Cell (row 1)
/// ---------------------------------------------------------------------------

export interface HeaderPlotsCellProps {
    columnIndex: number;
    style: React.CSSProperties;
    gridLayout: DataTableLayout;
    columnGroups: ColumnGroup[];
    columnAggregations: (ColumnAggregationVariant | null)[];
    columnAggregationTasks: (WithProgress<ColumnAggregationTask> | null)[];
    filteredColumnAggregations: (WithFilterEpoch<ColumnAggregationVariant> | null)[];
    tableAggregation: TableAggregation | null;
    onHistogramFilter: HistogramFilterCallback;
    onBrushingChange: BrushingStateCallback;
    onMostFrequentValueFilter: MostFrequentValueFilterCallback;
}

export function HeaderPlotsCell(props: HeaderPlotsCellProps): React.ReactElement {
    if (props.columnIndex >= props.gridLayout.arrowFieldByColumnIndex.length) {
        return <div style={props.style} />;
    }

    // Resolve the column summary
    let columnAggregate: ColumnAggregationVariant | null = null;
    let columnAggregationTask: WithProgress<ColumnAggregationTask> | null = null;
    let filteredColumnAggregate: WithFilterEpoch<ColumnAggregationVariant> | null = null;
    const columnAggregateId = props.gridLayout.columnAggregateByColumnIndex[props.columnIndex];
    if (columnAggregateId != -1) {
        columnAggregate = props.columnAggregations[columnAggregateId];
        columnAggregationTask = props.columnAggregationTasks[columnAggregateId];
        filteredColumnAggregate = props.filteredColumnAggregations[columnAggregateId];
    }

    // Special case, corner cell, top-left
    if (props.columnIndex == 0) {
        return <div className={styles.plots_corner_cell} style={props.style} />;
    } else if (columnAggregate == null) {
        // Special case, cell without summary
        return <div className={classNames(styles.plots_cell, styles.plots_empty_cell)} style={props.style} />;
    } else {
        // Check summary status
        const tableAggregation = props.tableAggregation;
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
                                onFilter={props.onHistogramFilter}
                                onBrushingChange={props.onBrushingChange}
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
                                onFilter={props.onMostFrequentValueFilter}
                            />
                        );
                    case LIST_COLUMN:
                    case SKIPPED_COLUMN:
                        break;
                }
        }
    }
    // Fallback for unhandled cases
    return <div className={styles.plots_cell} style={props.style} />;
}

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

