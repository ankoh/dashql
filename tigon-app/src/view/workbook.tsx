import './workbook.scss';
import * as React from 'react';
import * as Model from '../model';
import { connect } from 'react-redux';
import ChartViewer from './viz/chart_viewer';


interface IWorkbookProps {
}

interface IWorkbookState {
}

export class Workbook extends React.Component<IWorkbookProps, IWorkbookState> {
    public render() {
        return (
            <div className="workbook">
                <ChartViewer />
            </div>
        );
    }
}

function mapStateToProps(_state: Model.RootState) {
    return {};
}

function mapDispatchToProps(_dispatch: Model.RootState) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(Workbook);
