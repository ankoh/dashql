import * as arrow from 'apache-arrow';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as styles from './data_table.module.css';

import { Grid, useGridCallbackRef } from 'react-window';

import { ArrowTableFormatter } from './arrow_formatter.js';
import { CLEAR_TABLE_ORDERING, ComputationAction, TableComputationState } from '../../compute/computation_state.js';
import { Dispatch } from '../../utils/variant.js';
import { OrderByConstraint } from '../../sql/sqlframe_builder.js';
import { TableOrderingTask, TaskStatus } from '../../compute/computation_types.js';
import { DataCell, DataCellData, HeaderNameCell, HeaderPlotsCell, TableColumnHeader } from './data_table_cell.js';
import { classNames } from '../../utils/classnames.js';
import { computeTableLayout, DataTableLayout } from './data_table_layout.js';
import { sortTableDispatched } from '../../compute/computation_logic.js';
import { useCrossFilters } from './use_cross_filters.js';
import { observeSize } from '../foundations/size_observer.js';
import { CellDetailOverlay } from './cell_detail_overlay.js';
import { useAppConfig } from '../../app_config.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useScrollbarHeight } from '../../utils/scrollbar.js';
import { getColumnSortDirection, getNextColumnSortDirection } from './data_table_ordering.js';

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
}

const MIN_GRID_HEIGHT = 200;
const MIN_GRID_WIDTH = 100;
const COLUMN_HEADER_HEIGHT = 32;
const COLUMN_HEADER_PLOTS_HEIGHT = 76;
const ROW_HEIGHT = 26;
const GRID_OVERSCAN_COUNT = 10;
const NOOP_BRUSHING = () => { };

