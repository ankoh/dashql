import * as arrow from 'apache-arrow';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";
import * as styles from './data_table.module.css';

import { Grid, useGridCallbackRef } from 'react-window';

import { ArrowTableFormatter } from './arrow_formatter.js';
import { ComputationAction, TableComputationState } from '../../compute/computation_state.js';
import { CrossFilters } from '../../compute/cross_filters.js';
import { Dispatch } from '../../utils/variant.js';
import { BrushingStateCallback, HistogramFilterCallback } from './histogram_cell.js';
import { MostFrequentValueFilterCallback } from './mostfrequent_cell.js';
import { ORDINAL_COLUMN, OrdinalColumnAggregation, StringColumnAggregation, TableFilteringTask, TableOrderingTask, TableAggregation } from '../../compute/computation_types.js';
import { buildSkeletonStyle, DataCell, DataCellData, HeaderNameCell, HeaderPlotsCell, SkeletonOverlay, TableColumnHeader } from './data_table_cell.js';
import { classNames } from '../../utils/classnames.js';
import { computeTableLayout, DataTableLayout, skipTableLayoutUpdate } from './data_table_layout.js';
import { filterTableDispatched, sortTableDispatched } from '../../compute/computation_logic.js';
import { observeSize } from '../foundations/size_observer.js';
import { useAppConfig } from '../../app_config.js';
import { useLogger } from '../../platform/logger_provider.js';

const LOG_CTX = 'data_table';

interface Props {
    className?: string;
    table: TableComputationState;
    dispatchComputation: Dispatch<ComputationAction>;
    debugMode: boolean;
}

const MIN_GRID_HEIGHT = 200;
const MIN_GRID_WIDTH = 100;
const COLUMN_HEADER_HEIGHT = 32;
const COLUMN_HEADER_PLOTS_HEIGHT = 76;
const ROW_HEIGHT = 26;
const OVERSCAN_ROW_COUNT = 30;

interface FocusedCells {
    row: number | null,
    field: number | null
}

