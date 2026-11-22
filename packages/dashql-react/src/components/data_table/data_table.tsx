import * as arrow from 'apache-arrow';
import * as React from 'react';
import * as styles from './data_table.module.css';

import { Grid, useGridCallbackRef } from 'react-window';

import { arrowValueToJson, ArrowTableFormatter, isArrowStructuredType } from '@akohn/dashql/platform/compute/arrow_formatter';
import { resolveSummaries } from '@akohn/dashql/platform/compute/computation_types';
import type { ComputationModel } from '../../models/computation_model.js';
import { useComputationTables } from './computation_tables.js';
import { DataCell, DataCellData, TableColumnHeader } from './data_table_cell.js';
import { classNames } from '../../dom/classnames.js';
import { computeTableLayout, DataTableLayout } from './data_table_layout.js';
import { useCrossFilters } from './use_cross_filters.js';
import { useObservedSize } from '../size_observer.js';
import { useLogger } from '../../logger.js';
import { useScrollbarHeight, useScrollbarsOverlay } from '../../dom/scrollbar.js';
import { useDataTableOrdering } from './data_table_ordering.js';
import { useDataTablePortalContainers } from './data_table_portals.js';
import { ResizedColumnWidths, useDataTableColumnResize } from './data_table_column_resize.js';
import { DataTableStickyColumn, DataTableStickyHeaders } from './data_table_sticky_views.js';
import { DataTableFocusStore } from './data_table_focus.js';
import { resolveSearchedRowIndices } from './visible_rows.js';

export { TableColumnHeader } from './data_table_cell.js';
export { resolveComputationTables, useComputationTables, type ComputationTables } from './computation_tables.js';
export type { ComputationDispatch } from './use_cross_filters.js';
export { forEachIntegerValue } from './visible_rows.js';
export { peekFormat, type FormatHint } from './format_peek.js';


// The grid of a result table with its column plots, cross filters, ordering and searches, over the model of the
// computation of the table (`useComputationModel`). The module is the entry of the table: what a host uses of it is
// exported here.

/// What the detail of a cell shows, e.g. in an overlay over the table
export interface CellDetailProps {
    isOpen: boolean;
    onClose: () => void;
    /// The value as the table formats it, null for NULL
    formattedValue: string | null;
    /// The value of a list or a struct as JSON, null for any other value
    structuredValue: object | null;
    columnName: string | null;
    /// The row of the table, from 0
    dataRow: number;
    maxRow: number;
    /// Go to the cell of the row above (-1) or below (1)
    onNavigate: (delta: number) => void;
}

export interface DataTableProps {
    className?: string;
    /// The computation of the table, its tables and its actions
    model: ComputationModel;
    debugMode: boolean;
    maxRows?: number;
    columnHeader?: TableColumnHeader;
    cellBackground?: string;
    onShowTable?: () => void;
    fitHeight?: boolean;
    /// The grid takes the height of its host however few rows it shows, the last of `maxRows` may be cut off
    fillHeight?: boolean;
    maxHeight?: number;
    compact?: boolean;
    /// The detail of a cell that the user opened, none shows no detail
    cellDetail?: React.ComponentType<CellDetailProps>;
}
type Props = DataTableProps;

const MIN_GRID_HEIGHT = 200;
const MIN_GRID_WIDTH = 100;
export const COLUMN_HEADER_HEIGHT = 32;
const COLUMN_HEADER_PLOTS_HEIGHT = 76;
/// The row of the column plots shrinks to a strip that still holds its toggle
const COLUMN_HEADER_PLOTS_COLLAPSED_HEIGHT = 18;
export const ROW_HEIGHT = 26;
/// The row under a preview that `maxRows` cuts, it counts the rows that the preview leaves out
const MORE_ROWS_HEIGHT = 24;
const GRID_OVERSCAN_COUNT = 10;
const NOOP_BRUSHING = () => { };

