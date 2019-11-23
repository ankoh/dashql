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
    protected chunkCache: number;

    constructor(props: ITableProps) {
        super(props);
        this.state = {
            scrollTop: 0,
        };
        this.gridRef = React.createRef();
        this.chunkCache = 0;
    }

    // TODO: extract the chunk iteration logic into a dedicated iterator.
    // Note that we still want to preserve the concept of data chunks as we might
    // want to stream the chunks via websockets (grpc) at some point.
    protected fmtValue(row: number, col: number): string {
        let chunks = this.props.data.getDataChunksList();
        let chunk: proto.duckdb.QueryResultChunk | null = null;

        // Compare a chunk range
        let cmpChunkRange = (c: proto.duckdb.QueryResultChunk, row: number) => {
            let begin = c.getRowOffset();
            let end = c.getRowOffset() + c.getRowCount();
            if (row >= begin && row < end) {
                return 0;
            } else if (row < begin) {
                return -1;
            } else {
                return 1;
            }
        };

        // Cached chunk?
        if (this.chunkCache < chunks.length && cmpChunkRange(chunks[this.chunkCache], row) === 0) {
            chunk = chunks[this.chunkCache];
        }
        if (chunk == null) {
            let lb = 0;
            let ub = chunks.length;
            while (lb < ub) {
                let mid = Math.floor((lb + ub) / 2);
                let candidate = chunks[mid];
                let cmp = cmpChunkRange(candidate, row);
                if (cmp === 0) {
                    chunk = candidate;
                    this.chunkCache = mid;
                    break;
                } else if (cmp > 0) {
                    lb = mid + 1;
                } else {
                    ub = mid;
                }
            }
        }

        // Row oob?
        if (chunk == null) {
            return "%ERR%"; // XXX log oob
        }

        // Column oob?
        let columns = chunk.getColumnsList();
        if (col > columns.length) {
            return "%ERR%"; // XXX log oob
        }
        let column = columns[col];

        // NULL?
        let nullMask = column.getNullMaskList();
        if (col <= nullMask.length && nullMask[col]) {
            return "NULL";
        }

        switch (column.getTypeId()) {
            case proto.duckdb.RawTypeID.RAW_BIGINT:
                return column.getRowsI64List()[row].toString();
            case proto.duckdb.RawTypeID.RAW_BOOLEAN:
                return column.getRowsI32List()[row].toString();
            case proto.duckdb.RawTypeID.RAW_DOUBLE:
                return column.getRowsF64List()[row].toString();
            case proto.duckdb.RawTypeID.RAW_FLOAT:
                return column.getRowsF32List()[row].toString();
            case proto.duckdb.RawTypeID.RAW_HASH:
                return column.getRowsU64List()[row].toString();
            case proto.duckdb.RawTypeID.RAW_INTEGER:
                return column.getRowsI64List()[row].toString();
            case proto.duckdb.RawTypeID.RAW_POINTER:
                return column.getRowsU64List()[row].toString();
            case proto.duckdb.RawTypeID.RAW_SMALLINT:
                return column.getRowsI32List()[row].toString();
            case proto.duckdb.RawTypeID.RAW_TINYINT:
                return column.getRowsI32List()[row].toString();
            case proto.duckdb.RawTypeID.RAW_VARBINARY:
                break;
            case proto.duckdb.RawTypeID.RAW_VARCHAR:
                return column.getRowsStrList()[row].toString();
        }
        return "%ERR%"; // XXX log unknown
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

        // Determine cell type
        if (props.rowIndex === 0) {
            if (props.columnIndex === 0) {
                cellType = CellType.Anchor;
            } else {
                cellType = CellType.ColumnHeader;
            }
        } else if (props.columnIndex === 0) {
            cellType = CellType.RowHeader
        }

        // Render cell type
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
                        {this.props.data.getColumnNamesList()[props.columnIndex - 1]}
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
                        {this.fmtValue(props.rowIndex - 1, props.columnIndex - 1)}
                    </div>
                );
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