export const DataTable: React.FC<Props> = (props: Props) => {
    const config = useAppConfig();
    const logger = useLogger();
    const computationState = props.table;
    const dataTable = computationState.dataTable;
    const [gridApi, setGridApi] = useGridCallbackRef(null);
    const filterDataTable = computationState.filterTable?.dataTable;
    const gridContainerElement = React.useRef(null);
    const gridContainerSize = observeSize(gridContainerElement);
    const gridContainerHeight = Math.max(gridContainerSize?.height ?? 0, MIN_GRID_HEIGHT);
    const gridContainerWidth = Math.max(gridContainerSize?.width ?? 0, MIN_GRID_WIDTH);
    const columnHeader = (config?.settings?.enableTableColumnPlots ?? false)
        ? TableColumnHeader.WithColumnPlots
        : TableColumnHeader.OnlyColumnName;

    // Get the filter column
    const dataFilter = React.useMemo<arrow.Vector<arrow.Uint64> | null>(() => {
        if (filterDataTable == null) {
            return null;
        }
        if (filterDataTable.numCols !== 1) {
            logger.error(`Filter table has an unexpected column count`, {
                columnCount: filterDataTable.numCols.toString(),
            }, LOG_CTX);
            return null;
        }
        const filterColumn = filterDataTable.getChildAt(0);
        if (filterColumn!.type.typeId !== arrow.Type.Int) {
            logger.error(`Filter table column is not of type UInt64`, {
                actual: filterColumn?.type.toString()
            }, LOG_CTX);
            return null;
        }
        return filterColumn;
    }, [filterDataTable, logger]);

    // Data row count. Headers are rendered separately via portals
    // When a filter is active, show only the filtered rows, not all rows
    const dataRowCount = dataFilter?.length ?? dataTable.numRows ?? 0;
    // Header configuration
    const headerRowCount = columnHeader === TableColumnHeader.WithColumnPlots ? 2 : 1;

    // Construct the arrow formatter and update it whenever the data table changes
    const tableFormatter = React.useMemo(() => {
        return new ArrowTableFormatter(dataTable.schema, dataTable.batches, logger);
    }, [dataTable]);

    // Determine grid dimensions and column widths
    const [gridLayout, setGridLayout] = React.useState<DataTableLayout>({
        columnCount: 0,
        arrowFieldByColumnIndex: new Uint32Array(),
        columnXOffsets: new Float64Array([0]),
        columnAggregateByColumnIndex: new Int32Array(),
        columnGroupByColumnIndex: new Uint32Array(),
        isSystemColumn: new Uint8Array(),
        headerRowCount
    });
    React.useEffect(() => {
        if (tableFormatter) {
            const newGridLayout = computeTableLayout(tableFormatter, computationState, props.debugMode, headerRowCount);
            if (!skipTableLayoutUpdate(gridLayout, newGridLayout)) {
                setGridLayout(newGridLayout);
            }
        }
    }, [
        gridLayout,
        computationState.columnGroups,
        tableFormatter,
        props.debugMode,
    ]);

    // Compute helper to resolve column widths
    const getColumnWidth = React.useCallback((column: number) =>
        gridLayout.columnXOffsets[column + 1] - gridLayout.columnXOffsets[column],
        [gridLayout]);

    // Grid re-renders automatically when cellProps (gridData) changes
    // which includes gridLayout as a dependency

    // Maintain active cross-filters
    const [crossFilters, setCrossFilters] = React.useState<CrossFilters>(new CrossFilters());
    // Track whether the user is actively brushing (for skeleton placeholders)
    const [isBrushing, setIsBrushing] = React.useState(false);
    const onBrushingChange: BrushingStateCallback = React.useCallback((brushing: boolean) => {
        setIsBrushing(brushing);
    }, []);
    // Track visible rows for sticky column virtualization
    const [visibleRows, setVisibleRows] = React.useState<{ start: number; stop: number }>({ start: 0, stop: 0 });

    // Create a callback for changes to the histogram filter.
    // We use refs to layout and column groups to keep the callback stable.
    const gridLayoutRef = React.useRef(gridLayout);
    const columnGroupsRef = React.useRef(computationState.columnGroups);
    gridLayoutRef.current = gridLayout;
    columnGroupsRef.current = computationState.columnGroups;
    const histogramFilter: HistogramFilterCallback = React.useCallback((_table: TableAggregation, columnIndex: number, _column: OrdinalColumnAggregation, brush: [number, number] | null) => {
        const columnGroupId = gridLayoutRef.current.columnGroupByColumnIndex[columnIndex];
        const columnGroup = columnGroupsRef.current[columnGroupId];
        if (columnGroup.type != ORDINAL_COLUMN) {
            return;
        }
        setCrossFilters(filters => {
            if (filters.containsHistogramFilter(columnGroupId, brush)) {
                return filters;
            } else {
                const cloned = filters.clone();
                cloned.addHistogramFilter(columnGroupId, columnGroup.value, brush);
                return cloned;
            }
        });
    }, []);

    const mostFrequentValueFilter: MostFrequentValueFilterCallback = React.useCallback((_table: TableAggregation, _columnIndex: number, _column: StringColumnAggregation, _frequentValueId: number | null) => {
        // const columnGroupId = gridLayoutRef.current.columnGroups[columnIndex];
        // const columnGroup = columnGroupsRef.current[columnGroupId];

        // // Compute filters
        // let filters: pb.dashql.compute.FilterTransform[] = [];
        // switch (columnGroup.type) {
        //     case STRING_COLUMN: {
        //         if (columnGroup.value.valueIdFieldName && frequentValueId != null) {
        //             filters.push(buf.create(pb.dashql.compute.FilterTransformSchema, {
        //                 fieldName: columnGroup.value.valueIdFieldName,
        //                 operator: pb.dashql.compute.FilterOperator.Equal,
        //                 valueU64: BigInt(frequentValueId)
        //             }));
        //         }
        //         break;
        //     }
        // }

        // // Update cross filters
        // setCrossFilters(x => ({
        //     ...x,
        //     [columnGroupId]: filters,
        // }));
    }, []); // Stable - would use refs internally when implemented

    // Effect to filter a table whenever the cross filters change
    React.useEffect(() => {
        if (!computationState.dataFrame || !computationState.rowNumberColumnName) {
            return;
        }
        const filteringTask: TableFilteringTask = {
            tableId: computationState.tableId,
            tableEpoch: computationState.tableEpoch,
            inputDataTable: computationState.dataTable,
            inputDataTableFieldIndex: computationState.dataTableFieldsByName,
            inputDataFrame: computationState.dataFrame,
            filters: crossFilters.createFilterTransforms(),
            rowNumberColumnName: computationState.rowNumberColumnName,
        };
        filterTableDispatched(filteringTask, dispatchComputation);

        // XXX Update all column summaries

    }, [crossFilters]);

    // Order by a column
    const dispatchComputation = props.dispatchComputation;
    const orderByColumn = React.useCallback((fieldId: number) => {
        const fieldName = dataTable.schema.fields[fieldId].name;
        const orderingConstraints: pb.dashql.compute.OrderByConstraint[] = [
            buf.create(pb.dashql.compute.OrderByConstraintSchema, {
                fieldName: fieldName,
                ascending: true,
                nullsFirst: false,
            })
        ];
        // Sort the main table
        if (computationState.dataFrame) {
            const orderingTask: TableOrderingTask = {
                tableId: computationState.tableId,
                tableEpoch: computationState.tableEpoch,
                inputDataTable: computationState.dataTable,
                inputDataTableFieldIndex: computationState.dataTableFieldsByName,
                inputDataFrame: computationState.dataFrame,
                orderingConstraints
            };
            sortTableDispatched(orderingTask, dispatchComputation);
        }
        // XXX Are there cross filters? Then we need to recompute the filter table as well

    }, [computationState, dispatchComputation, logger]);

    // Maintain the focused cell - updates are stored in ref and read during next render
    const focusedCells = React.useRef<FocusedCells | null>(null);
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const onMouseEnterCell: React.PointerEventHandler<HTMLDivElement> = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const tableRow = Number.parseInt(event.currentTarget.dataset["tableRow"]!);
        const tableCol = Number.parseInt(event.currentTarget.dataset["tableCol"]!);
        focusedCells.current = { row: tableRow, field: tableCol };
        forceUpdate();
    }, []);
    const onMouseLeaveCell: React.PointerEventHandler<HTMLDivElement> = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const tableRow = Number.parseInt(event.currentTarget.dataset["tableRow"]!);
        const tableCol = Number.parseInt(event.currentTarget.dataset["tableCol"]!);
        focusedCells.current = { row: tableRow, field: tableCol };
        forceUpdate();
    }, []);

    // Maintain a rendering context for data cells.
    // This context is passed to grid elements as item data.
    // We use a ref to avoid recreating the inner grid element type when data changes.
    const gridDataRef = React.useRef<DataCellData | null>(null);
    const gridData = React.useMemo<DataCellData>(() => ({
        dataFilter: dataFilter,
        gridLayout: gridLayout,
        isBrushing: isBrushing,
        columnGroups: computationState.columnGroups,
        tableFormatter: tableFormatter,
        onMouseEnter: onMouseEnterCell,
        onMouseLeave: onMouseLeaveCell,
        table: computationState.dataTable,
        focusedRow: focusedCells.current?.row ?? null,
        focusedField: focusedCells.current?.field ?? null,
    }), [
        // Data dependencies that legitimately require cell re-renders
        computationState.columnGroups,
        computationState.dataTable,
        dataFilter,
        gridLayout,
        isBrushing,
        tableFormatter,
        // Stable callbacks (empty deps) - included for correctness but won't cause re-renders
        onMouseEnterCell,
        onMouseLeaveCell,
        // Note: focusedCells is a ref, reading it here won't trigger re-renders
        // but the value will be fresh when gridData is created
    ]);
    gridDataRef.current = gridData;

    // Listen to rendering events to check if the column widths changed and track visible rows
    const onCellsRendered = React.useCallback((
        _visibleCells: { rowStartIndex: number; rowStopIndex: number },
        allCells: { rowStartIndex: number; rowStopIndex: number }
    ) => {
        // Check if we need to update the grid layout
        if (gridApi && tableFormatter) {
            const newGridColumns = computeTableLayout(tableFormatter, computationState, props.debugMode, headerRowCount);
            if (!skipTableLayoutUpdate(gridLayout, newGridColumns)) {
                setGridLayout(newGridColumns);
            }
        }
        // Update visible rows for sticky column virtualization
        setVisibleRows(prev => {
            if (prev.start === allCells.rowStartIndex && prev.stop === allCells.rowStopIndex) {
                return prev; // Avoid unnecessary re-renders
            }
            return { start: allCells.rowStartIndex, stop: allCells.rowStopIndex };
        });
    }, [gridLayout, tableFormatter, props.debugMode, gridApi]);

    // Compute grid dimensions
    const totalColumnsWidth = gridLayout.columnXOffsets[gridLayout.columnCount] ?? 0;
    const firstColumnWidth = getColumnWidth(0);
    const headerHeight = columnHeader === TableColumnHeader.WithColumnPlots
        ? COLUMN_HEADER_HEIGHT + COLUMN_HEADER_PLOTS_HEIGHT
        : COLUMN_HEADER_HEIGHT;


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
                            onOrderByColumn={orderByColumn}
                        />
                    </div>
                    {/* Other header cells */}
                    {Array.from({ length: gridLayout.columnCount - 1 }, (_, i) => {
                        const colIndex = i + 1;
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
                                onOrderByColumn={orderByColumn}
                            />
                        );
                    })}
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
                                tableAggregation={computationState.tableAggregation}
                                onHistogramFilter={histogramFilter}
                                onBrushingChange={onBrushingChange}
                                onMostFrequentValueFilter={mostFrequentValueFilter}
                            />
                        </div>
                        {Array.from({ length: gridLayout.columnCount - 1 }, (_, i) => {
                            const colIndex = i + 1;
                            return (
                                <HeaderPlotsCell
                                    key={`header-1-${colIndex}`}
                                    columnIndex={colIndex}
                                    style={{
                                        width: getColumnWidth(colIndex),
                                        height: COLUMN_HEADER_PLOTS_HEIGHT,
                                        flexShrink: 0,
                                    }}
                                    gridLayout={gridLayout}
                                    columnGroups={computationState.columnGroups}
                                    columnAggregations={computationState.columnAggregates}
                                    columnAggregationTasks={computationState.tasks.columnAggregationTasks}
                                    filteredColumnAggregations={computationState.filteredColumnAggregates}
                                    tableAggregation={computationState.tableAggregation}
                                    onHistogramFilter={histogramFilter}
                                    onBrushingChange={onBrushingChange}
                                    onMostFrequentValueFilter={mostFrequentValueFilter}
                                />
                            );
                        })}
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

        // Only render visible rows plus overscan for smooth scrolling
        const startRow = Math.max(0, visibleRows.start - OVERSCAN_ROW_COUNT);
        const stopRow = Math.min(dataRowCount, visibleRows.stop + OVERSCAN_ROW_COUNT);
        const visibleCount = stopRow - startRow;

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
                                />
                            </div>
                        );
                    }
                )}
            </div>,
            portalContainers.data
        );
    };

    // Precompute skeleton style once per grid layout change
    const skeletonStyle = React.useMemo(
        () => buildSkeletonStyle(gridLayout.columnXOffsets, firstColumnWidth, ROW_HEIGHT),
        [gridLayout.columnXOffsets, firstColumnWidth]
    );

    // Render skeleton overlay when brushing - single element with CSS gradients + masks, O(1) cost
    const renderSkeletonsIntoPortal = () => {
        if (!isBrushing || !portalContainers?.data) return null;
        return ReactDOM.createPortal(
            <SkeletonOverlay
                headerHeight={headerHeight}
                firstColumnWidth={firstColumnWidth}
                totalColumnsWidth={totalColumnsWidth}
                totalDataHeight={totalDataHeight}
                skeletonStyle={skeletonStyle}
            />,
            portalContainers.data
        );
    };

    return (
        <div className={classNames(styles.root, props.className)} ref={gridContainerElement}>
            <Grid
                gridRef={setGridApi}
                style={{ width: gridContainerWidth, height: gridContainerHeight }}
                columnCount={gridLayout.columnCount}
                columnWidth={getColumnWidth}
                rowCount={dataRowCount}
                rowHeight={ROW_HEIGHT}
                onCellsRendered={onCellsRendered}
                overscanCount={OVERSCAN_ROW_COUNT}
                cellComponent={DataCell}
                cellProps={gridData}
                className={styles.data_grid}
            />
            {renderStickyHeadersIntoPortal()}
            {renderStickyColumnsIntoPortal()}
            {renderSkeletonsIntoPortal()}
        </div>
    );
};