export function computeGridHeight(
    baseRowCount: number,
    visibleRowCount: number,
    headerHeight: number,
    scrollbarHeight: number,
    fitHeight: boolean,
    maxHeight?: number,
    measuredHeight: number = 0,
    maxRows?: number,
): number {
    const contentHeight = headerHeight + visibleRowCount * ROW_HEIGHT + scrollbarHeight;
    if (fitHeight) {
        const fittedRowCount = maxRows == null ? baseRowCount : Math.min(baseRowCount, maxRows);
        return Math.min(
            headerHeight + fittedRowCount * ROW_HEIGHT + scrollbarHeight,
            maxHeight ?? Number.POSITIVE_INFINITY,
        );
    }
    return maxRows != null ? contentHeight : Math.max(measuredHeight, MIN_GRID_HEIGHT);
}

/// The rows of a table with a column header of names that show in a height, at least one. The last row may be cut
/// off, the table then ends at the bottom of the height and not a fraction of a row above it. A horizontal scrollbar
/// covers the bottom of the rows.
export function fittingRowCount(height: number): number {
    return Math.max(1, Math.ceil((height - COLUMN_HEADER_HEIGHT) / ROW_HEIGHT));
}

interface RenderedCells {
    rowStart: number;
    rowStop: number;
    columnStart: number;
    columnStop: number;
}

/// The grid of the computation of a result, once its table is there
export const DataTable = React.memo((props: Props) => {
    const tables = useComputationTables(props.model.computation, props.model.tables);
    if (tables.dataTable == null) return null;
    return <DataTableGrid {...props} dataTable={tables.dataTable} />;
});

