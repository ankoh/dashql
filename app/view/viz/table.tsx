import * as React from 'react';
import * as proto from '@tigon/proto';
import { ChunkedResult } from '../../proto/engine_access';
import { Grid, GridCellProps, Index } from 'react-virtualized';
import { Scrollbars } from 'react-custom-scrollbars';
import { withAutoSizer } from '../autosizer';

import styles from './table.module.scss';

type Props = {
    data: proto.engine.QueryResult;
    width: number;
    height: number;
};

type State = {
    result: ChunkedResult;
    scrollTop: number;
    scrollLeft: number;
};

// The table
export class Table extends React.Component<Props, State> {
    protected gridRef: React.RefObject<Grid>;

    constructor(props: Props) {
        super(props);
        this.state = {
            result: new ChunkedResult(props.data),
            scrollTop: 0,
            scrollLeft: 0,
        };
        this.gridRef = React.createRef();
    }

    // Render a single cell
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
                return (
                    <div
                        key={props.key}
                        className={styles.cell_anchor}
                        style={{ ...props.style }}
                    />
                );
            case CellType.ColumnHeader:
                return (
                    <div
                        key={props.key}
                        className={styles.cell_header_col}
                        style={{ ...props.style }}
                    >
                        {this.state.result.getColumnName(props.columnIndex - 1)}
                    </div>
                );
            case CellType.RowHeader:
                return (
                    <div
                        key={props.key}
                        className={styles.cell_header_row}
                        style={{ ...props.style }}
                    >
                        {props.rowIndex}
                    </div>
                );
            case CellType.Data:
                return (
                    <div
                        key={props.key}
                        className={styles.cell_data}
                        style={{ ...props.style }}
                    >
                        {String(
                            this.state.result.getStringValue(
                                props.columnIndex - 1,
                                props.rowIndex - 1,
                            ),
                        )}
                    </div>
                );
        }
    }

    // Handle scroll event
    protected handleScroll(event: any) {
        this.setState({
            ...this.state,
            scrollTop: event.target.scrollTop,
            scrollLeft: event.target.scrollLeft,
        });
    }

    // Compute the column width
    protected getColumnWidth(index: Index) {
        let lineNumberWidth = 40;
        let available = this.props.width - lineNumberWidth;
        let equalWidths = available / this.state.result.getColumnCount();
        let minWidth = 56;
        return index.index === 0
            ? lineNumberWidth
            : Math.max(equalWidths, minWidth);
    }

    public componentDidUpdate(prevProps: Props) {
        if (
            this.props.width !== prevProps.width ||
            this.props.height !== prevProps.height
        ) {
            if (this.gridRef.current) {
                this.gridRef.current.recomputeGridSize();
            }
        }

        if (this.props.data != prevProps.data) {
            this.setState({
                result: new ChunkedResult(this.props.data),
            });
        }
    }

    // Render the full table
    public render() {
        return (
            <div
                className={styles.container}
                style={{ height: this.props.height, width: this.props.width }}
            >
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
                        columnCount={this.state.result.getColumnCount() + 1}
                        columnWidth={this.getColumnWidth.bind(this)}
                        height={this.props.height}
                        width={this.props.width}
                        rowCount={this.state.result.getRowCount() + 1}
                        rowHeight={24}
                    />
                </Scrollbars>
            </div>
        );
    }
}

export default withAutoSizer(Table);
