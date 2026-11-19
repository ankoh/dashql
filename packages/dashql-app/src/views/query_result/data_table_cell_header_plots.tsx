import * as React from 'react';
import * as styles from './data_table.module.css';
import symbols from '@akohn/dashql-svg-symbols';

import { classNames } from '@akohn/dashql-react/dom/classnames';
import type * as core from '@akohn/dashql';
import { ColumnAggregationVariant, ColumnGroup, LIST_COLUMN, ORDINAL_COLUMN, SKIPPED_COLUMN, STRING_COLUMN, TableAggregation, TaskStatus, TrackedTask, WithFilterEpoch, ComputationStateVersion } from '@akohn/dashql/platform/compute/computation_types';
import { RectangleWaveSpinner } from '@akohn/dashql-react/components/spinners';
import { BrushingStateCallback, HistogramCell, HistogramFilterCallback } from './histogram_cell.js';
import { MostFrequentCell, MostFrequentValueFilterCallback } from './mostfrequent_cell.js';
import { DataTableLayout } from './data_table_layout.js';
import { arePropsEqualWithStyle } from './memo_props.js';
import { crossFilterOf } from './use_cross_filters.js';

/// ---------------------------------------------------------------------------
/// Header Plots Cell (row 1)
/// ---------------------------------------------------------------------------

export interface HeaderPlotsCellProps {
    columnIndex: number;
    style: React.CSSProperties;
    gridLayout: DataTableLayout;
    columnGroups: ColumnGroup[];
    columnAggregations: (ColumnAggregationVariant | null)[];
    columnAggregationTasks: (TrackedTask | null)[];
    filteredColumnAggregations: (WithFilterEpoch<ColumnAggregationVariant> | null)[];
    filteredColumnAggregationTasks: (TrackedTask | null)[];
    filteredColumnAggregationOutdated: boolean[];
    tableAggregation: TableAggregation | null;
    selectionEpoch: ComputationStateVersion;
    dataSearchRequestId: number | null;
    crossFilters: core.ComputationCrossFilter[];
    isVisible: boolean;
    rightmostVisibleColumn: number;
    onRequestFilteredColumnAggregation: (columnId: number) => void;
    onHistogramFilter: HistogramFilterCallback;
    onBrushingChange: BrushingStateCallback;
    onMostFrequentValueFilter: MostFrequentValueFilterCallback;
}

