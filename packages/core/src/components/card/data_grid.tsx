import * as React from 'react';
import * as model from '../../model';
import * as access from '../../access';
import {
    Grid,
    GridCellProps,
    GridCellRangeProps,
    defaultCellRangeRenderer,
    SizeAndPositionData,
    Index as ColumnIndex,
} from 'react-virtualized';
import { VirtualScrollbars, PositionValues } from '../virtual_scrollbars';
import { ColumnRenderer, deriveColumnRenderers } from './data_grid_column';

import styles from './data_grid.module.css';
import { withAutoSizer } from '../../utils/autosizer';

const PIXEL_PER_CHAR = 8;
const ROW_HEADER_PADDING = 20;
const VALUE_PADDING = 20;
const MAX_COLUMN_HEADER_STRETCH = 1;
const MAX_VALUE_STRETCH = 2;

type Props = {
    width: number;
    height: number;

    table: model.TableMetadata;
    data: access.ScanResult | null;
    requestData: (request: access.ScanRequest) => void;
};

type State = {
    data: access.ScanResult | null;
    totalRowCount: number;
    columnRenderers: ColumnRenderer[];

    width: number;
    height: number;
    columnHeaderHeight: number;
    columnWidths: number[];
    columnWidthSum: number;
    columnNames: string[];
    rowHeaderWidth: number;
    rowHeight: number;

    scrollTop: number;
    scrollLeft: number;
    firstVisibleRow: number;
    visibleRows: number;
    overscanColumnCount: number;
    overscanRowCount: number;
};

/// Render a data cell nodata for data that is not yet avaialable
function renderDataCellNoData(props: GridCellProps): JSX.Element {
    return <div key={props.key} className={styles.cell_nodata} style={{ ...props.style }} />;
}

export class DataGrid extends React.Component<Props, State> {
    protected _onScroll = this.onScroll.bind(this);
    protected _onScrollStop = this.onScrollStop.bind(this);
    protected _renderDataCellRange = this.renderDataCellRange.bind(this);
    protected _renderRowHeaderCell = this.renderRowHeaderCell.bind(this);
    protected _renderColumnHeaderCell = this.renderColumnHeaderCell.bind(this);
    protected _getColumnWidth = this.getColumnWidth.bind(this);

    constructor(props: Props) {
        super(props);
        this.state = DataGrid.getDerivedStateFromProps(props, {
            data: null,
            totalRowCount: 0,
            columnRenderers: [],

            width: 0,
            height: 0,
            columnHeaderHeight: 28,
            columnWidths: [],
            columnWidthSum: 0,
            columnNames: [],
            rowHeight: 28,
            rowHeaderWidth: 0,

            scrollTop: 0,
            scrollLeft: 0,
            firstVisibleRow: 0,
            visibleRows: 100,
            overscanColumnCount: 0,
            overscanRowCount: 10,
        });
    }

