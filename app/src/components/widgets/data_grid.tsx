import * as React from 'react';
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
            overscanRowCount: 5,
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
        // No data provided?
        // Render as missing.
        if (!this.props.data) {
            return defaultCellRangeRenderer(props);
        }

        // Range is fully included?
        const req = this.props.data.request;
        if (req.includes(props.rowStartIndex, props.rowStopIndex - props.rowStartIndex)) {
            return this.renderAvailableDataCellRange(props);
        }

        // Request additional data from provider
        this.props.dataProvider(
            new core.access.ScanRequest(props.rowStartIndex, props.rowStopIndex - props.rowStartIndex),
        );

        // Does not intersect with query results?
        // Render as missing.
        if (!req.intersects(props.rowStartIndex, props.rowStopIndex - props.rowStartIndex)) {
            return defaultCellRangeRenderer(props);
        }

        const dataBegin = req.offset;
        const dataEnd = req.offset + req.limit;
        const rowStart = props.rowStartIndex;
        const rowStop = props.rowStopIndex;

        // Render missing cells at the beginning
        props.rowStartIndex = rowStart;
        props.rowStopIndex = Math.max(props.rowStartIndex, dataBegin);
        const before = defaultCellRangeRenderer(props);

        // Render missing cells at the end
        props.rowStartIndex = Math.min(props.rowStopIndex, dataEnd);
        props.rowStopIndex = props.rowStopIndex;
        const after = defaultCellRangeRenderer(props);

        // Render available cells
        props.rowStartIndex = dataBegin;
        props.rowStopIndex = dataEnd;
        const available = this.renderAvailableDataCellRange(props);

        // Concatenate the cells
        props.rowStartIndex = rowStart;
        props.rowStopIndex = rowStop;
        return before.concat(available).concat(after);
    }

    /// Render an available data cell
    public renderAvailableDataCell<T>(
        props: GridCellRangeProps,
        rowIndex: number,
        rowDatum: SizeAndPositionData,
        columnIndex: number,
        columnDatum: SizeAndPositionData,
        canCacheStyle: boolean,
        value: T,
        renderCell: (v: T) => React.ReactNode,
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
                props.cellCache[key] = renderCell(value);
            }
            cell = props.cellCache[key];
        } else {
            cell = renderCell(value);
        }
        return cell;
    }

    public renderAvailableDataCellRange(props: GridCellRangeProps): React.ReactNode[] {
        const renderedCells = [];

        // Can use style cache?
        const areOffsetsAdjusted =
            props.columnSizeAndPositionManager.areOffsetsAdjusted() ||
            props.rowSizeAndPositionManager.areOffsetsAdjusted();
        const canCacheStyle = !props.isScrolling && !areOffsetsAdjusted;

        // Iterate over all columns
        for (let columnIndex = props.columnStartIndex; columnIndex <= props.columnStopIndex; columnIndex++) {
            let columnDatum = props.columnSizeAndPositionManager.getSizeAndPositionOfCell(columnIndex);

            // Iterate over all rows
            for (let rowIndex = props.rowStartIndex; rowIndex <= props.rowStopIndex; rowIndex++) {
                let rowDatum = props.rowSizeAndPositionManager.getSizeAndPositionOfCell(rowIndex);

                // Render the data cell
                let cell = this.renderAvailableDataCell(
                    props,
                    rowIndex,
                    rowDatum,
                    columnIndex,
                    columnDatum,
                    canCacheStyle,
                    21,
                    v => <div>{v}</div>,
                );

                // Push the data cell
                if (cell) {
                    renderedCells.push(cell);
                }
            }
        }
        return renderedCells;
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
