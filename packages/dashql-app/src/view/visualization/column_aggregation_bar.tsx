import * as React from 'react';

import * as styles from './column_aggregation_bar.module.css';
import { QueryExecutionState } from '../../connection/query_execution_state.js';
import { useComputationRegistry } from '../../compute/computation_registry.js';
import { ArrowTableFormatter } from '../query_result/arrow_formatter.js';
import { computeTableLayout, DataTableLayout } from '../query_result/data_table_layout.js';
import { HeaderPlotsCell } from '../query_result/data_table_cell.js';
import { useCrossFilters } from '../query_result/use_cross_filters.js';
import { useAppConfig } from '../../app_config.js';
import { useLogger } from '../../platform/logger/logger_provider.js';

const COLUMN_HEADER_PLOTS_HEIGHT = 76;
/// Matches COLUMN_HEADER_HEIGHT in data_table.tsx so the name row lines up with the table header.
const COLUMN_NAME_HEIGHT = 32;
/// The aggregation bar always renders plots, so the layout is computed with a single header row.
const HEADER_ROW_COUNT = 2;

interface Props {
    query: QueryExecutionState | null;
    debugMode?: boolean;
}

/// A horizontally-scrollable strip of column aggregation cells shown above the visualization.
///
/// It renders the same per-column histogram / most-frequent plots as the result table header
/// (reusing `HeaderPlotsCell`) and drives the same shared cross-filter selection via
/// `useCrossFilters`. Brushing a histogram here filters the underlying data table, which the
/// visualization renderer then re-renders against.
export function ColumnAggregationBar(props: Props): React.ReactElement | null {
    const [computationState, dispatchComputation] = useComputationRegistry();
    const logger = useLogger();
    const config = useAppConfig();
    const debugMode = props.debugMode ?? (config?.settings?.tableDebugMode ?? false);

    const queryId = props.query?.queryId ?? null;
    const tableComputation = queryId != null ? computationState.tableComputations[queryId] ?? null : null;

    // Measure the available width so the layout can distribute the leftover space across the
    // columns (same fill-to-width behaviour as the data table).
    const rootRef = React.useRef<HTMLDivElement | null>(null);
    const [containerWidth, setContainerWidth] = React.useState(0);
    React.useEffect(() => {
        const el = rootRef.current;
        if (!el) return;
        const observer = new ResizeObserver(entries => {
            const width = entries[0]?.contentRect.width ?? 0;
            setContainerWidth(width);
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // Build the arrow formatter and layout with the SAME util the table uses, so the
    // column -> aggregate index mapping matches exactly.
    const tableFormatter = React.useMemo(() => {
        if (!tableComputation) return null;
        const dataTable = tableComputation.dataTable;
        return new ArrowTableFormatter(dataTable.schema, dataTable.batches, logger);
    }, [tableComputation?.dataTable, logger]);

    const gridLayout = React.useMemo<DataTableLayout | null>(() => {
        if (!tableComputation || !tableFormatter) return null;
        // The bar does not render the leading row-number column, but the layout still reserves
        // its width. Offset the container width by that reserved width so the data columns we DO
        // render fill the whole bar.
        const probe = computeTableLayout(tableFormatter, tableComputation, debugMode, HEADER_ROW_COUNT);
        const rowNumberWidth = probe.columnCount > 0 ? probe.columnXOffsets[1] : 0;
        const effectiveWidth = containerWidth > 0 ? containerWidth + rowNumberWidth : 0;
        return computeTableLayout(tableFormatter, tableComputation, debugMode, HEADER_ROW_COUNT, effectiveWidth);
    }, [tableComputation, tableFormatter, debugMode, containerWidth]);

    // The cross-filter controller must be called unconditionally to satisfy the rules of hooks;
    // it no-ops harmlessly when there is no table computation / data frame yet.
    const emptyLayout = React.useMemo<DataTableLayout>(() => ({
        columnCount: 0,
        arrowFieldByColumnIndex: new Uint32Array(),
        columnXOffsets: new Float64Array([0]),
        columnAggregateByColumnIndex: new Int32Array(),
        columnGroupByColumnIndex: new Uint32Array(),
        isSystemColumn: new Uint8Array(),
        isTextColumn: new Uint8Array(),
        headerRowCount: HEADER_ROW_COUNT,
    }), []);
    const controller = useCrossFilters(
        tableComputation,
        dispatchComputation,
        gridLayout ?? emptyLayout,
    );

    if (!tableComputation || !gridLayout || gridLayout.columnCount === 0) {
        return null;
    }

    // Skip the leading row-number column (columnIndex 0); render the aggregate plots for the rest.
    const fields = tableComputation.dataTable.schema.fields;
    const cells: React.ReactElement[] = [];
    for (let columnIndex = 1; columnIndex < gridLayout.columnCount; ++columnIndex) {
        const width = gridLayout.columnXOffsets[columnIndex + 1] - gridLayout.columnXOffsets[columnIndex];
        const fieldId = gridLayout.arrowFieldByColumnIndex[columnIndex];
        const columnName = fields[fieldId]?.name ?? '';
        cells.push(
            <div key={`agg-${columnIndex}`} className={styles.column} style={{ width, flexShrink: 0 }}>
                <div className={styles.column_name} style={{ height: COLUMN_NAME_HEIGHT }} title={columnName}>
                    {columnName}
                </div>
                <HeaderPlotsCell
                    columnIndex={columnIndex}
                    style={{ width, height: COLUMN_HEADER_PLOTS_HEIGHT, flexShrink: 0 }}
                    gridLayout={gridLayout}
                    columnGroups={tableComputation.columnGroups}
                    columnAggregations={tableComputation.columnAggregates}
                    columnAggregationTasks={tableComputation.tasks.columnAggregationTasks}
                    filteredColumnAggregations={tableComputation.filteredColumnAggregates}
                    filteredColumnAggregationTasks={tableComputation.tasks.filteredColumnAggregationTasks}
                    filteredColumnAggregationOutdated={tableComputation.filteredColumnAggregatesOutdated}
                    tableAggregation={tableComputation.tableAggregation}
                    filterTableEpoch={tableComputation.filterTable?.version ?? null}
                    isVisible={true}
                    rightmostVisibleColumn={gridLayout.columnCount - 1}
                    onRequestFilteredColumnAggregation={controller.requestFilteredColumnAggregation}
                    onHistogramFilter={controller.histogramFilter}
                    onBrushingChange={NOOP_BRUSHING}
                    onMostFrequentValueFilter={controller.mostFrequentValueFilter}
                />
            </div>
        );
    }

    return (
        <div ref={rootRef} className={styles.root}>
            <div className={styles.scroll} style={{ height: COLUMN_HEADER_PLOTS_HEIGHT + COLUMN_NAME_HEIGHT }}>
                {cells}
            </div>
        </div>
    );
}

const NOOP_BRUSHING = () => { };
