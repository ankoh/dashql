import * as arrow from 'apache-arrow';
import * as React from 'react';
import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";
import * as styles from './data_table.module.css';

import { VariableSizeGrid as Grid, GridItemKeySelector, GridOnItemsRenderedProps, GridOnScrollProps } from 'react-window';

import { classNames } from '../../utils/classnames.js';
import { observeSize } from '../foundations/size_observer.js';
import { ArrowTableFormatter } from './arrow_formatter.js';
import { GridCellLocation, useStickyRowAndColumnHeaders } from '../foundations/sticky_grid.js';
import { ComputationAction, TableComputationState } from '../../compute/computation_state.js';
import { Dispatch } from '../../utils/variant.js';
import { ORDINAL_COLUMN, OrdinalColumnSummary, StringColumnSummary, TableFilteringTask, TableOrderingTask, TableSummary } from '../../compute/computation_types.js';
import { filterTable, sortTable } from '../../compute/computation_logic.js';
import { useLogger } from '../../platform/logger_provider.js';
import { HistogramFilterCallback } from './histogram_cell.js';
import { MostFrequentValueFilterCallback } from './mostfrequent_cell.js';
import { useAppConfig } from '../../app_config.js';
import { computeTableLayout, DataTableLayout, skipTableLayoutUpdate } from './data_table_layout.js';
import { TableCell, TableCellData, TableColumnHeader } from './data_table_cell.js';
import { CrossFilters } from '../../compute/cross_filters.js';

const LOG_CTX = 'data_table';

interface Props {
    className?: string;
    table: TableComputationState;
    dispatchComputation: Dispatch<ComputationAction>;
}

const MIN_GRID_HEIGHT = 200;
const MIN_GRID_WIDTH = 100;
const COLUMN_HEADER_HEIGHT = 32;
const COLUMN_HEADER_PLOTS_HEIGHT = 76;
const ROW_HEIGHT = 26;
const OVERSCAN_ROW_COUNT = 30;
const MAX_VALUE_COLUMN_WIDTH = 300;

interface FocusedCells {
    row: number | null,
    field: number | null
}