function DataTableGrid(props: Props & { dataTable: arrow.Table }) {
    const logger = useLogger();
    const computationState = props.model.computation;
    const summaryTables = props.model.tables;
    const dispatchComputation = props.model.dispatch;
    const dataTable = props.dataTable;
    const tables = useComputationTables(computationState, summaryTables);
    const matchingRows = tables.matchingRows;
    // The summaries of the columns that the plots draw, they keep their objects while their tables are the same
    const { tableAggregation, columnAggregates, filteredColumnAggregates, columnGroups } = computationState;
    const dataTableHandle = computationState.dataTable;
    const summaries = React.useMemo(
        () => resolveSummaries(
            { dataTable: dataTableHandle, tableAggregation, columnAggregates, filteredColumnAggregates, columnGroups },
            summaryTables,
            logger,
        ),
        [summaryTables, logger, tableAggregation, columnAggregates, filteredColumnAggregates, columnGroups, dataTableHandle],
    );
    const [gridApi, setGridApi] = useGridCallbackRef(null);
    const gridContainerElement = React.useRef(null);
    const gridContainerSize = useObservedSize(gridContainerElement);
    const gridContainerWidth = Math.max(gridContainerSize?.width ?? 0, MIN_GRID_WIDTH);
    const columnHeader = props.columnHeader ?? TableColumnHeader.OnlyColumnName;
    const [plotsCollapsed, setPlotsCollapsed] = React.useState(false);
    const togglePlots = React.useCallback(() => setPlotsCollapsed(c => !c), []);
    const plotsHeight = plotsCollapsed ? COLUMN_HEADER_PLOTS_COLLAPSED_HEIGHT : COLUMN_HEADER_PLOTS_HEIGHT;

    // Get the row-id indirection column from ordering or filtering
    const { orderingTable, dataSearchTable } = computationState;
    const visibleRowIndices = React.useMemo(
        () => resolveSearchedRowIndices({ orderingTable, dataSearchTable }, tables),
        [orderingTable, dataSearchTable, tables],
    );

    // Data row count. Headers are rendered separately via portals
    // When an indirection table is active, show only the derived visible rows
    const totalRowCount = visibleRowIndices?.length ?? dataTable.numRows;
    const dataRowCount = props.maxRows != null ? Math.min(totalRowCount, props.maxRows) : totalRowCount;
    const hiddenRowCount = totalRowCount - dataRowCount;
    // Header configuration
    const headerRowCount = columnHeader === TableColumnHeader.WithColumnPlots ? 2 : 1;
    const visibleColumnGroups = React.useMemo(() => {
        const matches = computationState.columnSearch.matchingColumnGroups;
        return matches == null ? null : new Set(matches);
    }, [computationState.columnSearch.matchingColumnGroups]);
    const searchColumnIndexByGroup = React.useMemo(() => new Map(
        computationState.searchColumns.map(column => [column.columnGroupIdx, column.columnIdx] as const),
    ), [computationState.searchColumns]);

    // Construct the arrow formatter and update it whenever the data table changes
    const tableFormatter = React.useMemo(() => {
        return new ArrowTableFormatter(dataTable.schema, dataTable.batches, logger);
    }, [dataTable, logger]);

    // Columns that the user resized by dragging a border, kept while the table is mounted
    const [resizedColumnWidths, setResizedColumnWidths] = React.useState<ResizedColumnWidths>(() => new Map());

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
        return computeTableLayout(tableFormatter, { columnGroups, dataTable }, props.debugMode, headerRowCount, gridContainerWidth, visibleColumnGroups, resizedColumnWidths);
    }, [
        columnGroups,
        dataTable,
        tableFormatter,
        props.debugMode,
        gridContainerWidth,
        headerRowCount,
        visibleColumnGroups,
        resizedColumnWidths,
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

    const { orderByColumn, getSortDirection } = useDataTableOrdering(computationState, dataTable, dispatchComputation);

    // Maintain the focused cell outside of React state, cells subscribe to their own row
    const [focusStore] = React.useState(() => new DataTableFocusStore());
    const onMouseEnterCell: React.PointerEventHandler<HTMLDivElement> = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const tableRow = Number.parseInt(event.currentTarget.dataset["tableRow"]!);
        const tableCol = Number.parseInt(event.currentTarget.dataset["tableCol"]!);
        focusStore.setFocus(tableRow, tableCol);
    }, [focusStore]);
    const onMouseLeaveCell: React.PointerEventHandler<HTMLDivElement> = React.useCallback((_event: React.PointerEvent<HTMLDivElement>) => {
        focusStore.setFocus(null, null);
    }, [focusStore]);

    // Cell detail overlay state
    const [cellDetail, setCellDetail] = React.useState<{
        visibleRow: number;
        dataRow: number;
        fieldId: number;
        formattedValue: string | null;
        structuredValue: object | null;
        columnName: string | null;
    } | null>(null);
    const onClickCell: React.MouseEventHandler<HTMLDivElement> = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        const visibleRow = Number.parseInt(event.currentTarget.dataset["visibleRow"]!);
        const dataRow = Number.parseInt(event.currentTarget.dataset["tableRow"]!);
        const fieldId = Number.parseInt(event.currentTarget.dataset["tableCol"]!);
        const field = dataTable.schema.fields[fieldId];
        if (field == null) return;
        const isText = field.type.typeId === arrow.Type.Utf8 || field.type.typeId === arrow.Type.LargeUtf8;
        const isStructured = isArrowStructuredType(field.type);
        if (!isText && !isStructured) return;
        const formattedValue = tableFormatter.getValue(dataRow, fieldId);
        const rawValue = isStructured ? dataTable.getChildAt(fieldId)?.get(dataRow) : null;
        const structuredValue = rawValue == null ? null : arrowValueToJson(rawValue) as object;
        const columnName = field.name ?? null;
        setCellDetail({ visibleRow, dataRow, fieldId, formattedValue, structuredValue, columnName });
    }, [tableFormatter, dataTable]);
    const onNavigateCell = React.useCallback((delta: number) => {
        setCellDetail(prev => {
            if (prev == null) return null;
            const visibleRow = prev.visibleRow + delta;
            if (visibleRow < 0 || visibleRow >= dataRowCount) return prev;
            const dataRow = visibleRowIndices == null
                ? visibleRow
                : visibleRowIndices[visibleRow];
            const formattedValue = tableFormatter.getValue(dataRow, prev.fieldId);
            const field = dataTable.schema.fields[prev.fieldId];
            const isStructured = isArrowStructuredType(field.type);
            const rawValue = isStructured ? dataTable.getChildAt(prev.fieldId)?.get(dataRow) : null;
            const structuredValue = rawValue == null ? null : arrowValueToJson(rawValue) as object;
            return { ...prev, visibleRow, dataRow, formattedValue, structuredValue };
        });
    }, [tableFormatter, dataTable, dataRowCount, visibleRowIndices]);

    // Maintain a rendering context for data cells.
    // This context is passed to grid elements as item data.
    const gridData = React.useMemo<DataCellData>(() => ({
        visibleRowIndices,
        gridLayout: gridLayout,
        hideRowHeader: true,
        columnGroups: computationState.columnGroups,
        tableFormatter: tableFormatter,
        onMouseEnter: onMouseEnterCell,
        onMouseLeave: onMouseLeaveCell,
        onClick: onClickCell,
        table: dataTable,
        focus: focusStore,
        rightmostVisibleColumn: gridLayout.columnCount - 1,
        matchingRows,
        searchColumnIndexByGroup,
    }), [
        // Data dependencies that legitimately require cell re-renders
        computationState.columnGroups,
        dataTable,
        visibleRowIndices,
        gridLayout,
        tableFormatter,
        matchingRows,
        searchColumnIndexByGroup,
        // Stable callbacks - included for correctness but won't cause re-renders
        focusStore,
        onMouseEnterCell,
        onMouseLeaveCell,
        onClickCell,
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
        ? COLUMN_HEADER_HEIGHT + plotsHeight
        : COLUMN_HEADER_HEIGHT;
    const scrollbarHeight = useScrollbarHeight();
    const scrollbarsOverlay = useScrollbarsOverlay();
    const needsHorizontalScroll = totalColumnsWidth > gridContainerWidth;
    // An overlay scrollbar would leave an empty band between the last row and the row of the hidden rows, it paints
    // over the last row while scrolling instead
    const horizontalScrollbarHeight = needsHorizontalScroll && !(scrollbarsOverlay && hiddenRowCount > 0)
        ? scrollbarHeight
        : 0;
    const gridContainerHeight = props.fillHeight ? (gridContainerSize?.height ?? 0) : computeGridHeight(
        dataTable.numRows,
        dataRowCount,
        headerHeight,
        horizontalScrollbarHeight,
        props.fitHeight ?? false,
        props.maxHeight,
        gridContainerSize?.height ?? 0,
        props.maxRows,
    );
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


    // Keep the header cell props stable so that the memoized header cells skip unrelated renders
    const nameCellProps = React.useMemo(() => ({
        table: dataTable,
        gridLayout,
        dataFrame: computationState.dataFrame,
        rightmostVisibleColumn: gridLayout.columnCount - 1,
        getSortDirection,
        onOrderByColumn: orderByColumn,
        onShowTable: props.onShowTable,
    }), [dataTable, gridLayout, computationState.dataFrame, getSortDirection, orderByColumn, props.onShowTable]);
    const selectionEpoch = computationState.filterTable?.version ?? computationState.version;
    const dataSearchRequestId = computationState.dataSearchTable?.requestId ?? null;
    const plotCellProps = React.useMemo(() => ({
        gridLayout,
        columnGroups: computationState.columnGroups,
        columnAggregations: summaries.columnAggregates,
        columnAggregationTasks: computationState.tasks.columnAggregationTasks,
        filteredColumnAggregations: summaries.filteredColumnAggregates,
        filteredColumnAggregationTasks: computationState.tasks.filteredColumnAggregationTasks,
        filteredColumnAggregationOutdated: computationState.filteredColumnAggregatesOutdated,
        tableAggregation: summaries.tableAggregation,
        selectionEpoch,
        dataSearchRequestId,
        crossFilters,
        isVisible: true,
        rightmostVisibleColumn: gridLayout.columnCount - 1,
        onRequestFilteredColumnAggregation: requestFilteredColumnAggregation,
        onHistogramFilter: histogramFilter,
        onBrushingChange: NOOP_BRUSHING,
        onMostFrequentValueFilter: mostFrequentValueFilter,
    }), [
        gridLayout,
        computationState.columnGroups,
        summaries,
        computationState.tasks.columnAggregationTasks,
        computationState.tasks.filteredColumnAggregationTasks,
        computationState.filteredColumnAggregatesOutdated,
        selectionEpoch,
        dataSearchRequestId,
        crossFilters,
        requestFilteredColumnAggregation,
        histogramFilter,
        mostFrequentValueFilter,
    ]);

    // Create containers for sticky header and sticky column
    const portalContainers = useDataTablePortalContainers(gridApi);

    // Drag the right border of any cell to resize its column
    const columnResize = useDataTableColumnResize(gridApi, gridLayout, dataTable, setResizedColumnWidths);

    // Total height of data content (for sticky column sizing)
    const totalDataHeight = dataRowCount * ROW_HEIGHT;

    return (
        // The grid can be rendered within the workbook feed's Electron drag region. Opt out so
        // native scrollbar thumbs receive pointer drags instead of moving the application window.
        <div
            className={classNames(styles.root, props.className, {
                [styles.root_compact]: props.compact,
                [styles.root_more_rows]: hiddenRowCount > 0,
            })}
            data-electron-drag-region="false"
            style={{
                ...(props.cellBackground ? { '--data_table_bg': props.cellBackground } : {}),
                // The row of the hidden rows overlaps the bottom border of the last row by a pixel
                ...(props.fitHeight ? { height: gridContainerHeight + (hiddenRowCount > 0 ? MORE_ROWS_HEIGHT - 1 : 0) } : {}),
            } as React.CSSProperties}
        >
            <div className={styles.grid_container} ref={gridContainerElement} {...columnResize}>
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
                    plotsHeight={plotsHeight}
                    plotsCollapsed={plotsCollapsed}
                    onTogglePlots={togglePlots}
                    nameCellProps={nameCellProps}
                    plotCellProps={plotCellProps}
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
            {hiddenRowCount > 0 && <MoreRows count={hiddenRowCount} onShowTable={props.onShowTable} />}
            {props.cellDetail && <props.cellDetail
                isOpen={cellDetail != null}
                onClose={() => setCellDetail(null)}
                formattedValue={cellDetail?.formattedValue ?? null}
                structuredValue={cellDetail?.structuredValue ?? null}
                columnName={cellDetail?.columnName ?? null}
                dataRow={cellDetail?.visibleRow ?? 0}
                maxRow={dataRowCount - 1}
                onNavigate={onNavigateCell}
            />}
        </div>
    );
}

/// The row under a cut preview: the count of the rows it leaves out, a button that opens the full table if there is one
function MoreRows(props: { count: number; onShowTable?: () => void }): React.ReactElement {
    const label = `${props.count.toLocaleString()} more ${props.count === 1 ? 'row' : 'rows'}`;
    if (props.onShowTable == null) {
        return <div className={styles.more_rows} style={{ height: MORE_ROWS_HEIGHT }}>{label}</div>;
    }
    return (
        <button
            type="button"
            className={classNames(styles.more_rows, styles.more_rows_clickable)}
            style={{ height: MORE_ROWS_HEIGHT }}
            onClick={props.onShowTable}
        >
            {label}
        </button>
    );
}