    // Derive the grid state
    static getDerivedStateFromProps(props: Props, prevState: State): State {
        // Data and dimensions are the same?
        if (props.data === prevState.data && props.width == prevState.width && props.height == prevState.height) {
            return prevState;
        }

        // Not data available?
        if (!props.data) {
            return {
                ...prevState,

                data: null,
                totalRowCount: 0,
                columnRenderers: [],

                width: props.width,
                height: props.height,
                columnWidths: [],
                columnWidthSum: 0,
                columnNames: [],
                rowHeaderWidth: 0,
            };
        }

        // Derive the column renderers if the data changed
        let columnRenderers = prevState.columnRenderers;
        let totalRowCount = prevState.totalRowCount;
        if (props.data !== prevState.data) {
            columnRenderers = deriveColumnRenderers(props.table, props.data!);

            // Get the row count
            const key = model.buildTableStatisticsKey(model.TableStatisticsType.COUNT_STAR);
            const entry = props.table.statistics.get(key);
            totalRowCount = entry?.get(0) || 0;
        }

        // Get the row header width
        const rowHeaderWidth =
            totalRowCount == 0
                ? 0
                : Math.ceil(Math.log(totalRowCount) / Math.log(10)) * PIXEL_PER_CHAR + ROW_HEADER_PADDING;

        // Compute the column widths
        const columnWidths = [];
        const columnNames = [];
        let columnWidthSum = 0;
        for (const renderer of columnRenderers) {
            const info = renderer.getLayoutInfo();
            let required =
                Math.min(info.valueMaxWidth, info.valueAvgWidth * MAX_VALUE_STRETCH) * PIXEL_PER_CHAR + VALUE_PADDING;
            required += info.auxiliaries;
            const header = info.headerWidth * PIXEL_PER_CHAR + VALUE_PADDING;
            if (header > required) {
                required = Math.min(header, required * MAX_COLUMN_HEADER_STRETCH);
            }
            required = Math.ceil(required);
            columnWidths.push(required);
            columnWidthSum += required;
            columnNames.push(renderer.getColumnName());
        }

        // If we the table does not fill the entire space, we resize every cell by a single growth factor
        if (rowHeaderWidth + columnWidthSum < props.width) {
            const enlarge = (props.width - rowHeaderWidth) / columnWidthSum;
            columnWidthSum = 0;
            for (let i = 0; i < columnWidths.length; ++i) {
                columnWidths[i] = Math.ceil(columnWidths[i] * enlarge);
                columnWidthSum += columnWidths[i];
            }
        }

        const state = {
            ...prevState,

            data: props.data,
            totalRowCount,
            columnRenderers,

            width: props.width,
            height: props.width,
            columnWidths,
            columnWidthSum,
            columnNames,
            rowHeaderWidth,
        };
        return state;
    }

    /// Get the width of a column
    public getColumnWidth(idx: ColumnIndex): number {
        return idx.index < this.state.columnWidths.length ? this.state.columnWidths[idx.index] : 0;
    }

    /// Get the column count
    public get columnCount(): number {
        return this.props.table.columnNames.length;
    }

    /// Scroll handler
    public onScroll(pos: PositionValues): void {
        const firstVisibleRow = Math.min(
            Math.trunc((pos.scrollTop * pos.verticalScaling) / this.state.rowHeight),
            this.state.totalRowCount,
        );
        const maxVisibleRows = this.state.totalRowCount - firstVisibleRow;
        const visibleRows = Math.min(Math.trunc(pos.clientHeight / this.state.rowHeight), maxVisibleRows);
        this.setState({
            scrollTop: pos.scrollTop,
            scrollLeft: pos.scrollLeft,
            firstVisibleRow: firstVisibleRow,
            visibleRows: visibleRows,
        });
    }

    /// Scroll stop handler
    public onScrollStop(): void {
        const ofs = this.state.firstVisibleRow;
        const count = this.state.visibleRows;
        const end = Math.min(ofs + count, this.state.totalRowCount);
        this.props.requestData(new access.ScanRequest().withRange(ofs, end - ofs, 1024));
    }

    /// Render a cell of the static left sidebar
    protected renderRowHeaderCell(props: GridCellProps): JSX.Element {
        return (
            <div key={props.key} className={styles.cell_header_row} style={{ ...props.style }}>
                {props.rowIndex}
            </div>
        );
    }

    /// Render a cell of the header
    protected renderColumnHeaderCell(props: GridCellProps): JSX.Element {
        return (
            <div key={props.key} className={styles.cell_header_col} style={{ ...props.style }}>
                <span className={styles.header_col_label}>{this.state.columnNames[props.columnIndex]}</span>
            </div>
        );
    }