export const DataTable: React.FC<Props> = (props: Props) => {
    const config = useAppConfig();
    const logger = useLogger();
    const computationState = props.table;
    const dataTable = computationState.dataTable;
    const dataGrid = React.useRef<Grid>(null);
    const filterDataTable = computationState.filterTable?.dataTable;
    const gridContainerElement = React.useRef(null);
    const gridContainerSize = observeSize(gridContainerElement);
    const gridContainerHeight = Math.max(gridContainerSize?.height ?? 0, MIN_GRID_HEIGHT);
    const gridContainerWidth = Math.max(gridContainerSize?.width ?? 0, MIN_GRID_WIDTH);
    const columnHeader = (config?.settings?.enableTableColumnPlots ?? false)
        ? TableColumnHeader.WithColumnPlots
        : TableColumnHeader.OnlyColumnName;

    // Enable debug mode?
    const interfaceDebugMode = config?.settings?.interfaceDebugMode ?? false;

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
    let gridRowCount = 1 + (dataFilter?.length ?? dataTable.numRows ?? 0);

    // Adjust based on the column header visibility
    let getRowHeight: (_row: number) => number;
    let getRowOffset: (row: number) => number;
    let headerRowCount: number;
    switch (columnHeader) {
        case TableColumnHeader.OnlyColumnName:
            headerRowCount = 1;
            getRowHeight = (row: number) => (row == 0) ? COLUMN_HEADER_HEIGHT : ROW_HEIGHT;
            getRowOffset = (row: number) => (row > 0 ? COLUMN_HEADER_HEIGHT : 0) + (Math.max(row, 1) - 1) * ROW_HEIGHT;
            break;
        case TableColumnHeader.WithColumnPlots:
            headerRowCount = 2;
            gridRowCount += 1;
            getRowHeight = (row: number) => {
                switch (row) {
                    case 0: return COLUMN_HEADER_HEIGHT;
                    case 1: return COLUMN_HEADER_PLOTS_HEIGHT;
                    default: return ROW_HEIGHT
                }
            }
            getRowOffset = (row: number) =>
                (row > 0 ? COLUMN_HEADER_HEIGHT : 0)
                + (row > 1 ? COLUMN_HEADER_PLOTS_HEIGHT : 0)
                + (Math.max(row, 2) - 2) * ROW_HEIGHT;
            break;
    }

    // Construct the arrow formatter and update it whenever the data table changes
    const tableFormatter = React.useMemo(() => {
        return new ArrowTableFormatter(dataTable.schema, dataTable.batches, logger);
    }, [dataTable]);

    // Determine grid dimensions and column widths
    const [gridLayout, setGridLayout] = React.useState<DataTableLayout>({
        columnCount: 0,
        arrowFieldByColumnIndex: new Uint32Array(),
        columnXOffsets: new Float64Array([0]),
        columnSummaryByColumnIndex: new Int32Array(),
        columnGroupByColumnIndex: new Uint32Array(),
        isSystemColumn: new Uint8Array(),
        headerRowCount
    });
    React.useEffect(() => {
        if (tableFormatter) {
            const newGridLayout = computeTableLayout(tableFormatter, computationState, interfaceDebugMode, headerRowCount);
            if (!skipTableLayoutUpdate(gridLayout, newGridLayout)) {
                setGridLayout(newGridLayout);
            }
        }
    }, [
        gridLayout,
        computationState.columnGroups,
        tableFormatter,
        interfaceDebugMode,
    ]);

    // Compute helper to resolve a cell location
    const gridCellLocation = React.useMemo<GridCellLocation>(() => ({
        getRowHeight,
        getRowOffset,
        getColumnWidth: (column: number) => gridLayout.columnXOffsets[column + 1] - gridLayout.columnXOffsets[column],
        getColumnOffset: (column: number) => gridLayout.columnXOffsets[column],
    }), [gridLayout]);

    // Rerender grids when the grid layout changes
    React.useEffect(() => {
        if (dataGrid.current) {
            dataGrid.current.resetAfterColumnIndex(0);
        }
    }, [gridCellLocation]);

    // Maintain active cross-filters
    const [crossFilters, setCrossFilters] = React.useState<CrossFilters>(new CrossFilters());
    const histogramFilter: HistogramFilterCallback = React.useCallback((_table: TableSummary, columnIndex: number, _column: OrdinalColumnSummary, brush: [number, number] | null) => {
        const columnGroupId = gridLayout.columnGroupByColumnIndex[columnIndex];
        const columnGroup = computationState.columnGroups[columnGroupId];
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
    }, [gridLayout, computationState]);

    const mostFrequentValueFilter: MostFrequentValueFilterCallback = React.useCallback((table: TableSummary, columnIndex: number, column: StringColumnSummary, frequentValueId: number | null) => {
        // const columnGroupId = gridLayout.columnGroups[columnIndex];
        // const columnGroup = columnGroups[columnGroupId];

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
    }, [gridLayout, computationState.columnGroups]);

    // Effect to filter a table whenever the cross filters change
    React.useEffect(() => {
        if (!computationState.dataFrame || !computationState.rowNumberColumnName) {
            return;
        }
        const filteringTask: TableFilteringTask = {
            tableId: computationState.tableId,
            inputDataTable: computationState.dataTable,
            inputDataTableFieldIndex: computationState.dataTableFieldsByName,
            inputDataFrame: computationState.dataFrame,
            filters: crossFilters.createFilterTransforms(),
            rowNumberColumnName: computationState.rowNumberColumnName,
        };
        filterTable(filteringTask, dispatchComputation, logger);

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
                inputDataTable: computationState.dataTable,
                inputDataTableFieldIndex: computationState.dataTableFieldsByName,
                inputDataFrame: computationState.dataFrame,
                orderingConstraints
            };
            sortTable(orderingTask, dispatchComputation, logger);
        }
        // XXX Are there cross filters? Then we need to recompute the filter table as well

    }, [computationState, dispatchComputation, logger]);

    // Maintain the focused cell
    const focusedCells = React.useRef<FocusedCells | null>(null);
    const onMouseEnterCell: React.PointerEventHandler<HTMLDivElement> = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const tableRow = Number.parseInt(event.currentTarget.dataset["tableRow"]!);
        const tableCol = Number.parseInt(event.currentTarget.dataset["tableCol"]!);
        focusedCells.current = { row: tableRow, field: tableCol };
        dataGrid.current?.resetAfterColumnIndex(0);
    }, []);
    const onMouseLeaveCell: React.PointerEventHandler<HTMLDivElement> = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const tableRow = Number.parseInt(event.currentTarget.dataset["tableRow"]!);
        const tableCol = Number.parseInt(event.currentTarget.dataset["tableCol"]!);
        focusedCells.current = { row: tableRow, field: tableCol };
        dataGrid.current?.resetAfterColumnIndex(0);
    }, []);

    // Maintain a rendering context
    // This context is passed to grid elements as item data.
    const gridData = React.useMemo<TableCellData>(() => ({
        headerVariant: columnHeader,
        dataFrame: computationState.dataFrame,
        dataFilter: dataFilter,
        gridLayout: gridLayout,
        columnGroups: computationState.columnGroups,
        columnGroupSummaries: computationState.columnGroupSummaries,
        columnGroupSummariesStatus: computationState.columnGroupSummariesStatus,
        tableFormatter: tableFormatter,
        onMouseEnter: onMouseEnterCell,
        onMouseLeave: onMouseLeaveCell,
        onOrderByColumn: orderByColumn,
        table: computationState.dataTable,
        tableSummary: computationState.tableSummary,
        focusedRow: focusedCells.current?.row ?? null,
        focusedField: focusedCells.current?.field ?? null,
        onHistogramFilter: histogramFilter,
        onMostFrequentValueFilter: mostFrequentValueFilter,
    }), [
        computationState.columnGroupSummaries,
        computationState.columnGroupSummariesStatus,
        computationState.columnGroups,
        computationState.dataFrame,
        computationState.dataTable,
        computationState.tableSummary,
        dataFilter,
        gridLayout,
        tableFormatter,
        onMouseEnterCell,
        onMouseLeaveCell,
        orderByColumn,
        focusedCells.current?.row,
        focusedCells.current?.field,
        histogramFilter,
        mostFrequentValueFilter,
    ]);

    // Listen to rendering events to check if the column widths changed.
    // Table elements are formatted lazily so we do not know upfront how wide a column will be.
    const onItemsRendered = React.useCallback((_event: GridOnItemsRenderedProps) => {
        if (dataGrid.current && tableFormatter) {
            const newGridColumns = computeTableLayout(tableFormatter, computationState, interfaceDebugMode, headerRowCount);
            if (!skipTableLayoutUpdate(gridLayout, newGridColumns)) {
                setGridLayout(newGridColumns);
            }
        }
        // XXX Schedule tasks based on visible rows
    }, [gridLayout, tableFormatter, interfaceDebugMode]);

    React.useEffect(() => {
        // console.log(computationState.filterTable?.dataTable.toString());
    }, [computationState.filterTable]);


    // We need stable cell keys across filtering
    const computeCellKey = React.useCallback<GridItemKeySelector<TableCellData>>((props: { columnIndex: number; rowIndex: number; data: TableCellData; }) => {
        if (props.rowIndex < props.data.gridLayout.headerRowCount) {
            return (props.data.gridLayout.columnCount * props.rowIndex + props.columnIndex).toString();
        } else if (props.data.dataFilter) {
            const dataRowIndex = props.rowIndex - props.data.gridLayout.headerRowCount;
            const mappedRowIndex = Math.max(Number(props.data.dataFilter.get(dataRowIndex)), 1) - 1;
            return (props.data.gridLayout.columnCount * mappedRowIndex + props.columnIndex).toString();
        } else {
            const dataRowIndex = props.rowIndex - props.data.gridLayout.headerRowCount;
            return (props.data.gridLayout.columnCount * dataRowIndex + props.columnIndex).toString();
        }

    }, []);

    // Inner grid element type to render sticky row and column headers
    const InnerGridElementType = useStickyRowAndColumnHeaders(TableCell, gridCellLocation, styles.data_grid_cells, headerRowCount, gridData);

    return (
        <div className={classNames(styles.root, props.className)} ref={gridContainerElement}>
            <Grid
                ref={dataGrid}
                columnCount={gridLayout.columnCount}
                columnWidth={gridCellLocation.getColumnWidth}
                estimatedColumnWidth={MAX_VALUE_COLUMN_WIDTH}
                rowCount={gridRowCount}
                rowHeight={gridCellLocation.getRowHeight}
                height={gridContainerHeight}
                width={gridContainerWidth}
                onItemsRendered={onItemsRendered}
                overscanRowCount={OVERSCAN_ROW_COUNT}
                innerElementType={InnerGridElementType}
                itemData={gridData}
                itemKey={computeCellKey}
            >
                {TableCell}
            </Grid>
        </div>
    );
};

