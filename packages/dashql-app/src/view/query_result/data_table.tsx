import * as arrow from 'apache-arrow';
import * as React from 'react';
import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";
import * as styles from './data_table.module.css';
import * as symbols from '../../../static/svg/symbols.generated.svg';

import { VariableSizeGrid as Grid, GridChildComponentProps, GridItemKeySelector, GridOnItemsRenderedProps } from 'react-window';

import { classNames } from '../../utils/classnames.js';
import { observeSize } from '../foundations/size_observer.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../view/foundations/button.js';
import { ArrowTableFormatter } from './arrow_formatter.js';
import { GridCellLocation, useStickyRowAndColumnHeaders } from '../foundations/sticky_grid.js';
import { ComputationAction, TableComputationState } from '../../compute/computation_state.js';
import { Dispatch } from '../../utils/variant.js';
import { ColumnSummaryVariant, GridColumnGroup, LIST_COLUMN, ORDINAL_COLUMN, OrdinalColumnSummary, ROWNUMBER_COLUMN, SKIPPED_COLUMN, STRING_COLUMN, StringColumnSummary, TableFilteringTask, TableOrderingTask, TableSummary, TaskStatus } from '../../compute/table_transforms.js';
import { filterTable, sortTable } from '../../compute/computation_actions.js';
import { useLogger } from '../../platform/logger_provider.js';
import { RectangleWaveSpinner } from '../../view/foundations/spinners.js';
import { HistogramCell, HistogramFilterCallback } from './histogram_cell.js';
import { MostFrequentCell, MostFrequentValueFilterCallback } from './mostfrequent_cell.js';
import { useAppConfig } from '../../app_config.js';
import { AsyncDataFrame } from 'compute/compute_worker_bindings.js';

const LOG_CTX = 'data_table';

interface Props {
    className?: string;
    table: TableComputationState;
    dispatchComputation: Dispatch<ComputationAction>;
}

const MIN_GRID_HEIGHT = 200;
const MIN_GRID_WIDTH = 100;
const MIN_COLUMN_WIDTH = 120;
const COLUMN_HEADER_ACTION_WIDTH = 24;
const COLUMN_HEADER_HEIGHT = 32;
const COLUMN_HEADER_PLOTS_HEIGHT = 76;
const ROW_HEIGHT = 26;
const ROW_HEADER_WIDTH = 48;
const FORMATTER_PIXEL_SCALING = 10;
const OVERSCAN_ROW_COUNT = 30;

function computeColumnCount(columnGroups: GridColumnGroup[], showMetaColumns: boolean): number {
    let columnCount = 0;
    for (const columnGroup of columnGroups) {
        switch (columnGroup.type) {
            case ROWNUMBER_COLUMN:
                ++columnCount;
                break;
            case SKIPPED_COLUMN:
                break;
            case STRING_COLUMN:
            case LIST_COLUMN:
                ++columnCount;
                if (showMetaColumns && columnGroup.value.valueIdFieldName != null) {
                    ++columnCount;
                }
                break;
            case ORDINAL_COLUMN:
                ++columnCount;
                if (showMetaColumns && columnGroup.value.binFieldId != null) {
                    ++columnCount;
                }
                break;
        }
    }
    return columnCount;
}

interface GridLayout {
    columnCount: number;
    columnFields: Uint32Array;
    columnOffsets: Float64Array;
    columnSummaryIds: Int32Array;
    columnGroups: Uint32Array;
    isSystemColumn: Uint8Array;
    headerRowCount: number;
}

const MAX_VALUE_COLUMN_WIDTH = 300;

