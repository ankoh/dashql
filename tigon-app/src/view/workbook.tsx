import './workbook.scss';
import * as React from 'react';
import * as Model from '../model';
import { connect } from 'react-redux';
import ChartViewer from './viz/chart_viewer';

const data = {
    table: [
        {"category": "A", "amount": 28},
        {"category": "B", "amount": 55},
        {"category": "C", "amount": 43},
        {"category": "D", "amount": 91},
        {"category": "E", "amount": 81},
        {"category": "F", "amount": 53},
        {"category": "G", "amount": 19},
        {"category": "H", "amount": 87}
    ]
};


interface IWorkbookProps {
}

interface IWorkbookState {
}

export class Workbook extends React.Component<IWorkbookProps, IWorkbookState> {
    constructor(props: IWorkbookProps) {
        super(props);
    }

    public render() {
        return (
            <div className="workbook">
                <ChartViewer />
            </div>
        );
    }
}

function mapStateToProps(state: Model.RootState) {
    return {
    };
}

function mapDispatchToProps(dispatch: Model.RootState) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(Workbook);
