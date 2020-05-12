import * as React from 'react';
import * as Store from '../store';
import { connect } from 'react-redux';
import ChartViewer from './viz/chart_viewer';

import styles from './workbook.module.scss';

interface IWorkbookProps {}

interface IWorkbookState {}

export class Workbook extends React.Component<IWorkbookProps, IWorkbookState> {
    public render() {
        return (
            <div className={styles.workbook}>
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