function computeGridLayout(formatter: ArrowTableFormatter, state: TableComputationState, showSystemColumns: boolean, headerRowCount: number): GridLayout {
    // Allocate column offsets
    let columnCount = computeColumnCount(state.columnGroups, showSystemColumns);
    const columnFields = new Uint32Array(columnCount);
    const columnOffsets = new Float64Array(columnCount + 1);
    const columnSummaryIndex = new Int32Array(columnCount);
    const columnGroups = new Uint32Array(columnCount);
    const isSystemColumn = new Uint8Array(columnCount);
    const tableSchema = state.dataTable.schema;

    // Index table fields by name
    const fieldIndexByName = new Map<string, number>();
    for (let i = 0; i < tableSchema.fields.length; ++i) {
        fieldIndexByName.set(tableSchema.fields[i].name, i);
    }

    for (let i = 0; i < columnCount; ++i) {
        columnSummaryIndex[i] = -1;
    }

    // Allocate column offsets
    let nextDisplayColumn = 0;
    let nextDisplayOffset = 0;
    for (let groupIndex = 0; groupIndex < state.columnGroups.length; ++groupIndex) {
        const columnGroup = state.columnGroups[groupIndex];
        switch (columnGroup.type) {
            case ROWNUMBER_COLUMN: {
                const columnId = nextDisplayColumn++;
                columnFields[columnId] = fieldIndexByName.get(columnGroup.value.rowNumberFieldName)!;
                columnOffsets[columnId] = nextDisplayOffset;
                columnGroups[columnId] = groupIndex;
                nextDisplayOffset += ROW_HEADER_WIDTH;
                break;
            }
            case SKIPPED_COLUMN:
                break;
            case ORDINAL_COLUMN:
                const valueColumnId = nextDisplayColumn++;
                const valueColumnFormatter = formatter.columns[fieldIndexByName.get(columnGroup.value.inputFieldName)!];
                let valueColumnWidth = Math.max(
                    COLUMN_HEADER_ACTION_WIDTH + Math.max(
                        valueColumnFormatter.getLayoutInfo().valueAvgWidth,
                        valueColumnFormatter.getColumnName().length) * FORMATTER_PIXEL_SCALING,
                    MIN_COLUMN_WIDTH
                );
                valueColumnWidth = Math.min(valueColumnWidth, MAX_VALUE_COLUMN_WIDTH);
                columnFields[valueColumnId] = fieldIndexByName.get(columnGroup.value.inputFieldName)!;
                columnOffsets[valueColumnId] = nextDisplayOffset;
                columnSummaryIndex[valueColumnId] = groupIndex;
                columnGroups[valueColumnId] = groupIndex;
                nextDisplayOffset += valueColumnWidth;
                if (showSystemColumns && columnGroup.value.binFieldId != null) {
                    const idColumnId = nextDisplayColumn++;
                    const idColumn = formatter.columns[columnGroup.value.binFieldId];
                    const idColumnWidth = Math.max(
                        COLUMN_HEADER_ACTION_WIDTH + Math.max(
                            idColumn.getLayoutInfo().valueAvgWidth,
                            idColumn.getColumnName().length) * FORMATTER_PIXEL_SCALING,
                        MIN_COLUMN_WIDTH
                    );
                    columnFields[idColumnId] = columnGroup.value.binFieldId;
                    columnOffsets[idColumnId] = nextDisplayOffset;
                    columnGroups[idColumnId] = groupIndex;
                    isSystemColumn[idColumnId] = 1;
                    nextDisplayOffset += idColumnWidth;
                }
                break;
            case STRING_COLUMN:
            case LIST_COLUMN: {
                const valueColumnId = nextDisplayColumn++;
                const valueColumnFormatter = formatter.columns[fieldIndexByName.get(columnGroup.value.inputFieldName)!];
                let valueColumnWidth = Math.max(
                    COLUMN_HEADER_ACTION_WIDTH + Math.max(
                        valueColumnFormatter.getLayoutInfo().valueAvgWidth,
                        valueColumnFormatter.getColumnName().length) * FORMATTER_PIXEL_SCALING,
                    MIN_COLUMN_WIDTH
                );
                valueColumnWidth = Math.min(valueColumnWidth, MAX_VALUE_COLUMN_WIDTH);
                columnFields[valueColumnId] = fieldIndexByName.get(columnGroup.value.inputFieldName)!;
                columnOffsets[valueColumnId] = nextDisplayOffset;
                columnSummaryIndex[valueColumnId] = groupIndex;
                columnGroups[valueColumnId] = groupIndex;
                nextDisplayOffset += valueColumnWidth;
                if (showSystemColumns && columnGroup.value.valueIdFieldName != null) {
                    const idColumnId = nextDisplayColumn++;
                    const idColumn = formatter.columns[fieldIndexByName.get(columnGroup.value.valueIdFieldName)!];
                    const idColumnWidth = Math.max(
                        COLUMN_HEADER_ACTION_WIDTH + Math.max(
                            idColumn.getLayoutInfo().valueAvgWidth,
                            idColumn.getColumnName().length) * FORMATTER_PIXEL_SCALING,
                        MIN_COLUMN_WIDTH
                    );
                    columnFields[idColumnId] = fieldIndexByName.get(columnGroup.value.valueIdFieldName)!;
                    columnOffsets[idColumnId] = nextDisplayOffset;
                    columnGroups[idColumnId] = groupIndex;
                    isSystemColumn[idColumnId] = 1;
                    nextDisplayOffset += idColumnWidth;
                }
                break;
            }
        }
    }
    columnOffsets[nextDisplayColumn] = nextDisplayOffset;

    return {
        columnCount,
        columnFields,
        columnOffsets,
        columnSummaryIds: columnSummaryIndex,
        columnGroups,
        isSystemColumn: isSystemColumn,
        headerRowCount
    };
}

