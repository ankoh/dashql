import * as React from 'react';
import * as Store from '../store';
import { IAppContext, withAppContext } from '../AppContext';
import Terminal from './Terminal';
import './SQLLab.css';
import { connect } from 'react-redux';

interface ISQLLabProps {
    appContext: IAppContext;
    labView: number;
    navigateLab: (tabID: number) => void;
    queryDuration: number | null;
    queryResult: Store.QueryResult | null;
    queryStart: number | null;
}

class SQLLab extends React.Component<ISQLLabProps> {
    public render() {
        return (
            <div className="SQLLab">
                <div className="SQLLab-Viewer">
                </div>
                <div className="SQLLab-Input">
                    <div className="SQLLab-Input-Header">
                    </div>
                    <div className="SQLLab-Input-Terminal">
                        <Terminal />
                    </div>
                </div>
            </div>
        );
    }
}

function mapStateToSQLLabProps(state: Store.RootState) {
    return {
        labView: state.labView,
        queryDuration: state.labQueryDuration,
        queryResult: state.labQueryResult,
        queryStart: state.labQueryStart,
    };
}

function mapDispatchToSQLLabProps(dispatch: Store.Dispatch) {
    return {
        navigateLab: (tabID: number) => { dispatch(Store.navigateLab(tabID)); }
    };
}

export default withAppContext(connect(mapStateToSQLLabProps, mapDispatchToSQLLabProps)(SQLLab));

