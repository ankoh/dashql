import * as Immutable from 'immutable';
import * as React from 'react';
import * as proto from '@dashql/proto';
import * as core from '@dashql/core';
import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as model from '../../model';
import { connect } from 'react-redux';
import { Grid, GridCellProps, AutoSizer } from 'react-virtualized';
import { Scrollbars, positionValues } from 'react-custom-scrollbars';
import { IAppContext, withAppContext } from '../../app_context';

import styles from './data_grid.module.css';

type Props = {
    appContext: IAppContext;
    data: core.model.DatabaseObject;
};

type State = {
    queryResult: proto.webdb.QueryResult | null;

    scrollTop: number;
    scrollLeft: number;

    overscanColumnCount: number;
    overscanRowCount: number;
    rowHeight: number;
    rowCount: number;
};

export class DataGrid extends React.Component<Props, State> {
    protected _onScroll = this.onScroll.bind(this);
    protected _renderAnchorCell = this.renderAnchorCell.bind(this);
    protected _renderBodyCell = this.renderBodyCell.bind(this);
    protected _renderRowHeaderCell = this.renderRowHeaderCell.bind(this);
    protected _renderColumnHeaderCell = this.renderColumnHeaderCell.bind(this);

    constructor(props: Props) {
        super(props);
        this.state = {
            queryResult: null,

            scrollTop: 0,
            scrollLeft: 0,

            overscanColumnCount: 0,
            overscanRowCount: 5,
            rowHeight: 32,
            rowCount: 100,
        };
    }

    /// Get the column count
    public get columnCount() {
        return this.props.data.columnNames.length || 0;
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

    /// Render a body cell
    public renderBodyCell(props: GridCellProps): JSX.Element {
        return (
            <div key={props.key} className={styles.cell_data} style={{ ...props.style }}>
                {42}
            </div>
        );
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

    /// Compute the column width
    protected computeColumnWidth(clientWidth: number, rowHeaderWidth: number) {
        let available = clientWidth - rowHeaderWidth;
        let equalWidths = available;
        if (this.columnCount > 0) equalWidths = available / this.columnCount;
        let minWidth = 56;
        return Math.max(equalWidths, minWidth);
    }

    public componentDidMount() {
        this.queryData();
    }

    /// Did component update?
    public componentDidUpdate(prevProps: Props) {
        if (this.props.data !== prevProps.data) {
            this.queryData();
        }
    }

    protected async queryData() {
        const data = this.props.data;
        if (data.objectType == core.model.PlanObjectType.DATABASE_VIEW) {
            const result = (data as core.model.DatabaseView).queryResult;
            this.setState({
                ...this.state,
                queryResult: result,
            });
        } else if (data.objectType == core.model.PlanObjectType.DATABASE_TABLE) {
            const db = this.props.appContext.platform!.database;
            const result = await db.use(async (c: webdb.AsyncWebDBConnection) => {
                return await c.runQuery(`SELECT * FROM ${this.props.data.nameShort} LIMIT 100`);
            });
            if (result) {
                this.setState({
                    ...this.state,
                    queryResult: result,
                });
            }
        }
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
                                    rowCount={this.state.rowCount}
                                    scrollTop={this.state.scrollTop}
                                    scrollLeft={this.state.scrollLeft}
                                    overscanColumnCount={this.state.overscanColumnCount}
                                    overscanRowCount={this.state.overscanRowCount}
                                    cellRenderer={this._renderBodyCell}
                                />
                                <Scrollbars
                                    className={styles.grid_body_scrollbars}
                                    style={{
                                        width: bodyWidth - 2,
                                        height: bodyHeight - 2,
                                    }}
                                    onScrollFrame={this._onScroll}
                                    autoHide
                                >
                                    <div
                                        style={{
                                            width: this.columnCount * columnWidth,
                                            height: this.state.rowCount * this.state.rowHeight,
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
                                    rowCount={this.state.rowCount}
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

export default withAppContext(DataGrid);
