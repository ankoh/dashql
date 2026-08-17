import * as arrow from 'apache-arrow';
import * as React from 'react';
import * as styles from './data_table.module.css';

import { Grid, useGridCallbackRef } from 'react-window';

import { ArrowTableFormatter } from '../../../../../compute/arrow_formatter.js';
import { ComputationAction, TableComputationState } from '../../../../../compute/computation_state.js';
import { Dispatch } from '../../../../../utils/variant.js';
import { DataCell, DataCellData, TableColumnHeader } from './data_table_cell.js';
import { classNames } from '../../../../../utils/classnames.js';
import { computeTableLayout, DataTableLayout } from './data_table_layout.js';
import { useCrossFilters } from './use_cross_filters.js';
import { observeSize } from '../../../../../ui/foundations/size_observer.js';
import { CellDetailOverlay } from './cell_detail_overlay.js';
import { useAppConfig } from '../../../../config/app_config.js';
import { useLogger } from '../../../../../platform/logger/logger_provider.js';
import { useScrollbarHeight } from '../../../../../utils/scrollbar.js';
import { useDataTableOrdering } from './data_table_ordering.js';
import { useDataTablePortalContainers } from './data_table_portals.js';
import { DataTableStickyColumn, DataTableStickyHeaders } from './data_table_sticky_views.js';

const LOG_CTX = 'data_table';

interface Props {
    className?: string;
    table: TableComputationState;
    dispatchComputation: Dispatch<ComputationAction>;
    debugMode: boolean;
    maxRows?: number;
    columnHeader?: TableColumnHeader;
    cellBackground?: string;
    onShowTable?: () => void;
    fitHeight?: boolean;
    maxHeight?: number;
}

const MIN_GRID_HEIGHT = 200;
const MIN_GRID_WIDTH = 100;
const COLUMN_HEADER_HEIGHT = 32;
const COLUMN_HEADER_PLOTS_HEIGHT = 76;
const ROW_HEIGHT = 26;
const GRID_OVERSCAN_COUNT = 10;
const NOOP_BRUSHING = () => { };

interface FocusedCells {
    row: number | null,
    field: number | null
}

interface RenderedCells {
    rowStart: number;
    rowStop: number;
    columnStart: number;
    columnStop: number;
}

