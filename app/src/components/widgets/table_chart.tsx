import * as Immutable from 'immutable';
import * as React from 'react';
import * as proto from '@dashql/proto';
import * as core from '@dashql/core';
import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as model from '../../model';
import { connect } from 'react-redux';
import { Grid, GridCellProps, Index } from 'react-virtualized';
import { Scrollbars } from 'react-custom-scrollbars';
import { IAppContext, withAppContext } from '../../app_context';
import { withAutoSizer } from '../../util/autosizer';

import styles from './table_chart.module.css';

type Props = {
    appContext: IAppContext;
    width: number;
    height: number;
    viz: core.model.VizData;
    dataObjects: Immutable.Map<string, core.model.DatabaseObject>;
};

type State = {
    scrollTop: number;
    scrollLeft: number;
    data: core.model.DatabaseObject | null;
    result: proto.webdb.QueryResult | null;
};

export class Table extends React.Component<Props, State> {
    protected gridRef: React.RefObject<Grid>;

    constructor(props: Props) {
        super(props);
        this.state = {
            scrollTop: 0,
            scrollLeft: 0,
            data: props.dataObjects.get(props.viz.nameQualified) || null,
            result: null,
        };
        this.gridRef = React.createRef();
    }

    /// Get the column count
    public get columnCount() {
        return this.state.data?.columnNames.length || 0;
    }

    /// Render a single cell
    public renderCell(props: GridCellProps) {
        // Determine cell type
        enum CellType {
            Anchor,
            ColumnHeader,
            RowHeader,
            Data,
        }

        const cellType =
            props.rowIndex === 0
                ? props.columnIndex === 0
                    ? CellType.Anchor
                    : CellType.ColumnHeader
                : props.columnIndex === 0
                ? CellType.RowHeader
                : CellType.Data;

        // Render cell type
        switch (cellType) {
            case CellType.Anchor:
                return <div key={props.key} className={styles.cell_anchor} style={{ ...props.style }} />;
            case CellType.ColumnHeader:
                return (
                    <div key={props.key} className={styles.cell_header_col} style={{ ...props.style }}>
                        {this.state.data?.columnNames[props.columnIndex - 1]}
                    </div>
                );
            case CellType.RowHeader:
                return (
                    <div key={props.key} className={styles.cell_header_row} style={{ ...props.style }}>
                        {props.rowIndex}
                    </div>
                );
            case CellType.Data:
                return (
                    <div key={props.key} className={styles.cell_data} style={{ ...props.style }}>
                        {42}
                    </div>
                );
        }
    }

    /// Handle scroll event
    protected handleScroll(event: any) {
        this.setState({
            ...this.state,
            scrollTop: event.target.scrollTop,
            scrollLeft: event.target.scrollLeft,
        });
    }

    /// Compute the column width
    protected getColumnWidth(index: Index) {
        let lineNumberWidth = 40;
        let available = this.props.width - lineNumberWidth;
        let equalWidths = available;
        if (this.columnCount > 0) equalWidths = available / this.columnCount;
        let minWidth = 56;
        return index.index === 0 ? lineNumberWidth : Math.max(equalWidths, minWidth);
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
        if (this.props.width !== prevProps.width || this.props.height !== prevProps.height) {
            if (this.gridRef.current) {
                this.gridRef.current.recomputeGridSize();
            }
        }
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
                result: result
            });
        } else if (data.objectType == core.model.PlanObjectType.DATABASE_TABLE) {
            const db = this.props.appContext.platform!.database;
            const result = await db.use(async (c: webdb.AsyncWebDBConnection) => {
                return await c.runQuery(`SELECT * FROM ${this.props.viz.nameShort} LIMIT 100`);
            });
            if (result) {
                this.setState({
                    ...this.state,
                    result: result
                });
            }
        }
    }

    /// Render the table
    public render() {
        return (
            <div className={styles.container} style={{ height: this.props.height, width: this.props.width }}>
                <Scrollbars
                    style={{
                        height: this.props.height,
                        width: this.props.width,
                    }}
                    onScroll={this.handleScroll.bind(this)}
                    className={styles.scrollbars}
                >
                    <Grid
                        ref={this.gridRef}
                        autoHeight
                        autoContainerWidth
                        scrollTop={this.state.scrollTop}
                        scrollLeft={this.state.scrollLeft}
                        cellRenderer={this.renderCell.bind(this)}
                        columnCount={this.columnCount + 1}
                        columnWidth={this.getColumnWidth.bind(this)}
                        height={this.props.height}
                        width={this.props.width}
                        rowCount={1 + (this.state.result?.dataChunks(0)?.rowCount()?.low || 0)}
                        rowHeight={24}
                    />
                </Scrollbars>
            </div>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    dataObjects: state.core.planDatabaseObjects,
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAutoSizer(withAppContext(Table)));
