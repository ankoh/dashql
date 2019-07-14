import * as React from 'react';
import * as Model from '../../model';
import { connect } from 'react-redux';
import { MultiGrid, GridCellProps } from 'react-virtualized';

import './table.css';

const list = [
  ['Brian Vaughn', 'Software Engineer', 'San Jose', 'CA', 95125 /* ... */ ]
];

// The table properties
interface ITableProps {
    data: Model.DataSource;
}

// The table
class Table extends React.Component<ITableProps> {
    private lastUpdate: number;

    // Constructor
    constructor(props: ITableProps) {
        super(props);
        this.lastUpdate = props.data.timestamp;
    }

    // Only update the component if the timestamp changes
    public shouldComponentUpdate(nextProps: ITableProps): boolean {
        if (this.props === nextProps && this.lastUpdate == nextProps.data.timestamp) {
            return false;
        }
        return true;
    }

    // Render a single cell
    public renderCell(props: GridCellProps) {
        return (
            <div key={props.key} style={props.style}>
                {list[props.rowIndex][props.columnIndex]}
            </div>
        );
    }

    // Render the full table
    public render() {
        return (
            <div className="table">
                <MultiGrid
                    cellRenderer={this.renderCell}
                    columnCount={list[0].length}
                    columnWidth={100}
                    fixedColumnCount={1}
                    fixedRowCount={1}
                    height={300}
                    width={300}
                    rowCount={list.length}
                    rowHeight={60}
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

export default connect(mapStateToProps, mapDispatchToProps)(Table);