function skipGridLayoutUpdate(old: GridLayout, next: GridLayout) {
    if (old.columnOffsets.length != next.columnOffsets.length) {
        return false;
    }
    for (let i = 0; i < old.columnOffsets.length; ++i) {
        const delta = next.columnOffsets[i] - old.columnOffsets[i];
        if (delta > 0.01) {
            return false;
        }
    }
    return true;
}

enum DataTableColumnHeader {
    OnlyColumnName = 0,
    WithColumnPlots = 1
}
var columnHeader: DataTableColumnHeader = DataTableColumnHeader.WithColumnPlots;

interface FocusedCells {
    row: number | null,
    field: number | null
}

interface GridData {
    columnGroupSummaries: (ColumnSummaryVariant | null)[];
    columnGroupSummariesStatus: (TaskStatus | null)[];
    columnGroups: GridColumnGroup[];
    dataFrame: AsyncDataFrame | null,
    dataFilter: arrow.Vector<arrow.Uint64> | null;
    focusedField: number | null,
    focusedRow: number | null,
    gridLayout: GridLayout,
    table: arrow.Table,
    tableFormatter: ArrowTableFormatter,
    tableSummary: TableSummary | null;
    onMouseEnter: (event: React.PointerEvent<HTMLDivElement>) => void,
    onMouseLeave: (event: React.PointerEvent<HTMLDivElement>) => void,
    onOrderByColumn: (col: number) => void,
    onHistogramFilter: HistogramFilterCallback;
    onMostFrequentValueFilter: MostFrequentValueFilterCallback;
}