    /// Render a data cell range
    public renderDataCellRange(props: GridCellRangeProps): React.ReactNode[] {
        // XXX StopIndex is apparently included !!!
        const propRows = props.rowStopIndex - props.rowStartIndex + 1;

        // No data provided?
        // Render as missing.
        if (!this.props.data) {
            return defaultCellRangeRenderer(props);
        }

        // Range is fully included?
        const req = this.props.data.request;
        if (req.includesRange(props.rowStartIndex, propRows)) {
            return this.renderAvailableDataCellRange(props);
        }

        // Does not intersect with the range?
        if (!req.intersectsRange(props.rowStartIndex, propRows)) {
            return defaultCellRangeRenderer(props);
        }

        const dataBegin = Math.min(req.begin, this.state.totalRowCount);
        const dataEnd = Math.min(req.end, this.state.totalRowCount);
        const rowsBegin = props.rowStartIndex;
        const rowsEnd = props.rowStopIndex + 1;

        // Render missing cells at the beginning
        let before: React.ReactNode[] = [];
        if (props.rowStartIndex < dataBegin) {
            props.rowStartIndex = rowsBegin;
            props.rowStopIndex = dataBegin - 1;
            before = defaultCellRangeRenderer(props);
        }

        // Render missing cells at the end
        let after: React.ReactNode[] = [];
        if (props.rowStopIndex >= dataEnd) {
            props.rowStartIndex = dataEnd;
            after = defaultCellRangeRenderer(props);
        }

        // Render available cells
        let available: React.ReactNode[] = [];
        if (dataBegin < dataEnd) {
            props.rowStartIndex = dataBegin;
            props.rowStopIndex = dataEnd - 1;
            available = this.renderAvailableDataCellRange(props);
        }

        // Concatenate the cells
        props.rowStartIndex = rowsBegin;
        props.rowStopIndex = rowsEnd - 1;
        return before.concat(available).concat(after);
    }

    /// Render an available data cell.
    /// Adopted from the defaultCellRangeRenderer of react-virtualized.
    public renderAvailableDataCell(
        props: GridCellRangeProps,
        globalRowIndex: number,
        globalRowDatum: SizeAndPositionData,
        localRowIndex: number,
        columnIndex: number,
        columnDatum: SizeAndPositionData,
        canCacheStyle: boolean,
    ): React.ReactNode {
        const key = `${globalRowIndex}-${columnIndex}`;
        let style: React.CSSProperties;

        // Cache style objects so shallow-compare doesn't re-render unnecessarily.
        if (canCacheStyle && props.styleCache[key]) {
            style = props.styleCache[key];
        } else {
            // In deferred mode, cells will be initially rendered before we know their size.
            // Don't interfere with CellMeasurer's measurements by setting an invalid size.
            if (props.deferredMeasurementCache && !props.deferredMeasurementCache.has(globalRowIndex, columnIndex)) {
                // Position not-yet-measured cells at top/left 0,0,
                // And give them width/height of 'auto' so they can grow larger than the parent Grid if necessary.
                // Positioning them further to the right/bottom influences their measured size.
                style = {
                    height: 'auto',
                    left: 0,
                    position: 'absolute',
                    top: 0,
                    width: 'auto',
                };
            } else {
                style = {
                    height: globalRowDatum.size,
                    left: columnDatum.offset + props.horizontalOffsetAdjustment,
                    position: 'absolute',
                    top: globalRowDatum.offset + props.verticalOffsetAdjustment,
                    width: columnDatum.size,
                };

                props.styleCache[key] = style;
            }
        }

        // Avoid re-creating cells while scrolling.
        let cell: React.ReactNode;
        if (
            (props.isScrollingOptOut || props.isScrolling) &&
            !props.horizontalOffsetAdjustment &&
            !props.verticalOffsetAdjustment
        ) {
            if (!props.cellCache[key]) {
                props.cellCache[key] = this.state.columnRenderers[columnIndex].renderCell(localRowIndex, key, style);
            }
            cell = props.cellCache[key];
        } else {
            cell = this.state.columnRenderers[columnIndex].renderCell(localRowIndex, key, style);
        }
        return cell;
    }

