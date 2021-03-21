import * as React from 'react';
import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as core from '@dashql/core';
import {
    Grid,
    GridCellProps,
    GridCellRangeProps,
    AutoSizer,
    defaultCellRangeRenderer,
    SizeAndPositionData,
} from 'react-virtualized';
import { VizCard } from './viz_card';
import { VirtualScrollbars, PositionValues } from '../virtual_scrollbars';

import styles from './data_grid.module.css';

type Props = {
    tableInfo: core.model.DatabaseTableInfo;
    data: core.access.ScanResult | null;
    requestData: (request: core.access.ScanRequest) => void;
};

type State = {
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

    constructor(props: Props) {
        super(props);
        this.state = {
            scrollTop: 0,
            scrollLeft: 0,
            firstVisibleRow: 0,
            visibleRows: 100,
            overscanColumnCount: 0,
            overscanRowCount: 10,
            rowHeight: 24,
        };
    }

    /// Get the column count
    public get columnCount() {
        return this.props.tableInfo.columnNames.length;
    }

    /// Get the row count
    public get rowCount(): number {
        const key = core.model.buildTableStatisticsKey(core.model.TableStatisticsType.COUNT_STAR);
        return this.props.tableInfo.statistics.get(key)![0].castAsInteger() || 0;
    }

    /// Scroll handler
    public onScroll(pos: PositionValues) {
        const firstVisibleRow = Math.min(
            Math.trunc((pos.scrollTop * pos.verticalScaling) / this.state.rowHeight),
            this.rowCount!,
        );
        const maxVisibleRows = this.rowCount! - firstVisibleRow;
        const visibleRows = Math.min(Math.trunc(pos.clientHeight / this.state.rowHeight), maxVisibleRows);
        this.setState({
            ...this.state,
            scrollTop: pos.scrollTop,
            scrollLeft: pos.scrollLeft,
            firstVisibleRow: firstVisibleRow,
            visibleRows: visibleRows,
        });
    }

    /// Scroll stop handler
    public onScrollStop() {
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
                {'foo'}
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
            props.rowStopIndex = props.rowStopIndex;
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
    public renderAvailableDataCell<T>(
        props: GridCellRangeProps,
        rowIndex: number,
        rowDatum: SizeAndPositionData,
        columnIndex: number,
        columnDatum: SizeAndPositionData,
        canCacheStyle: boolean,
        value: T,
        renderCell: (key: string, style: React.CSSProperties, v: T) => React.ReactNode,
    ) {
        let key = `${rowIndex}-${columnIndex}`;
        let style: React.CSSProperties;

        // Cache style objects so shallow-compare doesn't re-render unnecessarily.
        if (canCacheStyle && props.styleCache[key]) {
            style = props.styleCache[key];
        } else {
            // In deferred mode, cells will be initially rendered before we know their size.
            // Don't interfere with CellMeasurer's measurements by setting an invalid size.
            if (props.deferredMeasurementCache && !props.deferredMeasurementCache.has(rowIndex, columnIndex)) {
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
                    height: rowDatum.size,
                    left: columnDatum.offset + props.horizontalOffsetAdjustment,
                    position: 'absolute',
                    top: rowDatum.offset + props.verticalOffsetAdjustment,
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
                props.cellCache[key] = renderCell(key, style, value);
            }
            cell = props.cellCache[key];
        } else {
            cell = renderCell(key, style, value);
        }
        return cell;
    }

    /// Render a data cell range that is backed by query results
    public renderAvailableDataCellRange(props: GridCellRangeProps): React.ReactNode[] {
        const data = this.props.data!.result;
        let cells: React.ReactNode[] = [];

        // Can use style cache?
        const areOffsetsAdjusted =
            props.columnSizeAndPositionManager.areOffsetsAdjusted() ||
            props.rowSizeAndPositionManager.areOffsetsAdjusted();
        const canCacheStyle = !props.isScrolling && !areOffsetsAdjusted;

        // We render the cells column-wise to iterate over the query results more efficiently.
        // react-virtualized does this row-wise in their default render which kills our chunk iterator.
        for (let columnIndex = props.columnStartIndex; columnIndex <= props.columnStopIndex; columnIndex++) {
            const columnDatum = props.columnSizeAndPositionManager.getSizeAndPositionOfCell(columnIndex);

            const iter = new webdb.ChunkArrayIterator(data);
            const offset = props.rowStartIndex - this.props.data!.request.begin;
            const limit = props.rowStopIndex - props.rowStartIndex + 1;

            iter.iterateAllBlocking(
                offset,
                limit,
                (iter: webdb.ChunkIterator, chunkStart: number, skipHere: number, rowsHere: number) => {
                    let chunkRow = 0;
                    for (const v of iter.iterateNumberColumn(columnIndex, skipHere, rowsHere)) {
                        const rowIndex = props.rowStartIndex + chunkStart + chunkRow - skipHere;
                        const rowDatum = props.rowSizeAndPositionManager.getSizeAndPositionOfCell(rowIndex);
                        const cell = this.renderAvailableDataCell(
                            props,
                            rowIndex,
                            rowDatum,
                            columnIndex,
                            columnDatum,
                            canCacheStyle,
                            v,
                            (key, style, value) => (
                                <div key={key} className={styles.cell_data} style={{ ...style }}>
                                    {value}
                                </div>
                            ),
                        );
                        if (cell) {
                            cells.push(cell);
                        }
                        chunkRow++;
                    }
                },
            );
        }
        return cells;
    }

    /// Compute the column width
    protected computeColumnWidth(clientWidth: number, rowHeaderWidth: number) {
        let available = clientWidth - rowHeaderWidth;
        let equalWidths = available;
        if (this.columnCount > 0) equalWidths = available / this.columnCount;
        let minWidth = 80;
        return Math.max(equalWidths, minWidth);
    }

    /// Render the table
    public render() {
        return (
            <AutoSizer>
                {({ width, height }) => {
                    const columnHeaderHeight = 24;
                    const rowHeaderWidth = 28;
                    const columnWidth = this.computeColumnWidth(width, rowHeaderWidth);
                    const bodyHeight = height - columnHeaderHeight;
                    const bodyWidth = width - rowHeaderWidth;
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
                                columnWidth={columnWidth}
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
                                innerWidth={this.columnCount * columnWidth}
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
                                columnWidth={columnWidth}
                                columnCount={this.columnCount}
                                rowHeight={columnHeaderHeight}
                                rowCount={1}
                                scrollLeft={this.state.scrollLeft}
                                cellRenderer={this._renderColumnHeaderCell}
                            />
                        </div>
                    );
                }}
            </AutoSizer>
        );
    }
}

export default DataGrid;