function HeaderPlotsCellImpl(props: HeaderPlotsCellProps): React.ReactElement {
    if (props.columnIndex >= props.gridLayout.arrowFieldByColumnIndex.length) {
        return <div style={props.style} />;
    }

    // Resolve the column summary
    let columnAggregate: ColumnAggregationVariant | null = null;
    let columnAggregationTask: TrackedTask | null = null;
    let filteredColumnAggregate: WithFilterEpoch<ColumnAggregationVariant> | null = null;
    let filteredColumnAggregationTask: TrackedTask | null = null;
    let filteredColumnAggregationOutdated = false;
    const columnAggregateId = props.gridLayout.columnAggregateByColumnIndex[props.columnIndex];
    if (columnAggregateId != -1) {
        columnAggregate = props.columnAggregations[columnAggregateId] ?? null;
        columnAggregationTask = props.columnAggregationTasks[columnAggregateId] ?? null;
        filteredColumnAggregate = props.filteredColumnAggregations[columnAggregateId] ?? null;
        filteredColumnAggregationTask = props.filteredColumnAggregationTasks[columnAggregateId] ?? null;
        filteredColumnAggregationOutdated = props.filteredColumnAggregationOutdated[columnAggregateId] ?? false;
    }

    // The summary over the selected rows of a column that shows, the runtime computes it once per selection
    React.useEffect(() => {
        if (columnAggregateId == -1 || !props.isVisible || !filteredColumnAggregationOutdated) {
            return;
        }
        props.onRequestFilteredColumnAggregation(columnAggregateId);
    }, [
        columnAggregateId,
        filteredColumnAggregationOutdated,
        filteredColumnAggregationTask,
        props.selectionEpoch,
        props.dataSearchRequestId,
        props.isVisible,
        props.onRequestFilteredColumnAggregation,
    ]);

    const isRightmost = props.columnIndex === props.rightmostVisibleColumn;

    if (!props.isVisible) {
        return <div style={props.style} />;
    }

    // Some columns carry no summary by design — most notably LIST columns (e.g. float32
    // embedding arrays), for which aggregating value identifiers / frequent values is
    // very expensive and not rendered. Show a "no summary" indicator on the primary
    // value column of such groups (meta/system columns stay blank).
    const columnGroupId = props.gridLayout.columnGroupByColumnIndex[props.columnIndex];
    const columnGroup = props.columnGroups[columnGroupId] as ColumnGroup | undefined;
    const crossFilter = crossFilterOf(props.crossFilters, columnGroupId);
    const histogramSelection = crossFilter?.kind === 'histogram'
        ? crossFilter.selection
        : null;
    const isValueColumn = props.gridLayout.isSystemColumn[props.columnIndex] == 0;
    const hasNoSummaryByDesign = isValueColumn && columnGroup?.type == LIST_COLUMN;

    // Special case, corner cell, top-left
    if (props.columnIndex == 0) {
        return <div className={styles.plots_corner_cell} style={props.style} />;
    } else if (hasNoSummaryByDesign) {
        // Cell without a summary by design: show a muted "no summary" indicator.
        return (
            <div
                className={classNames(styles.plots_cell, styles.plots_no_summary_cell, {
                    [styles.plots_cell_rightmost]: isRightmost
                })}
                style={props.style}
                title="No column summary"
            >
                <span className={styles.plots_no_summary_label}>No summary</span>
            </div>
        );
    } else if (columnAggregate == null) {
        // Special case, cell without summary
        return <div className={classNames(styles.plots_cell, styles.plots_empty_cell, {
            [styles.plots_cell_rightmost]: isRightmost
        })} style={props.style} />;
    } else {
        // Check summary status
        const tableAggregation = props.tableAggregation;
        if (tableAggregation == null) {
            return (
                <div className={classNames(styles.plots_cell, {
                    [styles.plots_cell_rightmost]: isRightmost
                })} style={props.style}>
                    Table summary is null
                </div>
            );
        }
        switch (columnAggregationTask?.progress.status) {
            case TaskStatus.TASK_RUNNING:
                return (
                    <div className={classNames(styles.plots_cell, styles.plots_progress, {
                        [styles.plots_cell_rightmost]: isRightmost
                    })} style={props.style}>
                        <RectangleWaveSpinner
                            className={styles.plots_progress_spinner}
                            active={true}
                            color={"var(--color_border)"}
                        />
                    </div>
                );
            case TaskStatus.TASK_FAILED:
                return (
                    <div className={classNames(styles.plots_cell, {
                        [styles.plots_cell_rightmost]: isRightmost
                    })} style={props.style}>
                        Failed
                    </div>
                );
            case TaskStatus.TASK_CANCELLED:
                return (
                    <div className={classNames(styles.plots_cell, {
                        [styles.plots_cell_rightmost]: isRightmost
                    })} style={props.style}>
                        Cancelled
                    </div>
                );
            case TaskStatus.TASK_SUCCEEDED:
                switch (columnAggregate?.type) {
                    case ORDINAL_COLUMN:
                        return (
                            <HistogramCell
                                className={classNames(styles.plots_cell, {
                                    [styles.plots_cell_rightmost]: isRightmost
                                })}
                                style={props.style}
                                tableAggregation={tableAggregation}
                                filteredColumnAggregation={filteredColumnAggregate}
                                columnIndex={props.columnIndex}
                                columnAggregate={columnAggregate.value}
                                selection={histogramSelection}
                                onFilter={props.onHistogramFilter}
                                onBrushingChange={props.onBrushingChange}
                            />
                        );
                    case STRING_COLUMN:
                        return (
                            <MostFrequentCell
                                className={classNames(styles.plots_cell, {
                                    [styles.plots_cell_rightmost]: isRightmost
                                })}
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
    return <div className={classNames(styles.plots_cell, {
        [styles.plots_cell_rightmost]: isRightmost
    })} style={props.style} />;
}

export const HeaderPlotsCell = React.memo(HeaderPlotsCellImpl, arePropsEqualWithStyle);
