import './workbook.scss';
import * as React from 'react';
import * as Model from '../model';
import { connect } from 'react-redux';

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
