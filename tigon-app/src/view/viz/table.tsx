import * as proto from 'tigon-proto';
import * as React from 'react';
import { Scrollbars } from 'react-custom-scrollbars';
import { AutoSizer, Grid, GridCellProps, Index } from 'react-virtualized';

import s from './table.module.scss';

// The table properties
interface ITableProps {
    data: proto.duckdb.QueryResult;
}

// The table state
interface ITableState {
    scrollTop: number;
}

// The table
export class Table extends React.Component<ITableProps, ITableState> {
    constructor(props: ITableProps) {
        super(props);
        this.state = {
            scrollTop: 0,
        };
    }

    // Only update the component if the timestamp changes
    public shouldComponentUpdate(nextProps: ITableProps, nextState: ITableState): boolean {
        if (this.state === nextState &&
            this.props === nextProps) {
            return false;
        }
        return true;
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

    // Render the full table
    public render() {
        let rowCount = this.props.data.getRowCount();
        let colCount = this.props.data.getColumnCount();
        return (
            <div className={s.table}>
                <AutoSizer>
                    {({ height, width }) => (
                        <Scrollbars
                            style={{ height: height, width: width }}
                            onScroll={this.handleScroll.bind(this)}
                            className={s.table_scrollbars}
                        >
                            <Grid
                                autoHeight
                                scrollTop={this.state.scrollTop}
                                cellRenderer={this.renderCell.bind(this)}
                                columnCount={colCount + 1}
                                columnWidth={function(index: Index) {
                                    let lineNumberWidth = 40;
                                    let available = width - lineNumberWidth;
                                    let equalWidths = available / colCount;
                                    let minWidth = 56;
                                    return (index.index === 0)
                                        ? lineNumberWidth
                                        : Math.max(equalWidths, minWidth);
                                }}
                                height={height}
                                width={width}
                                fixedRowCount={1}
                                fixedColumnCount={1}
                                rowCount={rowCount}
                                rowHeight={28}
                            />
                        </Scrollbars>
                    )}
                </AutoSizer>
            </div>
        );
    }
}

export default Table;