function areOrderingConstraintsEqual(left: OrderByConstraint[], right: OrderByConstraint[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    for (let i = 0; i < left.length; ++i) {
        const a = left[i];
        const b = right[i];
        if (
            a.field !== b.field
            || (a.ascending ?? true) !== (b.ascending ?? true)
            || (a.nullsFirst ?? false) !== (b.nullsFirst ?? false)
        ) {
            return false;
        }
    }
    return true;
}

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
    const { histogramFilter, mostFrequentValueFilter, requestFilteredColumnAggregation } = useCrossFilters(
        computationState,
        dispatchComputation,
        gridLayout,
    );

    const activeOrderingConstraints = React.useMemo<OrderByConstraint[]>(() => {
        const taskOrdering = computationState.tasks.orderingTask?.orderingConstraints;
        if (taskOrdering != null && taskOrdering.length > 0) {
            return taskOrdering;
        }
        return computationState.dataTableOrdering;
    }, [computationState.dataTableOrdering, computationState.tasks.orderingTask?.orderingConstraints]);

    // Recompute ordering whenever the active sort changes or the filtered subset changes.
    React.useEffect(() => {
        if (
            !computationState.dataFrame
            || !computationState.rowNumberColumnName
            || activeOrderingConstraints.length === 0
        ) {
            return;
        }
        const currentTask = computationState.tasks.orderingTask;
        const currentOrdering = computationState.orderingTable;
        const filterVersion = computationState.filterTable?.version ?? null;
        const hasUpToDateOrdering = (
            currentOrdering != null
            && currentTask?.progress.status === TaskStatus.TASK_SUCCEEDED
            && currentTask.tableVersion.filterMatches(computationState.version)
            && (filterVersion ? (currentTask.filterTable?.version?.filterMatches(filterVersion) ?? false) : (currentTask.filterTable === null))
            && areOrderingConstraintsEqual(currentOrdering.orderingConstraints, activeOrderingConstraints)
        );
        if (hasUpToDateOrdering) {
            return;
        }
        const hasUpToDateRunningTask = (
            currentTask?.progress.status === TaskStatus.TASK_RUNNING
            && currentTask.tableVersion.filterMatches(computationState.version)
            && (filterVersion ? (currentTask.filterTable?.version?.filterMatches(filterVersion) ?? false) : (currentTask.filterTable === null))
            && areOrderingConstraintsEqual(currentTask.orderingConstraints, activeOrderingConstraints)
        );
        if (hasUpToDateRunningTask) {
            return;
        }
        const orderingTask: TableOrderingTask = {
            tableId: computationState.tableId,
            tableVersion: computationState.version,
            inputDataTable: computationState.dataTable,
            inputDataTableFieldIndex: computationState.dataTableFieldsByName,
            inputDataFrame: computationState.dataFrame,
            filterTable: computationState.filterTable,
            rowNumberColumnName: computationState.rowNumberColumnName,
            orderingConstraints: activeOrderingConstraints,
        };
        void sortTableDispatched(orderingTask, dispatchComputation);
    }, [
        activeOrderingConstraints,
        computationState.dataFrame,
        computationState.dataTable,
        computationState.dataTableFieldsByName,
        computationState.filterTable,
        computationState.orderingTable,
        computationState.rowNumberColumnName,
        computationState.version,
        computationState.tableId,
        computationState.tasks.orderingTask,
        dispatchComputation,
    ]);

    // Order by a column
    const orderByColumn = React.useCallback((fieldId: number) => {
        const fieldName = dataTable.schema.fields[fieldId].name;
        const nextSortDirection = getNextColumnSortDirection(fieldName, activeOrderingConstraints);
        if (nextSortDirection == null) {
            dispatchComputation({ type: CLEAR_TABLE_ORDERING, value: computationState.tableId });
            return;
        }
        const orderingConstraints: OrderByConstraint[] = [{
            field: fieldName,
            ascending: nextSortDirection,
            nullsFirst: false,
        }];
        if (computationState.dataFrame && computationState.rowNumberColumnName) {
            const orderingTask: TableOrderingTask = {
                tableId: computationState.tableId,
                tableVersion: computationState.version,
                inputDataTable: computationState.dataTable,
                inputDataTableFieldIndex: computationState.dataTableFieldsByName,
                inputDataFrame: computationState.dataFrame,
                filterTable: computationState.filterTable,
                rowNumberColumnName: computationState.rowNumberColumnName,
                orderingConstraints
            };
            void sortTableDispatched(orderingTask, dispatchComputation);
        }
    }, [activeOrderingConstraints, computationState, dataTable.schema.fields, dispatchComputation]);

    const getSortDirection = React.useCallback((fieldId: number) => {
        const fieldName = dataTable.schema.fields[fieldId].name;
        return getColumnSortDirection(fieldName, activeOrderingConstraints);
    }, [activeOrderingConstraints, dataTable.schema.fields]);

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
    const gridContainerHeight = props.maxRows != null
        ? headerHeight + dataRowCount * ROW_HEIGHT + (needsHorizontalScroll ? scrollbarHeight : 0)
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
    const [portalContainers, setPortalContainers] = React.useState<{
        header: HTMLDivElement;
        data: HTMLDivElement;
    } | null>(null);

    React.useEffect(() => {
        const gridElement = gridApi?.element;
        if (!gridElement) {
            setPortalContainers(null);
            return;
        }

        // Create header container and prepend it (will be first in DOM, before Grid's inner content)
        const headerContainer = document.createElement('div');
        headerContainer.className = styles.sticky_header_portal;
        gridElement.prepend(headerContainer);

        // Create column container and append it (will be after Grid's inner content)
        const dataContainer = document.createElement('div');
        dataContainer.className = styles.sticky_column_portal;
        gridElement.appendChild(dataContainer);

        setPortalContainers({ header: headerContainer, data: dataContainer });
        return () => {
            headerContainer.remove();
            dataContainer.remove();
            setPortalContainers(null);
        };
    }, [gridApi]);

    // Total height of data content (for sticky column sizing)
    const totalDataHeight = dataRowCount * ROW_HEIGHT;

    // Render sticky headers via portal into the prepended container.
    // Since it's before the Grid's inner content, sticky positioning works natively.
    const renderStickyHeadersIntoPortal = () => {
        if (!portalContainers?.header) return null;

        return ReactDOM.createPortal(
            <div
                className={styles.sticky_header_container}
                style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 10,
                    width: totalColumnsWidth,
                    height: headerHeight,
                }}
            >
                {/* Row 0: Column headers */}
                <div className={styles.sticky_header_row} style={{ display: 'flex', height: COLUMN_HEADER_HEIGHT }}>
                    {/* Sticky corner cell */}
                    <div style={{ position: 'sticky', left: 0, zIndex: 11, flexShrink: 0 }}>
                        <HeaderNameCell
                            columnIndex={0}
                            style={{ width: firstColumnWidth, height: COLUMN_HEADER_HEIGHT }}
                            table={computationState.dataTable}
                            gridLayout={gridLayout}
                            dataFrame={computationState.dataFrame}
                            rightmostVisibleColumn={gridLayout.columnCount - 1}
                            sortAscending={getSortDirection(gridLayout.arrowFieldByColumnIndex[0])}
                            onOrderByColumn={orderByColumn}
                            onShowTable={props.onShowTable}
                        />
                    </div>
                    {leftHeaderSpacerWidth > 0 && <div style={{ width: leftHeaderSpacerWidth, flexShrink: 0 }} />}
                    {/* Render only the same buffered columns as the virtualized grid. */}
                    {Array.from({ length: renderedColumnCount }, (_, i) => {
                        const colIndex = firstRenderedColumn + i;
                        return (
                            <HeaderNameCell
                                key={`header-0-${colIndex}`}
                                columnIndex={colIndex}
                                style={{
                                    width: getColumnWidth(colIndex),
                                    height: COLUMN_HEADER_HEIGHT,
                                    flexShrink: 0,
                                }}
                                table={computationState.dataTable}
                                gridLayout={gridLayout}
                                dataFrame={computationState.dataFrame}
                                rightmostVisibleColumn={gridLayout.columnCount - 1}
                                sortAscending={getSortDirection(gridLayout.arrowFieldByColumnIndex[colIndex])}
                                onOrderByColumn={orderByColumn}
                                onShowTable={props.onShowTable}
                            />
                        );
                    })}
                    {rightHeaderSpacerWidth > 0 && <div style={{ width: rightHeaderSpacerWidth, flexShrink: 0 }} />}
                </div>

                {/* Row 1: Column plots (if enabled) */}
                {columnHeader === TableColumnHeader.WithColumnPlots && (
                    <div className={styles.sticky_header_row} style={{ display: 'flex', height: COLUMN_HEADER_PLOTS_HEIGHT }}>
                        <div style={{ position: 'sticky', left: 0, zIndex: 11, flexShrink: 0 }}>
                            <HeaderPlotsCell
                                columnIndex={0}
                                style={{ width: firstColumnWidth, height: COLUMN_HEADER_PLOTS_HEIGHT }}
                                gridLayout={gridLayout}
                                columnGroups={computationState.columnGroups}
                                columnAggregations={computationState.columnAggregates}
                                columnAggregationTasks={computationState.tasks.columnAggregationTasks}
                                filteredColumnAggregations={computationState.filteredColumnAggregates}
                                filteredColumnAggregationTasks={computationState.tasks.filteredColumnAggregationTasks}
                                filteredColumnAggregationOutdated={computationState.filteredColumnAggregatesOutdated}
                                tableAggregation={computationState.tableAggregation}
                                filterTableEpoch={computationState.filterTable?.version ?? null}
                                isVisible={true}
                                rightmostVisibleColumn={gridLayout.columnCount - 1}
                                onRequestFilteredColumnAggregation={requestFilteredColumnAggregation}
                                onHistogramFilter={histogramFilter}
                                onBrushingChange={NOOP_BRUSHING}
                                onMostFrequentValueFilter={mostFrequentValueFilter}
                            />
                        </div>
                        {leftHeaderSpacerWidth > 0 && <div style={{ width: leftHeaderSpacerWidth, flexShrink: 0 }} />}
                        {Array.from({ length: renderedColumnCount }, (_, i) => {
                            const colIndex = firstRenderedColumn + i;
                            const style = {
                                width: getColumnWidth(colIndex),
                                height: COLUMN_HEADER_PLOTS_HEIGHT,
                                flexShrink: 0,
                            };
                            return (
                                <HeaderPlotsCell
                                    key={`header-1-${colIndex}`}
                                    columnIndex={colIndex}
                                    style={style}
                                    gridLayout={gridLayout}
                                    columnGroups={computationState.columnGroups}
                                    columnAggregations={computationState.columnAggregates}
                                    columnAggregationTasks={computationState.tasks.columnAggregationTasks}
                                    filteredColumnAggregations={computationState.filteredColumnAggregates}
                                    filteredColumnAggregationTasks={computationState.tasks.filteredColumnAggregationTasks}
                                    filteredColumnAggregationOutdated={computationState.filteredColumnAggregatesOutdated}
                                    tableAggregation={computationState.tableAggregation}
                                    filterTableEpoch={computationState.filterTable?.version ?? null}
                                    isVisible={true}
                                    rightmostVisibleColumn={gridLayout.columnCount - 1}
                                    onRequestFilteredColumnAggregation={requestFilteredColumnAggregation}
                                    onHistogramFilter={histogramFilter}
                                    onBrushingChange={NOOP_BRUSHING}
                                    onMostFrequentValueFilter={mostFrequentValueFilter}
                                />
                            );
                        })}
                        {rightHeaderSpacerWidth > 0 && <div style={{ width: rightHeaderSpacerWidth, flexShrink: 0 }} />}
                    </div>
                )}
            </div>,
            portalContainers.header
        );
    };

    // Render sticky first column via portal - uses pure CSS sticky positioning
    // The column is appended to Grid's scroll container and uses sticky left: 0
    // Uses negative margin-top to pull up and overlay Grid content
    const renderStickyColumnsIntoPortal = () => {
        if (!portalContainers?.data) return null;

        // allCells already includes react-window's overscan; do not apply it a second time.
        const startRow = Math.max(0, renderedCells.rowStart);
        const stopRow = Math.min(dataRowCount - 1, renderedCells.rowStop);
        const visibleCount = Math.max(0, stopRow - startRow + 1);

        return ReactDOM.createPortal(
            <div
                className={styles.sticky_column_container}
                style={{
                    position: 'sticky',
                    left: 0,
                    width: firstColumnWidth,
                    height: totalDataHeight,
                    marginTop: -totalDataHeight, // Pull up to overlay Grid content
                    zIndex: 5,
                    pointerEvents: 'none',
                }}
            >
                {/* Render only visible first column cells with absolute positioning */}
                {Array.from(
                    { length: visibleCount },
                    (_, i) => {
                        const dataRowIndex = startRow + i;
                        return (
                            <div
                                key={`col0-${dataRowIndex}`}
                                style={{
                                    position: 'absolute',
                                    top: dataRowIndex * ROW_HEIGHT,
                                    left: 0,
                                    width: firstColumnWidth,
                                    height: ROW_HEIGHT,
                                    pointerEvents: 'auto',
                                }}
                            >
                                <DataCell
                                    ariaAttributes={{ "aria-colindex": 1, role: "gridcell" }}
                                    rowIndex={dataRowIndex}
                                    columnIndex={0}
                                    style={{ width: firstColumnWidth, height: ROW_HEIGHT }}
                                    {...gridData}
                                    hideRowHeader={false}
                                />
                            </div>
                        );
                    }
                )}
            </div>,
            portalContainers.data
        );
    };

    return (
        <div className={classNames(styles.root, props.className)} style={props.cellBackground ? { '--data_table_bg': props.cellBackground } as React.CSSProperties : undefined}>
            <div className={styles.grid_container} ref={gridContainerElement}>
                <Grid
                    gridRef={setGridApi}
                    style={{ width: gridContainerWidth, height: gridContainerHeight, overflowY: props.maxRows != null ? 'hidden' : undefined }}
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
                {renderStickyHeadersIntoPortal()}
                {renderStickyColumnsIntoPortal()}
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
