import * as React from 'react';
import * as Model from '../../model';
import { connect } from 'react-redux';
import { MultiGrid, GridCellProps } from 'react-virtualized';
import { withSize, SizeMeProps } from 'react-sizeme';

import './table.css';

// The table properties
interface ITableProps extends SizeMeProps {
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
        // Header?
        if (props.rowIndex === 0) {
            return (
                <div key={props.key} style={props.style}>
                    {this.props.data.getColumn(props.columnIndex).getName()}
                </div>
            );
        } else {
            return (
                <div key={props.key} style={props.style}>
                    {this.props.data.getColumn(props.columnIndex).getRowAsString(props.rowIndex)}
                </div>
            );
        }
    }

    public componentDidMount() {
    }

    // Render the full table
    public render() {
        return (
            <div className="table">
                <MultiGrid
                    cellRenderer={this.renderCell.bind(this)}
                    columnCount={this.props.data.getColumnCount()}
                    columnWidth={100}
                    fixedRowCount={1}
                    height={this.props.size.height || 200}
                    width={this.props.size.width || 300}
                    rowCount={this.props.data.getRowCount() + 1}
                    rowHeight={40}
                />
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

export default connect(mapStateToProps, mapDispatchToProps)(withSize()(Table));

