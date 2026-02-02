import * as React from 'react';
import * as styles from './data_table.module.css';

import { classNames } from '../../utils/classnames.js';
import { ColumnAggregationTask, ColumnAggregationVariant, ColumnGroup, LIST_COLUMN, ORDINAL_COLUMN, SKIPPED_COLUMN, STRING_COLUMN, TableAggregation, TaskStatus, WithFilterEpoch, WithProgress } from '../../compute/computation_types.js';
import { RectangleWaveSpinner } from '../../view/foundations/spinners.js';
import { BrushingStateCallback, HistogramCell, HistogramFilterCallback } from './histogram_cell.js';
import { MostFrequentCell, MostFrequentValueFilterCallback } from './mostfrequent_cell.js';
import { DataTableLayout } from './data_table_layout.js';

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
                                filteredColumnAggregation={filteredColumnAggregate}
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