    /// Render a data cell range that is backed by query results
    public renderAvailableDataCellRange(props: GridCellRangeProps): React.ReactNode[] {
        const cells: React.ReactNode[] = [];

        // Can use style cache?
        const areOffsetsAdjusted =
            props.columnSizeAndPositionManager.areOffsetsAdjusted() ||
            props.rowSizeAndPositionManager.areOffsetsAdjusted();
        const canCacheStyle = !props.isScrolling && !areOffsetsAdjusted;

        // We render the cells column-wise to iterate over the query results more efficiently.
        // react-virtualized does this row-wise in their default render which kills our chunk iterator.
        for (let columnIndex = props.columnStartIndex; columnIndex <= props.columnStopIndex; columnIndex++) {
            const columnDatum = props.columnSizeAndPositionManager.getSizeAndPositionOfCell(columnIndex);

            // Render all rows
            const offset = props.rowStartIndex - this.props.data!.request.begin;
            const limit = props.rowStopIndex - props.rowStartIndex + 1;
            let globalRowIndex = props.rowStartIndex;
            for (let localRowIndex = offset; localRowIndex < offset + limit; ++localRowIndex) {
                const globalRowDatum = props.rowSizeAndPositionManager.getSizeAndPositionOfCell(globalRowIndex);
                const cell = this.renderAvailableDataCell(
                    props,
                    globalRowIndex,
                    globalRowDatum,
                    localRowIndex,
                    columnIndex,
                    columnDatum,
                    canCacheStyle,
                );
                if (cell) {
                    cells.push(cell);
                }
                ++globalRowIndex;
            }
        }
        return cells;
    }

    /// Render the table
    public render(): React.ReactElement {
        const bodyHeight = this.props.height - this.state.columnHeaderHeight;
        const bodyWidth = this.props.width - this.state.rowHeaderWidth;
        return (
            <div
                className={styles.grid_container}
                style={{
                    display: 'grid',
                    gridTemplateRows: `${this.state.columnHeaderHeight}px ${bodyHeight}px`,
                    gridTemplateColumns: `${this.state.rowHeaderWidth}px ${bodyWidth}px`,
                }}
            >
                <Grid
                    className={styles.grid_body}
                    width={bodyWidth - 2}
                    height={bodyHeight - 2}
                    columnWidth={this._getColumnWidth}
                    columnCount={this.columnCount}
                    rowHeight={this.state.rowHeight}
                    rowCount={this.state.totalRowCount}
                    scrollTop={this.state.scrollTop}
                    scrollLeft={this.state.scrollLeft}
                    overscanColumnCount={this.state.overscanColumnCount}
                    overscanRowCount={this.state.overscanRowCount}
                    cellRenderer={renderDataCellNoData}
                    cellRangeRenderer={this._renderDataCellRange}
                    dataRef={this.props.data}
                />
                <VirtualScrollbars
                    className={styles.grid_body_scrollbars}
                    style={{
                        width: bodyWidth,
                        height: bodyHeight,
                    }}
                    innerWidth={this.state.columnWidthSum}
                    innerHeight={this.state.totalRowCount * this.state.rowHeight}
                    onScrollFrame={this._onScroll}
                    onScrollStop={this._onScrollStop}
                />
                <div className={styles.cell_anchor} />
                <Grid
                    className={styles.grid_left}
                    width={this.state.rowHeaderWidth}
                    height={bodyHeight}
                    columnWidth={this.state.rowHeaderWidth}
                    columnCount={1}
                    rowHeight={this.state.rowHeight}
                    rowCount={this.state.totalRowCount}
                    scrollTop={this.state.scrollTop}
                    overscanColumnCount={this.state.overscanColumnCount}
                    overscanRowCount={this.state.overscanRowCount}
                    cellRenderer={this._renderRowHeaderCell}
                />
                <Grid
                    className={styles.grid_header}
                    width={bodyWidth}
                    height={this.state.columnHeaderHeight}
                    columnWidth={this._getColumnWidth}
                    columnCount={this.columnCount}
                    rowHeight={this.state.columnHeaderHeight}
                    rowCount={1}
                    scrollLeft={this.state.scrollLeft}
                    cellRenderer={this._renderColumnHeaderCell}
                />
            </div>
        );
    }
}

export default withAutoSizer(DataGrid);
