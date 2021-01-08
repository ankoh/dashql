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
import { Scrollbars, positionValues } from 'react-custom-scrollbars';

import styles from './data_grid.module.css';

type Props = {
    tableInfo: core.model.DatabaseTableInfo;
    data: core.access.ScanResult | null;
    dataProvider: (request: core.access.ScanRequest) => void;
};

type State = {
    scrollTop: number;
    scrollLeft: number;
    overscanColumnCount: number;
    overscanRowCount: number;
    rowHeight: number;
};

/// Render an anchor cell
function renderAnchorCell(props: GridCellProps): JSX.Element {
    return <div key={props.key} className={styles.cell_anchor} style={{ ...props.style }} />;
}

/// Render a data cell placeholder for data that is not yet avaialable
function renderDataCellPlaceholder(props: GridCellProps): JSX.Element {
    return (
        <div key={props.key} className={styles.cell_data} style={{ ...props.style }}>
            {42}
        </div>
    );
}

export class DataGrid extends React.Component<Props, State> {
    protected _onScroll = this.onScroll.bind(this);
    protected _renderDataCellRange = this.renderDataCellRange.bind(this);
    protected _renderRowHeaderCell = this.renderRowHeaderCell.bind(this);
    protected _renderColumnHeaderCell = this.renderColumnHeaderCell.bind(this);

    constructor(props: Props) {
        super(props);
        this.state = {
            scrollTop: 0,
            scrollLeft: 0,
            overscanColumnCount: 0,
            overscanRowCount: 10,
            rowHeight: 32,
        };
    }

    /// Get the column count
    public get columnCount() {
        return this.props.tableInfo.columnNames.length || 0;
    }

    /// Scroll handler
    public onScroll(pos: positionValues) {
        this.setState({
            ...this.state,
            scrollTop: pos.scrollTop,
            scrollLeft: pos.scrollLeft,
        });
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
        const rowCount = props.rowStopIndex - props.rowStartIndex + 1;

        // No data provided?
        // Render as missing.
        if (!this.props.data) {
            return defaultCellRangeRenderer(props);
        }

        // Range is fully included?
        const req = this.props.data.request;
        if (req.includes(props.rowStartIndex, rowCount)) {
            return this.renderAvailableDataCellRange(props);
        }

        // Request additional data from provider
        this.props.dataProvider(
            new core.access.ScanRequest(props.rowStartIndex, rowCount),
        );

        // Does not intersect with query results?
        // Render as missing.
        if (!req.intersects(props.rowStartIndex, rowCount)) {
            return defaultCellRangeRenderer(props);
        }

        const dataBegin = req.offset;
        const dataEnd = req.offset + req.limit;
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
        props.rowStartIndex = dataBegin;
        props.rowStopIndex = dataEnd + 1;
        const available = this.renderAvailableDataCellRange(props);

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

            // Create the chunk iterator
            const iter = new webdb.MaterializedQueryResultChunks(data);

            // We need to do some bookeeping for the chunk iterator.
            // XXX move this into webdb on top of the async row iterator.
            let skip = props.rowStartIndex - this.props.data!.request.offset;
            let remaining = props.rowStopIndex - props.rowStartIndex + 1;
            let chunkStart = props.rowStartIndex;

            while (remaining && iter.next()) {
                const skipHere = Math.min(skip, iter.currentChunk.rowCount());
                skip -= skipHere;

                // Iterate over the number column.
                // XXX We have more than numbers
                iter.iterateNumberColumn(columnIndex, (chunkRow: number, v: number | null) => {
                    const rowIndex = chunkStart + chunkRow - skipHere;
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
                }, skipHere, remaining);

                // Advance the chunk start
                chunkStart += iter.currentChunk.rowCount() - skipHere;
                remaining -= Math.min(remaining, iter.currentChunk.rowCount());
            }
        }
        return cells;
    }

    /// Compute the column width
    protected computeColumnWidth(clientWidth: number, rowHeaderWidth: number) {
        let available = clientWidth - rowHeaderWidth;
        let equalWidths = available;
        if (this.columnCount > 0) equalWidths = available / this.columnCount;
        let minWidth = 56;
        return Math.max(equalWidths, minWidth);
    }

    /// Render the table
    public render() {
        return (
            <div className={styles.container}>
                <AutoSizer>
                    {({ width, height }) => {
                        const columnHeaderHeight = 28;
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
                                    rowCount={this.props.tableInfo.rowCount}
                                    scrollTop={this.state.scrollTop}
                                    scrollLeft={this.state.scrollLeft}
                                    overscanColumnCount={this.state.overscanColumnCount}
                                    overscanRowCount={this.state.overscanRowCount}
                                    cellRenderer={renderDataCellPlaceholder}
                                    cellRangeRenderer={this._renderDataCellRange}
                                />
                                <Scrollbars
                                    className={styles.grid_body_scrollbars}
                                    style={{
                                        width: bodyWidth,
                                        height: bodyHeight,
                                    }}
                                    onScrollFrame={this._onScroll}
                                    autoHide
                                >
                                    <div
                                        style={{
                                            width: this.columnCount * columnWidth,
                                            height: this.props.tableInfo.rowCount * this.state.rowHeight,
                                        }}
                                    />
                                </Scrollbars>
                                <Grid
                                    className={styles.grid_anchor}
                                    width={rowHeaderWidth}
                                    height={columnHeaderHeight}
                                    columnWidth={rowHeaderWidth}
                                    columnCount={1}
                                    rowHeight={columnHeaderHeight}
                                    rowCount={1}
                                    cellRenderer={renderAnchorCell}
                                />
                                <Grid
                                    className={styles.grid_left}
                                    width={rowHeaderWidth}
                                    height={bodyHeight}
                                    columnWidth={rowHeaderWidth}
                                    columnCount={1}
                                    rowHeight={this.state.rowHeight}
                                    rowCount={this.props.tableInfo.rowCount}
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
                <div className={styles.resize_overlay} />
            </div>
        );
    }
}

export default DataGrid;
