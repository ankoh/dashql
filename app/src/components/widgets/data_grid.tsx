import * as React from 'react';
import * as core from '@dashql/core';
import { Grid, GridCellProps, GridCellRangeProps, AutoSizer, defaultCellRangeRenderer } from 'react-virtualized';
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

export class DataGrid extends React.Component<Props, State> {
    protected _onScroll = this.onScroll.bind(this);
    protected _renderAnchorCell = this.renderAnchorCell.bind(this);
    protected _renderDataCellPlaceholder = this.renderDataCellPlaceholder.bind(this);
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

    /// Render an anchor cell
    protected renderAnchorCell(props: GridCellProps): JSX.Element {
        return <div key={props.key} className={styles.cell_anchor} style={{ ...props.style }} />;
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

    /// Render a data cell placeholder for data that is not yet avaialable
    protected renderDataCellPlaceholder(props: GridCellProps): JSX.Element {
        return (
            <div key={props.key} className={styles.cell_data} style={{ ...props.style }}>
                {42}
            </div>
        );
    }

    /// Render a missing data cell range
    protected renderMissingDataCellRange(props: GridCellRangeProps): React.ReactNode[] {
        return defaultCellRangeRenderer(props);
    }

    /// Render a data cell range
    public renderDataCellRange(props: GridCellRangeProps): React.ReactNode[] {
        // No data provided?
        // Render as missing.
        if (!this.props.data) {
            return this.renderMissingDataCellRange(props);
        }

        // Range is fully included? 
        const req = this.props.data.request;
        if (req.includes(props.rowStartIndex, props.rowStopIndex - props.rowStartIndex)) {
            return this.renderAvailableDataCellRange(props);
        }

        // Request new data from provider
        this.props.dataProvider(new core.access.ScanRequest(props.rowStartIndex, props.rowStopIndex - props.rowStartIndex));

        // Does not intersect with range?
        // Render as missing.
        if (!req.intersects(props.rowStartIndex, props.rowStopIndex - props.rowStartIndex)) {
            return this.renderMissingDataCellRange(props);
        }

        const dataBegin = req.offset;
        const dataEnd = req.offset + req.limit;
        const rowStart = props.rowStartIndex;
        const rowStop = props.rowStopIndex;

        // Render missing cells at the beginning
        props.rowStartIndex = rowStart;
        props.rowStopIndex = Math.max(props.rowStartIndex, dataBegin);
        const before = this.renderMissingDataCellRange(props);

        // Render missing cells at the end
        props.rowStartIndex = Math.min(props.rowStopIndex, dataEnd);
        props.rowStopIndex = props.rowStopIndex;
        const after = this.renderMissingDataCellRange(props);

        // Render available cells
        props.rowStartIndex = dataBegin;
        props.rowStopIndex = dataEnd;
        const available = this.renderAvailableDataCellRange(props);

        // Concatenate the cells
        props.rowStartIndex = rowStart;
        props.rowStopIndex = rowStop;
        return before.concat(available).concat(after);
    }

    public renderAvailableDataCellRange(props: GridCellRangeProps): React.ReactNode[] {
        const renderedCells = [];

        // Browsers have native size limits for elements (eg Chrome 33M pixels, IE 1.5M pixes).
        // User cannot scroll beyond these size limitations.
        // In order to work around this, ScalingCellSizeAndPositionManager compresses offsets.
        // We should never cache styles for compressed offsets though as this can lead to bugs.
        // See issue #576 for more.
        const areOffsetsAdjusted =
            props.columnSizeAndPositionManager.areOffsetsAdjusted() || props.rowSizeAndPositionManager.areOffsetsAdjusted();

        const canCacheStyle = !props.isScrolling && !areOffsetsAdjusted;

        for (let columnIndex = props.columnStartIndex; columnIndex <= props.columnStopIndex; columnIndex++) {
            let columnDatum = props.columnSizeAndPositionManager.getSizeAndPositionOfCell(columnIndex);

            for (let rowIndex = props.rowStartIndex; rowIndex <= props.rowStopIndex; rowIndex++) {
                let rowDatum = props.rowSizeAndPositionManager.getSizeAndPositionOfCell(rowIndex);

                let isVisible =
                    columnIndex >= props.visibleColumnIndices.start &&
                    columnIndex <= props.visibleColumnIndices.stop &&
                    rowIndex >= props.visibleRowIndices.start &&
                    rowIndex <= props.visibleRowIndices.stop;
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

                let cellRendererParams: GridCellProps = {
                    columnIndex,
                    isScrolling: props.isScrolling,
                    isVisible,
                    key,
                    parent: props.parent,
                    rowIndex,
                    style,
                };
                let renderedCell;

                // Avoid re-creating cells while scrolling.
                // This can lead to the same cell being created many times and can cause performance issues for "heavy" cells.
                // If a scroll is in progress- cache and reuse cells.
                // This cache will be thrown away once scrolling completes.
                // However if we are scaling scroll positions and sizes, we should also avoid caching.
                // This is because the offset changes slightly as scroll position changes and caching leads to stale values.
                // For more info refer to issue #395
                //
                // If isScrollingOptOut is specified, we always cache cells.
                // For more info refer to issue #1028
                if (
                    (props.isScrollingOptOut || props.isScrolling) &&
                    !props.horizontalOffsetAdjustment &&
                    !props.verticalOffsetAdjustment
                ) {
                    if (!props.cellCache[key]) {
                        props.cellCache[key] = props.cellRenderer(cellRendererParams);
                    }
                    renderedCell = props.cellCache[key];

                    // If the user is no longer scrolling, don't cache cells.
                    // This makes dynamic cell content difficult for users and would also lead to a heavier memory footprint.
                } else {
                    renderedCell = props.cellRenderer(cellRendererParams);
                }

                if (renderedCell == null || renderedCell === false) {
                    continue;
                }
                renderedCells.push(renderedCell);
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
                                    cellRenderer={this._renderDataCellPlaceholder}
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
                                    cellRenderer={this._renderAnchorCell}
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
