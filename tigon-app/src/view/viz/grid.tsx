import * as React from 'react';
import * as Model from '../../model';
import { connect } from 'react-redux';
import { MultiGrid, GridCellProps } from 'react-virtualized';

import './grid.css';

// Grid data as an array of arrays
const list = [
  ['Brian Vaughn', 'Software Engineer', 'San Jose', 'CA', 95125 /* ... */ ]
];

// The table properties
interface IGridProps {
    data: Model.DataSource;
}

function cellRenderer(props: GridCellProps) {
    return (
        <div key={props.key} style={props.style}>
            {list[props.rowIndex][props.columnIndex]}
        </div>
    );
}

// The table
class Grid extends React.Component<IGridProps> {
    private lastUpdate: number;

    constructor(props: IGridProps) {
        super(props);
        this.lastUpdate = props.data.timestamp;
    }
    public render() {
        return (
            <MultiGrid
                className="grid"
                cellRenderer={cellRenderer}
                columnCount={list[0].length}
                columnWidth={100}
                fixedColumnCount={2}
                fixedRowCount={1}
                height={300}
                width={300}
                rowCount={list.length}
                rowHeight={60}
            />
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

export default connect(mapStateToProps, mapDispatchToProps)(Grid);

