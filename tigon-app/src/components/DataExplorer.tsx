import * as React from 'react';
import * as Store from '../store';
import { IAppContext, withAppContext } from '../AppContext';
import Terminal from './Terminal';
import './DataExplorer.css';
import {
    ConsoleIcon,
    ProgramIcon
} from '../svg/Icons';
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
                    <div className="DataExplorer-Viewer-Config-Container">
                        <div className="DataExplorer-Viewer-Config">
                        </div>
                    </div>
                    <div className="DataExplorer-Viewer-Controls">
                    </div>
                </div>
                <div className="DataExplorer-Input">
                    <div className="DataExplorer-Input-Header">
                    </div>
                    <div className="DataExplorer-Input-TabBar">
                        <div className="DataExplorer-Input-Tab-Container">
                            <div className="DataExplorer-Input-Tab DataExplorer-Input-Tab-Active">
                                <ConsoleIcon />
                            </div>
                        </div>
                        <div className="DataExplorer-Input-Tab-Container">
                            <div className="DataExplorer-Input-Tab">
                                <ProgramIcon fill="rgb(0, 0, 0)" />
                            </div>
                        </div>
                    </div>
                    <div className="DataExplorer-Input-Terminal">
                        <Terminal />
                    </div>
                    <div className="DataExplorer-Input-Beans">
                        <div className="DataExplorer-Input-Beans-Action">
                        </div>
                        <div className="DataExplorer-Input-Beans-Status">
                            <div className="DataExplorer-Input-Bean-Container">
                                <div className="DataExplorer-Input-Bean">
                                </div>
                            </div>
                            <div className="DataExplorer-Input-Bean-Container">
                                <div className="DataExplorer-Input-Bean">
                                </div>
                            </div>
                        </div>
                    </div>
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

