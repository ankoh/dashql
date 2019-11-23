import * as proto from 'tigon-proto';
import * as React from 'react';
import { Scrollbars } from 'react-custom-scrollbars';
import { withAutoSizer } from '../autosizer';
import { Grid, GridCellProps, Index } from 'react-virtualized';

import s from './table.module.scss';

// The table properties
interface ITableProps {
    data: proto.duckdb.QueryResult;
    width: number;
    height: number;
}

// The table state
interface ITableState {
    scrollTop: number;
}

// The table
export class Table extends React.Component<ITableProps, ITableState> {
    protected gridRef: React.RefObject<Grid>;

    constructor(props: ITableProps) {
        super(props);
        this.state = {
            scrollTop: 0,
        };
        this.gridRef = React.createRef();
    }

    // Render a single cell
    public renderCell(props: GridCellProps) {
        const cellBorder = '1px solid rgb(225, 225, 225)';
        const fixedCellColor = 'rgb(245, 245, 245)';

        enum CellType {
            Anchor,
            ColumnHeader,
            RowHeader,
            Data
        };
        let cellType = CellType.Data;

        if (props.rowIndex === 0) {
            if (props.columnIndex === 0) {
                cellType = CellType.Anchor;
            } else {
                cellType = CellType.ColumnHeader;
            }
        } else if (props.columnIndex === 0) {
            cellType = CellType.RowHeader
        }

        let columnNames = this.props.data.getColumnNamesList();

        switch (cellType) {
            case CellType.Anchor:
                return (
                    <div
                        key={props.key}
                        style={{
                            ...props.style,
                            backgroundColor: fixedCellColor,
                            boxSizing: 'border-box',
                            borderBottom: cellBorder,
                            borderRight: cellBorder,
                            textAlign: 'center',
                            lineHeight: '24px',
                        }}
                    />
                );
            case CellType.ColumnHeader:
                return (
                    <div
                        key={props.key}
                        style={{
                            ...props.style,
                            backgroundColor: fixedCellColor,
                            boxSizing: 'border-box',
                            borderBottom: cellBorder,
                            borderRight: cellBorder,
                            textAlign: 'center',
                            lineHeight: '24px',
                        }}
                    >
                        {columnNames[props.columnIndex - 1]}
                    </div>
                );
            case CellType.RowHeader:
                return (
                    <div
                        key={props.key}
                        style={{
                            ...props.style,
                            backgroundColor: fixedCellColor,
                            boxSizing: 'border-box',
                            borderBottom: cellBorder,
                            borderRight: cellBorder,
                            textAlign: 'center',
                            lineHeight: '24px',
                        }}
                    >
                        {props.rowIndex}
                    </div>
                );
            case CellType.Data:
            {
                // let columnIndex = props.columnIndex - 1;
                // let rowIndex = props.rowIndex - 1;
                return (
                    <div
                        key={props.key}
                        style={{
                            ...props.style,
                            boxSizing: 'border-box',
                            borderBottom: cellBorder,
                            borderRight: cellBorder,
                            lineHeight: '28px',
                            padding: '0px 8px 0px 8px',
                        }}
                    >
                        foo
                    </div>
                );
            }
        }
    }

    // Handle scroll event
    protected handleScroll(event: any) {
        this.setState({
            ...this.state,
            scrollTop: event.target.scrollTop
        });
    }

    // Compute the column width
    protected getColumnWidth(index: Index) {
        let lineNumberWidth = 40;
        let available = this.props.width - lineNumberWidth;
        let equalWidths = available / this.props.data.getColumnCount();
        let minWidth = 56;
        return (index.index === 0)
            ? lineNumberWidth
            : Math.max(equalWidths, minWidth);
    }

    public componentDidUpdate(prevProps: ITableProps) {
        if (this.props.width !== prevProps.width || this.props.height !== prevProps.height) {
            if (this.gridRef.current) {
                this.gridRef.current.recomputeGridSize();
            }
        }
    }

    // Render the full table
    public render() {
        return (
            <div className={s.container} style={{ height: this.props.height, width: this.props.width }}>
                <Scrollbars
                    style={{ height: this.props.height, width: this.props.width }}
                    onScroll={this.handleScroll.bind(this)}
                    className={s.scrollbars}
                >
                    <Grid
                        ref={this.gridRef}
                        autoHeight
                        autoContainerWidth
                        scrollTop={this.state.scrollTop}
                        cellRenderer={this.renderCell.bind(this)}
                        columnCount={this.props.data.getColumnCount() + 1}
                        columnWidth={this.getColumnWidth.bind(this)}
                        height={this.props.height}
                        width={this.props.width}
                        rowCount={this.props.data.getRowCount()}
                        rowHeight={28}
                    />
                </Scrollbars>
            </div>
        );
    }
}

export default withAutoSizer(Table);
