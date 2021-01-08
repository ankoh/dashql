import * as React from 'react';
import * as core from '@dashql/core';
import { Grid, GridCellProps, GridCellRangeProps, AutoSizer, defaultCellRangeRenderer } from 'react-virtualized';
import { Scrollbars, positionValues } from 'react-custom-scrollbars';

import styles from './data_grid.module.css';

type Props = {
    tableInfo: core.model.DatabaseTableInfo;
    data: core.access.PartialScanResult | null;
    dataProvider: (range: core.access.ScanRange) => void;
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
    protected _renderDataCell = this.renderDataCell.bind(this);
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
    public renderAnchorCell(props: GridCellProps): JSX.Element {
        return <div key={props.key} className={styles.cell_anchor} style={{ ...props.style }} />;
    }

    /// Render a cell of the static left sidebar
    public renderRowHeaderCell(props: GridCellProps): JSX.Element {
        return (
            <div key={props.key} className={styles.cell_header_row} style={{ ...props.style }}>
                {props.rowIndex}
            </div>
        );
    }

    /// Render a cell of the header
    public renderColumnHeaderCell(props: GridCellProps): JSX.Element {
        return (
            <div key={props.key} className={styles.cell_header_col} style={{ ...props.style }}>
                {'foo'}
            </div>
        );
    }

    /// Render a data cell
    public renderDataCell(props: GridCellProps): JSX.Element {
        return (
            <div key={props.key} className={styles.cell_data} style={{ ...props.style }}>
                {42}
            </div>
        );
    }

    public async queryData(props: GridCellRangeProps) {
    }

    /// Render a data cell range
    public renderDataCellRange(props: GridCellRangeProps): React.ReactNode[] {
        const range = {
            offset: props.rowStartIndex,
            limit: props.rowStopIndex - props.rowStartIndex,
        };

        return defaultCellRangeRenderer(props);
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
                                    cellRenderer={this._renderDataCell}
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
                                    cellRangeRenderer={this._renderDataCellRange}
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
