import * as Immutable from 'immutable';
import * as React from 'react';
import * as proto from '@dashql/proto';
import * as core from '@dashql/core';
import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as model from '../../model';
import { connect } from 'react-redux';
import { Grid, GridCellProps, ScrollSync, AutoSizer } from 'react-virtualized';
import { IAppContext, withAppContext } from '../../app_context';

import styles from './table_chart.module.css';

type Props = {
    appContext: IAppContext;
    viz: core.model.VizData;
    dataObjects: Immutable.Map<string, core.model.DatabaseObject>;
};

type State = {
    data: core.model.DatabaseObject | null;
    result: proto.webdb.QueryResult | null;

    columnCount: number;
    overscanColumnCount: number;
    overscanRowCount: number;
    rowHeight: number;
    rowCount: number;
};

export class Table extends React.Component<Props, State> {
    protected _renderAnchorCell = this.renderAnchorCell.bind(this);
    protected _renderBodyCell = this.renderBodyCell.bind(this);
    protected _renderRowHeaderCell = this.renderRowHeaderCell.bind(this);
    protected _renderColumnHeaderCell = this.renderColumnHeaderCell.bind(this);

    constructor(props: Props) {
        super(props);
        this.state = {
            data: props.dataObjects.get(props.viz.nameQualified) || null,
            result: null,

            columnCount: 50,
            overscanColumnCount: 0,
            overscanRowCount: 5,
            rowHeight: 40,
            rowCount: 100,
        };
    }

    /// Get the column count
    public get columnCount() {
        return this.state.data?.columnNames.length || 0;
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
        const data = this.props.dataObjects.get(this.props.viz.nameQualified) || null;
        if (data) {
            this.setState({
                ...this.state,
                data: data as core.model.DatabaseObject,
            });
            this.queryData(data);
        }
    }

    /// Did component update?
    public componentDidUpdate(prevProps: Props) {
        if (this.props.viz != prevProps.viz) {
            const data = this.props.dataObjects.get(this.props.viz.nameQualified) || null;
            if (data) {
                this.setState({
                    ...this.state,
                    data: data as core.model.DatabaseObject,
                });
                this.queryData(data);
            }
        }
    }

    protected async queryData(data: core.model.DatabaseObject) {
        if (data.objectType == core.model.PlanObjectType.DATABASE_VIEW) {
            const result = (data as core.model.DatabaseView).queryResult;
            this.setState({
                ...this.state,
                result: result,
            });
        } else if (data.objectType == core.model.PlanObjectType.DATABASE_TABLE) {
            const db = this.props.appContext.platform!.database;
            const result = await db.use(async (c: webdb.AsyncWebDBConnection) => {
                return await c.runQuery(`SELECT * FROM ${this.props.viz.nameShort} LIMIT 100`);
            });
            if (result) {
                this.setState({
                    ...this.state,
                    result: result,
                });
            }
        }
    }

    /// Render the table
    public render() {
        return (
            <div className={styles.container}>
                <AutoSizer>
                    {({ width, height }) => (
                        <ScrollSync>
                            {({ onScroll, scrollLeft, scrollTop }) => {
                                const rowHeaderWidth = 40;
                                const columnWidth = this.computeColumnWidth(width, rowHeaderWidth);
                                const bodyHeight = height - this.state.rowHeight;
                                const bodyWidth = width - rowHeaderWidth;
                                console.log(`${bodyHeight} ${bodyWidth}`);
                                return (
                                    <div
                                        className={styles.grid_container}
                                        style={{
                                            display: 'grid',
                                            gridTemplateRows: `${this.state.rowHeight}px ${bodyHeight}px`,
                                            gridTemplateColumns: `${rowHeaderWidth}px ${bodyWidth}px`,
                                        }}
                                    >
                                        <Grid
                                            className={styles.grid_anchor}
                                            width={rowHeaderWidth}
                                            height={this.state.rowHeight}
                                            columnWidth={rowHeaderWidth}
                                            columnCount={1}
                                            rowHeight={this.state.rowHeight}
                                            rowCount={1}
                                            scrollTop={scrollTop}
                                            cellRenderer={this._renderAnchorCell}
                                        />
                                        <Grid
                                            className={styles.grid_left}
                                            width={rowHeaderWidth}
                                            height={height - this.state.rowHeight}
                                            columnWidth={rowHeaderWidth}
                                            columnCount={1}
                                            rowHeight={this.state.rowHeight}
                                            rowCount={this.state.rowCount}
                                            scrollTop={scrollTop}
                                            overscanColumnCount={this.state.overscanColumnCount}
                                            overscanRowCount={this.state.overscanRowCount}
                                            cellRenderer={this._renderRowHeaderCell}
                                        />
                                        <div
                                            className={styles.grid_container_dyn}
                                            style={{
                                                display: 'grid',
                                                gridTemplateRows: `${this.state.rowHeight}px calc(100% - ${this.state.rowHeight}px)`,
                                                gridTemplateColumns: '100%',
                                            }}
                                        >
                                            <AutoSizer>
                                                {({ width, height }) => (
                                                    <>
                                                        <Grid
                                                            className={styles.grid_header}
                                                            width={width}
                                                            height={this.state.rowHeight}
                                                            columnWidth={columnWidth}
                                                            columnCount={this.state.columnCount}
                                                            rowHeight={this.state.rowHeight}
                                                            rowCount={1}
                                                            scrollLeft={scrollLeft}
                                                            cellRenderer={this._renderColumnHeaderCell}
                                                        />
                                                        <Grid
                                                            className={styles.grid_body}
                                                            width={width}
                                                            height={height - this.state.rowHeight}
                                                            columnWidth={columnWidth}
                                                            columnCount={this.state.columnCount}
                                                            rowHeight={this.state.rowHeight}
                                                            rowCount={this.state.rowCount}
                                                            scrollLeft={scrollLeft}
                                                            onScroll={onScroll}
                                                            overscanColumnCount={this.state.overscanColumnCount}
                                                            overscanRowCount={this.state.overscanRowCount}
                                                            cellRenderer={this._renderBodyCell}
                                                        />
                                                    </>
                                                )}
                                            </AutoSizer>
                                        </div>
                                    </div>
                                );
                            }}
                        </ScrollSync>
                    )}
                </AutoSizer>
            </div>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    dataObjects: state.core.planDatabaseObjects,
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(Table));
