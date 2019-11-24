import './workbook.scss';
import * as React from 'react';
import * as Store from '../store';
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

function mapStateToProps(_state: Store.RootState) {
    return {};
}

function mapDispatchToProps(_dispatch: Store.RootState) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(Workbook);
