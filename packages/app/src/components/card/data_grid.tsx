import * as React from 'react';
import * as core from '@dashql/core';
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
import { withAutoSizer } from '../../util/autosizer';

const PIXEL_PER_CHAR = 6.5;
const ROW_HEADER_PADDING = 32;
const DATA_CELL_PADDING = 32;

type Props = {
    width: number;
    height: number;

    table: core.model.TableSummary;
    data: core.access.ScanResult | null;
    requestData: (request: core.access.ScanRequest) => void;
};

type State = {
    data: core.access.ScanResult | null;
    columnRenderers: ColumnRenderer[];
    columnWidths: number[];
    columnWidthSum: number;

    scrollTop: number;
    scrollLeft: number;
    firstVisibleRow: number;
    visibleRows: number;
    overscanColumnCount: number;
    overscanRowCount: number;
    rowHeight: number;
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
            columnRenderers: [],
            columnWidths: [],
            columnWidthSum: 0,

            scrollTop: 0,
            scrollLeft: 0,
            firstVisibleRow: 0,
            visibleRows: 100,
            overscanColumnCount: 0,
            overscanRowCount: 10,
            rowHeight: 24,
        });
    }

    // Derive the grid state
    static getDerivedStateFromProps(props: Props, prevState: State): State {
        if (props.data === prevState.data) {
            return prevState;
        }
        if (!props.data) {
            return {
                ...prevState,
                data: null,
                columnRenderers: [],
                columnWidths: [],
                columnWidthSum: 0,
            };
        }
        const columnRenderers = deriveColumnRenderers(props.data!);
        const columnWidths = [];
        let columnWidthSum = 0;
        for (const renderer of columnRenderers) {
            const w = renderer.getLayoutInfo().valueMaxWidth * PIXEL_PER_CHAR + DATA_CELL_PADDING;
            columnWidths.push(w);
            columnWidthSum += w;
        }
        console.log(columnWidths);
        return {
            ...prevState,
            data: props.data,
            columnRenderers,
            columnWidths,
            columnWidthSum,
        };
    }

    /// Get the width of a column
    public getColumnWidth(idx: ColumnIndex): number {
        return idx.index < this.state.columnWidths.length ? this.state.columnWidths[idx.index] : 0;
    }

    /// Get the column count
    public get columnCount(): number {
        return this.props.table.columnNames.length;
    }

    /// Get the row count
    public get rowCount(): number {
        const key = core.model.buildTableStatisticsKey(core.model.TableStatisticsType.COUNT_STAR);
        const entry = this.props.table.statistics.get(key);
        if (!entry) {
            throw new Error(`table statistic COUNT_STAR was not evaluated for: ${this.props.table.nameQualified}`);
        }
        return entry!.get(0) || 0;
    }

    /// Scroll handler
    public onScroll(pos: PositionValues): void {
        const firstVisibleRow = Math.min(
            Math.trunc((pos.scrollTop * pos.verticalScaling) / this.state.rowHeight),
            this.rowCount!,
        );
        const maxVisibleRows = this.rowCount! - firstVisibleRow;
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
        const end = Math.min(ofs + count, this.rowCount!);
        this.props.requestData(new core.access.ScanRequest().withRange(ofs, end - ofs, 1024));
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
                {this.props.table.columnNames[props.columnIndex] || '?'}
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

        const dataBegin = Math.min(req.begin, this.rowCount!);
        const dataEnd = Math.min(req.end, this.rowCount!);
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

    /// Compute the column width
    protected computeColumnWidth(clientWidth: number, rowHeaderWidth: number): number {
        const available = clientWidth - rowHeaderWidth;
        let equalWidths = available;
        if (this.columnCount > 0) equalWidths = available / this.columnCount;
        const minWidth = 80;
        return Math.max(equalWidths, minWidth);
    }

    /// Render the table
    public render(): React.ReactElement {
        const columnHeaderHeight = 24;
        const rowHeaderWidth = ROW_HEADER_PADDING + Math.ceil(Math.log(this.rowCount) / Math.log(10)) * PIXEL_PER_CHAR;
        const bodyHeight = this.props.height - columnHeaderHeight;
        const bodyWidth = this.props.width - rowHeaderWidth;
        return (
            <div
                className={styles.grid_container}
                style={{
                    display: 'grid',
                    gridTemplateRows: `${columnHeaderHeight}px ${bodyHeight}px`,
                    gridTemplateColumns: `${rowHeaderWidth}px ${bodyWidth}px`,
                }}
            >
                <Grid
                    className={styles.grid_body}
                    width={bodyWidth - 2}
                    height={bodyHeight - 2}
                    columnWidth={this._getColumnWidth}
                    columnCount={this.columnCount}
                    rowHeight={this.state.rowHeight}
                    rowCount={this.rowCount}
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
                    innerHeight={this.rowCount * this.state.rowHeight}
                    onScrollFrame={this._onScroll}
                    onScrollStop={this._onScrollStop}
                />
                <div className={styles.cell_anchor} />
                <Grid
                    className={styles.grid_left}
                    width={rowHeaderWidth}
                    height={bodyHeight}
                    columnWidth={rowHeaderWidth}
                    columnCount={1}
                    rowHeight={this.state.rowHeight}
                    rowCount={this.rowCount}
                    scrollTop={this.state.scrollTop}
                    overscanColumnCount={this.state.overscanColumnCount}
                    overscanRowCount={this.state.overscanRowCount}
                    cellRenderer={this._renderRowHeaderCell}
                />
                <Grid
                    className={styles.grid_header}
                    width={bodyWidth}
                    height={columnHeaderHeight}
                    columnWidth={this._getColumnWidth}
                    columnCount={this.columnCount}
                    rowHeight={columnHeaderHeight}
                    rowCount={1}
                    scrollLeft={this.state.scrollLeft}
                    cellRenderer={this._renderColumnHeaderCell}
                />
            </div>
        );
    }
}

export default withAutoSizer(DataGrid);
