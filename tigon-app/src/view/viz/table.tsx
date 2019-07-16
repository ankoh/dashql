import * as React from 'react';
import * as Model from '../../model';
import { connect } from 'react-redux';
import { AutoSizer, MultiGrid, GridCellProps, Index } from 'react-virtualized';

import './table.css';

// The table properties
interface ITableProps {
    data: Model.DataSource;
}

// The table state
interface ITableState {
    width: number;
    height: number;
}

// The table
class Table extends React.Component<ITableProps, ITableState> {
    protected lastUpdate: number;

    // Constructor
    constructor(props: ITableProps) {
        super(props);
        this.lastUpdate = props.data.timestamp;
    }

    // Only update the component if the timestamp changes
    public shouldComponentUpdate(nextProps: ITableProps, nextState: ITableState): boolean {
        if (this.state === nextState &&
            this.props === nextProps &&
            this.lastUpdate === nextProps.data.timestamp) {
            return false;
        }
        return true;
    }

    // Render a single cell
    public renderCell(props: GridCellProps) {
        // First column?
        if (props.columnIndex === 0) {
            return (
                <div
                    key={props.key}
                    style={{
                        ...props.style
                    }}
                >
                    {props.rowIndex > 0 ? props.rowIndex : ""}
                </div>
            );
        }

        // Header row?
        if (props.rowIndex === 0) {
            return (
                <div key={props.key} style={props.style}>
                    {this.props.data.getColumn(props.columnIndex - 1).getName()}
                </div>
            );
        }

        // Data cell
        let columnIndex = props.columnIndex - 1;
        let rowIndex = props.rowIndex - 1;
        return (
            <div key={props.key} style={props.style}>
                {this.props.data.getColumn(columnIndex).getRowAsString(rowIndex)}
            </div>
        );
    }

    // 
    public computeColumnWidth(index: Index, totalWidth: number): number {
        return 42;
        // return index ? 50: ((totalWidth - 50) / this.props.data.getColumnCount());
    }

    // Render the full table
    public render() {
        let columnCount = this.props.data.getColumnCount();
        return (
            <div className="table">
                <AutoSizer>
                    {({ height, width }) => (
                        <MultiGrid
                            cellRenderer={this.renderCell.bind(this)}
                            columnCount={columnCount + 1}
                            columnWidth={function(index: Index) {
                                let lineNumberWidth = 48;
                                let available = width - lineNumberWidth;
                                let equalWidths = available / columnCount;
                                let maxWidth = available * 0.2;
                                let minWidth = 60;
                                return (index.index === 0)
                                    ? lineNumberWidth
                                    : Math.max(Math.min(equalWidths, maxWidth), minWidth); 
                            }}
                            height={height}
                            width={width}
                            fixedRowCount={1}
                            fixedColumnCount={1}
                            rowCount={this.props.data.getRowCount() + 1}
                            rowHeight={32}
                        />
                    )}
                </AutoSizer>
            </div>
        );
    }
}

function mapStateToProps(state: Model.RootState) {
    return {
    };
}

function mapDispatchToProps(dispatch: Model.Dispatch) {
    return {
        navigateRoot: (view: Model.RootView) => { dispatch(Model.navigateRoot(view)); },
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(Table);