export const DataTable: React.FC<Props> = (props: Props) => {
    const config = useAppConfig();
    const logger = useLogger();
    const dispatchComputation = props.dispatchComputation;
    const computationState = props.table;
    const dataTable = computationState.dataTable;
    const [gridApi, setGridApi] = useGridCallbackRef(null);
    const visibleRowIdTable = computationState.orderingTable?.dataTable ?? computationState.filterTable?.dataTable ?? null;
    const gridContainerElement = React.useRef(null);
    const gridContainerSize = observeSize(gridContainerElement);
    const gridContainerWidth = Math.max(gridContainerSize?.width ?? 0, MIN_GRID_WIDTH);
    const columnHeader = props.columnHeader ?? ((config?.settings?.enableTableColumnPlots ?? false)
        ? TableColumnHeader.WithColumnPlots
        : TableColumnHeader.OnlyColumnName);

    // Get the row-id indirection column from ordering or filtering
    const visibleRowIds = React.useMemo<arrow.Vector<arrow.Int> | null>(() => {
        if (visibleRowIdTable == null) {
            return null;
        }
        if (visibleRowIdTable.numCols !== 1) {
            logger.error(`Visible row table has an unexpected column count`, {
                columnCount: visibleRowIdTable.numCols.toString(),
            }, LOG_CTX);
            return null;
        }
        const rowIdColumn = visibleRowIdTable.getChildAt(0);
        if (rowIdColumn!.type.typeId !== arrow.Type.Int) {
            logger.error(`Visible row table column is not of type Int`, {
                actual: rowIdColumn?.type.toString()
            }, LOG_CTX);
            return null;
        }
        return rowIdColumn;
    }, [logger, visibleRowIdTable]);

    // Data row count. Headers are rendered separately via portals
    // When an indirection table is active, show only the derived visible rows
    const totalRowCount = visibleRowIds?.length ?? dataTable.numRows ?? 0;
    const dataRowCount = props.maxRows != null ? Math.min(totalRowCount, props.maxRows) : totalRowCount;
    // Header configuration
    const headerRowCount = columnHeader === TableColumnHeader.WithColumnPlots ? 2 : 1;

    // Construct the arrow formatter and update it whenever the data table changes
    const tableFormatter = React.useMemo(() => {
        return new ArrowTableFormatter(dataTable.schema, dataTable.batches, logger);
    }, [dataTable]);

    // Determine grid dimensions and column widths
    const gridLayout = React.useMemo<DataTableLayout>(() => {
        if (!tableFormatter) {
            return {
                columnCount: 0,
                arrowFieldByColumnIndex: new Uint32Array(),
                columnXOffsets: new Float64Array([0]),
                columnAggregateByColumnIndex: new Int32Array(),
                columnGroupByColumnIndex: new Uint32Array(),
                isSystemColumn: new Uint8Array(),
                isTextColumn: new Uint8Array(),
                headerRowCount
            };
        }
        return computeTableLayout(tableFormatter, computationState, props.debugMode, headerRowCount, gridContainerWidth);
    }, [
        computationState.columnGroups,
        tableFormatter,
        props.debugMode,
        gridContainerWidth,
        headerRowCount,
    ]);

    // Compute helper to resolve column widths
    const getColumnWidth = React.useCallback((column: number) =>
        gridLayout.columnXOffsets[column + 1] - gridLayout.columnXOffsets[column],
        [gridLayout]);

    // Grid re-renders automatically when cellProps (gridData) changes
    // which includes gridLayout as a dependency

    // Track react-window's already-overscanned range for the sticky header and column.
    const [renderedCells, setRenderedCells] = React.useState<RenderedCells>({
        rowStart: 0,
        rowStop: 0,
        columnStart: 0,
        columnStop: 0,
    });

    // Shared cross-filter controller: selection lives on the computation state and drives
    // a single filterTable. Also owns the guarded filtering effect.
    const { crossFilters, histogramFilter, mostFrequentValueFilter, requestFilteredColumnAggregation } = useCrossFilters(
        computationState,
        dispatchComputation,
        gridLayout,
    );

    const { orderByColumn, getSortDirection } = useDataTableOrdering(computationState, dispatchComputation);

    // Maintain the focused cell - updates are stored in ref and read during next render
    const focusedCells = React.useRef<FocusedCells | null>(null);
    const [updateCounter, forceUpdate] = React.useReducer(x => x + 1, 0);
    const onMouseEnterCell: React.PointerEventHandler<HTMLDivElement> = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const tableRow = Number.parseInt(event.currentTarget.dataset["tableRow"]!);
        const tableCol = Number.parseInt(event.currentTarget.dataset["tableCol"]!);
        focusedCells.current = { row: tableRow, field: tableCol };
        forceUpdate();
    }, []);
    const onMouseLeaveCell: React.PointerEventHandler<HTMLDivElement> = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        focusedCells.current = null;
        forceUpdate();
    }, []);

    // Cell detail overlay state
    const [cellDetail, setCellDetail] = React.useState<{
        dataRow: number;
        fieldId: number;
        formattedValue: string | null;
        columnName: string | null;
    } | null>(null);
    const onClickCell: React.MouseEventHandler<HTMLDivElement> = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        const dataRow = Number.parseInt(event.currentTarget.dataset["tableRow"]!);
        const fieldId = Number.parseInt(event.currentTarget.dataset["tableCol"]!);
        const field = computationState.dataTable.schema.fields[fieldId];
        if (field == null || (field.type.typeId !== arrow.Type.Utf8 && field.type.typeId !== arrow.Type.LargeUtf8)) return;
        const formattedValue = tableFormatter.getValue(dataRow, fieldId);
        const columnName = field.name ?? null;
        setCellDetail({ dataRow, fieldId, formattedValue, columnName });
    }, [tableFormatter, computationState.dataTable]);
    const onNavigateCell = React.useCallback((delta: number) => {
        setCellDetail(prev => {
            if (prev == null) return null;
            const newRow = prev.dataRow + delta;
            if (newRow < 0 || newRow >= dataRowCount) return prev;
            const formattedValue = tableFormatter.getValue(newRow, prev.fieldId);
            return { ...prev, dataRow: newRow, formattedValue };
        });
    }, [tableFormatter, dataRowCount]);

    // Maintain a rendering context for data cells.
    // This context is passed to grid elements as item data.
    const gridData = React.useMemo<DataCellData>(() => ({
        visibleRowIds: visibleRowIds,
        gridLayout: gridLayout,
        hideRowHeader: true,
        columnGroups: computationState.columnGroups,
        tableFormatter: tableFormatter,
        onMouseEnter: onMouseEnterCell,
        onMouseLeave: onMouseLeaveCell,
        onClick: onClickCell,
        table: computationState.dataTable,
        focusedRow: focusedCells.current?.row ?? null,
        focusedField: focusedCells.current?.field ?? null,
        rightmostVisibleColumn: gridLayout.columnCount - 1,
    }), [
        // Data dependencies that legitimately require cell re-renders
        computationState.columnGroups,
        computationState.dataTable,
        visibleRowIds,
        gridLayout,
        tableFormatter,
        updateCounter, // Force recomputation when focused cell changes
        // Stable callbacks (empty deps) - included for correctness but won't cause re-renders
        onMouseEnterCell,
        onMouseLeaveCell,
        onClickCell,
        // Note: focusedCells is a ref, reading it here won't trigger re-renders
        // but the value will be fresh when gridData is created
    ]);
    // Track only range boundary changes, rather than updating React state for every scroll event.
    const onCellsRendered = React.useCallback((
        _visibleCells: { columnStartIndex: number; columnStopIndex: number; rowStartIndex: number; rowStopIndex: number },
        allCells: { columnStartIndex: number; columnStopIndex: number; rowStartIndex: number; rowStopIndex: number }
    ) => {
        setRenderedCells(prev => {
            if (
                prev.rowStart === allCells.rowStartIndex
                && prev.rowStop === allCells.rowStopIndex
                && prev.columnStart === allCells.columnStartIndex
                && prev.columnStop === allCells.columnStopIndex
            ) {
                return prev;
            }
            return {
                rowStart: allCells.rowStartIndex,
                rowStop: allCells.rowStopIndex,
                columnStart: allCells.columnStartIndex,
                columnStop: allCells.columnStopIndex,
            };
        });
    }, []);

    // Compute grid dimensions
    const totalColumnsWidth = gridLayout.columnXOffsets[gridLayout.columnCount] ?? 0;
    const firstColumnWidth = getColumnWidth(0);
    const headerHeight = columnHeader === TableColumnHeader.WithColumnPlots
        ? COLUMN_HEADER_HEIGHT + COLUMN_HEADER_PLOTS_HEIGHT
        : COLUMN_HEADER_HEIGHT;
    const scrollbarHeight = useScrollbarHeight();
    const needsHorizontalScroll = totalColumnsWidth > gridContainerWidth;
    const contentHeight = headerHeight + dataRowCount * ROW_HEIGHT + (needsHorizontalScroll ? scrollbarHeight : 0);
    const gridContainerHeight = props.fitHeight
        ? Math.min(contentHeight, props.maxHeight ?? Number.POSITIVE_INFINITY)
        : props.maxRows != null
            ? contentHeight
            : Math.max(gridContainerSize?.height ?? 0, MIN_GRID_HEIGHT);
    const firstRenderedColumn = gridLayout.columnCount > 1
        ? Math.max(1, Math.min(renderedCells.columnStart, gridLayout.columnCount - 1))
        : 1;
    const lastRenderedColumn = gridLayout.columnCount > 1
        ? Math.max(firstRenderedColumn, Math.min(renderedCells.columnStop, gridLayout.columnCount - 1))
        : 0;
    const renderedColumnCount = Math.max(0, lastRenderedColumn - firstRenderedColumn + 1);
    const leftHeaderSpacerWidth = gridLayout.columnCount > 1
        ? gridLayout.columnXOffsets[firstRenderedColumn] - firstColumnWidth
        : 0;
    const rightHeaderSpacerWidth = lastRenderedColumn > 0
        ? totalColumnsWidth - gridLayout.columnXOffsets[lastRenderedColumn + 1]
        : 0;


    // Create containers for sticky header and sticky column
    const portalContainers = useDataTablePortalContainers(gridApi);

    // Total height of data content (for sticky column sizing)
    const totalDataHeight = dataRowCount * ROW_HEIGHT;

    return (
        // The grid can be rendered within the notebook feed's deep Tauri drag region. Opt out so
        // native scrollbar thumbs receive pointer drags instead of moving the application window.
        <div
            className={classNames(styles.root, props.className)}
            data-tauri-drag-region="false"
            style={{
                ...(props.cellBackground ? { '--data_table_bg': props.cellBackground } : {}),
                ...(props.fitHeight ? { height: gridContainerHeight } : {}),
            } as React.CSSProperties}
        >
            <div className={styles.grid_container} ref={gridContainerElement}>
                <Grid
                    gridRef={setGridApi}
                    style={{
                        width: gridContainerWidth,
                        height: gridContainerHeight,
                        overflowY: props.maxRows != null ? 'hidden' : undefined,
                    }}
                    columnCount={gridLayout.columnCount}
                    columnWidth={getColumnWidth}
                    rowCount={dataRowCount}
                    rowHeight={ROW_HEIGHT}
                    onCellsRendered={onCellsRendered}
                    overscanCount={GRID_OVERSCAN_COUNT}
                    cellComponent={DataCell}
                    cellProps={gridData}
                    className={styles.data_grid}
                />
                <DataTableStickyHeaders
                    container={portalContainers?.header ?? null}
                    totalWidth={totalColumnsWidth}
                    headerHeight={headerHeight}
                    firstColumnWidth={firstColumnWidth}
                    leftSpacerWidth={leftHeaderSpacerWidth}
                    rightSpacerWidth={rightHeaderSpacerWidth}
                    firstRenderedColumn={firstRenderedColumn}
                    renderedColumnCount={renderedColumnCount}
                    getColumnWidth={getColumnWidth}
                    columnHeader={columnHeader}
                    nameCellProps={{
                        table: computationState.dataTable,
                        gridLayout,
                        dataFrame: computationState.dataFrame,
                        rightmostVisibleColumn: gridLayout.columnCount - 1,
                        getSortDirection,
                        onOrderByColumn: orderByColumn,
                        onShowTable: props.onShowTable,
                    }}
                    plotCellProps={{
                        gridLayout,
                        columnGroups: computationState.columnGroups,
                        columnAggregations: computationState.columnAggregates,
                        columnAggregationTasks: computationState.tasks.columnAggregationTasks,
                        filteredColumnAggregations: computationState.filteredColumnAggregates,
                        filteredColumnAggregationTasks: computationState.tasks.filteredColumnAggregationTasks,
                        filteredColumnAggregationOutdated: computationState.filteredColumnAggregatesOutdated,
                        tableAggregation: computationState.tableAggregation,
                        filterTableEpoch: computationState.filterTable?.version ?? null,
                        crossFilters,
                        isVisible: true,
                        rightmostVisibleColumn: gridLayout.columnCount - 1,
                        onRequestFilteredColumnAggregation: requestFilteredColumnAggregation,
                        onHistogramFilter: histogramFilter,
                        onBrushingChange: NOOP_BRUSHING,
                        onMostFrequentValueFilter: mostFrequentValueFilter,
                    }}
                />
                <DataTableStickyColumn
                    container={portalContainers?.data ?? null}
                    firstColumnWidth={firstColumnWidth}
                    totalDataHeight={totalDataHeight}
                    startRow={Math.max(0, renderedCells.rowStart)}
                    stopRow={Math.min(dataRowCount - 1, renderedCells.rowStop)}
                    gridData={gridData}
                />
            </div>
            <CellDetailOverlay
                isOpen={cellDetail != null}
                onClose={() => setCellDetail(null)}
                formattedValue={cellDetail?.formattedValue ?? null}
                columnName={cellDetail?.columnName ?? null}
                dataRow={cellDetail?.dataRow ?? 0}
                maxRow={dataRowCount - 1}
                onNavigate={onNavigateCell}
            />
        </div>
    );
};
