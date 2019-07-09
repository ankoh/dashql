import * as React from 'react';
import * as Store from '../store';
import { IAppContext, withAppContext } from '../AppContext';
import Terminal from './Terminal';
import './DataExplorer.css';
import { connect } from 'react-redux';

interface IDataExplorerProps {
    appContext: IAppContext;
    labView: number;
    navigateLab: (tabID: number) => void;
    queryDuration: number | null;
    queryResult: Store.QueryResult | null;
    queryStart: number | null;
}

class DataExplorer extends React.Component<IDataExplorerProps> {
    public render() {
        return (
            <div className="DataExplorer">
                <div className="DataExplorer-Viewer">
                </div>
                <div className="DataExplorer-Input">
                    <div className="DataExplorer-Input-Header">
                    </div>
                    <div className="DataExplorer-Input-Terminal">
                        <Terminal />
                    </div>

                    <p id="output" />
                </div>
            </div>
        );
    }
}

function mapStateToDataExplorerProps(state: Store.RootState) {
    return {
        labView: state.labView,
        queryDuration: state.labQueryDuration,
        queryResult: state.labQueryResult,
        queryStart: state.labQueryStart,
    };
}

function mapDispatchToDataExplorerProps(dispatch: Store.Dispatch) {
    return {
        navigateLab: (tabID: number) => { dispatch(Store.navigateLab(tabID)); }
    };
}

export default withAppContext(connect(mapStateToDataExplorerProps, mapDispatchToDataExplorerProps)(DataExplorer));