function Cell(props: GridChildComponentProps<GridData>) {
    if (props.columnIndex >= props.data.gridLayout.columnFields.length) {
        return <div />;
    }
    const fieldId = props.data.gridLayout.columnFields[props.columnIndex];

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
    } else if (props.rowIndex == 1 && columnHeader == DataTableColumnHeader.WithColumnPlots) {
        // Resolve the column summary
        let columnSummary: ColumnSummaryVariant | null = null;
        let columnSummaryStatus: TaskStatus | null = null;
        const columnSummaryId = props.data.gridLayout.columnSummaryIds[props.columnIndex];
        if (columnSummaryId != -1) {
            columnSummary = props.data.columnGroupSummaries[columnSummaryId];
            columnSummaryStatus = props.data.columnGroupSummariesStatus[columnSummaryId];
        }

        // Special case, corner cell, top-left
        if (props.columnIndex == 0) {
            return <div className={styles.plots_corner_cell} style={props.style} />;
        } else if (columnSummary == null) {
            // Special case, cell without summary
            return <div className={classNames(styles.plots_cell, styles.plots_empty_cell)} style={props.style} />;
        } else {
            // Check summary status
            const tableSummary = props.data.tableSummary;
            if (tableSummary == null) {
                return (
                    <div className={styles.plots_cell} style={props.style}>
                        Table summary is null
                    </div>
                );
            }
            switch (columnSummaryStatus) {
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
                    switch (columnSummary?.type) {
                        case ORDINAL_COLUMN:
                            return (
                                <HistogramCell
                                    className={styles.plots_cell}
                                    style={props.style}
                                    tableSummary={tableSummary}
                                    columnIndex={props.columnIndex}
                                    columnSummary={columnSummary.value}
                                    onFilter={props.data.onHistogramFilter}
                                />
                            );
                        case STRING_COLUMN:
                            return (
                                <MostFrequentCell
                                    className={styles.plots_cell}
                                    style={props.style}
                                    tableSummary={tableSummary}
                                    columnIndex={props.columnIndex}
                                    columnSummary={columnSummary.value}
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

        // XXX Introduce special calls for certain types


        // Format the value
        const formatted = props.data.tableFormatter.getValue(dataRow, fieldId);
        const focusedRow = props.data.focusedRow;
        const focusedField = props.data.focusedField;

        if (props.columnIndex == 0) {
            // Treat the row number column separately
            return (
                <div
                    className={classNames(styles.row_header_cell, {
                        [styles.data_cell_focused_secondary]: dataRow == focusedRow,
                    })}
                    style={props.style}
                >
                    {formatted ?? ""}
                </div>
            );
        } else {
            // Is the value NULL?
            // We want to format the cell differently
            if (formatted == null) {
                return (
                    <div
                        className={classNames(styles.data_cell, styles.data_cell_null, {
                            [styles.data_cell_focused_primary]: dataRow == focusedRow && fieldId == focusedField,
                            [styles.data_cell_focused_secondary]: dataRow == focusedRow && fieldId != focusedField,
                            [styles.data_cell_metadata]: props.data.gridLayout.isSystemColumn[props.columnIndex] == 1,
                        })}
                        style={props.style}
                        data-table-col={fieldId}
                        data-table-row={dataRow}
                        onMouseEnter={props.data.onMouseEnter}
                        onMouseLeave={props.data.onMouseLeave}
                    >
                        NULL
                    </div>
                );
            } else {
                // Otherwise draw a normal cell
                return (
                    <div
                        className={classNames(styles.data_cell, {
                            [styles.data_cell_focused_primary]: dataRow == focusedRow && fieldId == focusedField,
                            [styles.data_cell_focused_secondary]: dataRow == focusedRow && fieldId != focusedField,
                            [styles.data_cell_metadata]: props.data.gridLayout.isSystemColumn[props.columnIndex] == 1,
                        })}
                        style={props.style}
                        data-table-col={fieldId}
                        data-table-row={dataRow}
                        onMouseEnter={props.data.onMouseEnter}
                        onMouseLeave={props.data.onMouseLeave}
                    >
                        {formatted}
                    </div>
                );
            }
        }
    }
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
        case DataTableColumnHeader.OnlyColumnName:
            headerRowCount = 1;
            getRowHeight = (row: number) => (row == 0) ? COLUMN_HEADER_HEIGHT : ROW_HEIGHT;
            getRowOffset = (row: number) => (row > 0 ? COLUMN_HEADER_HEIGHT : 0) + (Math.max(row, 1) - 1) * ROW_HEIGHT;
            break;
        case DataTableColumnHeader.WithColumnPlots:
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
    const [gridLayout, setGridLayout] = React.useState<GridLayout>({
        columnCount: 0,
        columnFields: new Uint32Array(),
        columnOffsets: new Float64Array([0]),
        columnSummaryIds: new Int32Array(),
        columnGroups: new Uint32Array(),
        isSystemColumn: new Uint8Array(),
        headerRowCount
    });
    React.useEffect(() => {
        if (tableFormatter) {
            const newGridLayout = computeGridLayout(tableFormatter, computationState, interfaceDebugMode, headerRowCount);
            if (!skipGridLayoutUpdate(gridLayout, newGridLayout)) {
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
        getColumnWidth: (column: number) => gridLayout.columnOffsets[column + 1] - gridLayout.columnOffsets[column],
        getColumnOffset: (column: number) => gridLayout.columnOffsets[column],
    }), [gridLayout]);

    // Rerender grids when the grid layout changes
    React.useEffect(() => {
        if (dataGrid.current) {
            dataGrid.current.resetAfterColumnIndex(0);
        }
    }, [gridCellLocation]);

    // Maintain active cross-filters
    const [crossFilters, setCrossFilters] = React.useState<{ [key: number]: pb.dashql.compute.FilterTransform[] }>([]);
    const columnGroups = computationState.columnGroups;
    const histogramFilter: HistogramFilterCallback = React.useCallback((table: TableSummary, columnIndex: number, column: OrdinalColumnSummary, brush: [number, number] | null) => {
        const columnGroupId = gridLayout.columnGroups[columnIndex];
        const columnGroup = columnGroups[columnGroupId];

        // Compute filters
        let filters: pb.dashql.compute.FilterTransform[] = [];
        switch (columnGroup.type) {
            case ORDINAL_COLUMN: {
                if (columnGroup.value.binFieldName != null && brush != null) {
                    filters.push(buf.create(pb.dashql.compute.FilterTransformSchema, {
                        fieldName: columnGroup.value.binFieldName,
                        operator: pb.dashql.compute.FilterOperator.GreaterEqual,
                        valueDouble: brush[0]
                    }));
                    filters.push(buf.create(pb.dashql.compute.FilterTransformSchema, {
                        fieldName: columnGroup.value.binFieldName,
                        operator: pb.dashql.compute.FilterOperator.LessEqual,
                        valueDouble: brush[1]
                    }));
                }
                break;
            }
        }

        // Update cross filters
        setCrossFilters(x => ({
            ...x,
            [columnGroupId]: filters,
        }));

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
    }, [gridLayout, columnGroups]);

    // Effect to filter a table whenever the cross filters change
    React.useEffect(() => {
        if (!computationState.dataFrame || !computationState.rowNumberColumnName) {
            return;
        }
        let filters: pb.dashql.compute.FilterTransform[] = [];
        for (const f of Object.values(crossFilters)) {
            filters = filters.concat(f);
        }
        const filteringTask: TableFilteringTask = {
            computationId: computationState.computationId,
            inputDataTable: computationState.dataTable,
            inputDataTableFieldIndex: computationState.dataTableFieldsByName,
            inputDataFrame: computationState.dataFrame,
            filters,
            rowNumberColumnName: computationState.rowNumberColumnName,
        };
        filterTable(filteringTask, dispatchComputation, logger);
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
                computationId: computationState.computationId,
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
    const gridData = React.useMemo<GridData>(() => ({
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
        focusedCells,
        histogramFilter,
        mostFrequentValueFilter,
    ]);

    // Inner grid element type to render sticky row and column headers
    const InnerGridElementType = useStickyRowAndColumnHeaders(Cell, gridCellLocation, styles.data_grid_cells, headerRowCount, gridData);

    // Listen to rendering events to check if the column widths changed.
    // Table elements are formatted lazily so we do not know upfront how wide a column will be.
    const onItemsRendered = React.useCallback((_event: GridOnItemsRenderedProps) => {
        if (dataGrid.current && tableFormatter) {
            const newGridColumns = computeGridLayout(tableFormatter, computationState, interfaceDebugMode, headerRowCount);
            if (!skipGridLayoutUpdate(gridLayout, newGridColumns)) {
                setGridLayout(newGridColumns);
            }
        }
    }, [gridLayout, tableFormatter, interfaceDebugMode]);

    React.useEffect(() => {
        // console.log(computationState.filterTable?.dataTable.toString());
    }, [computationState.filterTable]);


    // We want to use stable cell keys across filtering
    const computeCellKey = React.useCallback<GridItemKeySelector<GridData>>((props: { columnIndex: number; rowIndex: number; data: GridData; }) => {
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
                {Cell}
            </Grid>
        </div>
    );
};

