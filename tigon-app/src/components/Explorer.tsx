import * as React from 'react';
import * as Store from '../store';
import { IAppContext, withAppContext } from '../AppContext';
import Terminal from './Terminal';
import './Explorer.css';
import {
    ConsoleIcon,
    ProgramIcon,
    PieChartIcon,
    TableChartIcon,
    BubbleChartIcon,
    BarChartIcon,
    LineChartIcon,
    PlanIcon,
} from '../svg/Icons';
import { connect } from 'react-redux';

interface IExplorerProps {
    appContext: IAppContext;
}

class Explorer extends React.Component<IExplorerProps> {
    public render() {
        return (
            <div className="Explorer">
                <div className="Explorer-Viewer">
                    <div className="Explorer-Viewer-Config-Container">
                        <div className="Explorer-Viewer-Config">
                        </div>
                    </div>
                    <div className="Explorer-Viewer-Controls">
                        <div className="Explorer-Viewer-VizTypes">
                            <div className="Explorer-Viewer-VizType-Container">
                                <div className="Explorer-Viewer-VizType Explorer-Viewer-VizType-Active">
                                    <PlanIcon fill="rgb(255, 255, 255)" />
                                </div>
                            </div>
                            <div className="Explorer-Viewer-VizType-Container">
                                <div className="Explorer-Viewer-VizType">
                                    <TableChartIcon fill="rgb(0, 0, 0)" />
                                </div>
                            </div>
                            <div className="Explorer-Viewer-VizType-Container">
                                <div className="Explorer-Viewer-VizType">
                                    <LineChartIcon fill="rgb(0, 0, 0)" />
                                </div>
                            </div>
                            <div className="Explorer-Viewer-VizType-Container">
                                <div className="Explorer-Viewer-VizType">
                                    <BarChartIcon fill="rgb(0, 0, 0)" />
                                </div>
                            </div>
                            <div className="Explorer-Viewer-VizType-Container">
                                <div className="Explorer-Viewer-VizType">
                                    <BubbleChartIcon fill="rgb(0, 0, 0)" />
                                </div>
                            </div>
                            <div className="Explorer-Viewer-VizType-Container">
                                <div className="Explorer-Viewer-VizType">
                                    <PieChartIcon fill="rgb(0, 0, 0)" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="Explorer-Input">
                    <div className="Explorer-Input-Header">
                    </div>
                    <div className="Explorer-Input-TabBar">
                        <div className="Explorer-Input-Tab-Container">
                            <div className="Explorer-Input-Tab Explorer-Input-Tab-Active">
                                <ConsoleIcon />
                            </div>
                        </div>
                        <div className="Explorer-Input-Tab-Container">
                            <div className="Explorer-Input-Tab">
                                <ProgramIcon fill="rgb(0, 0, 0)" />
                            </div>
                        </div>
                        <div className="Explorer-Input-Tab-Container">
                            <div className="Explorer-Input-Tab">
                                x
                            </div>
                        </div>
                        <div className="Explorer-Input-Tab-Container">
                            <div className="Explorer-Input-Tab">
                                x
                            </div>
                        </div>
                    </div>
                    <div className="Explorer-Input-Terminal">
                        <Terminal />
                    </div>
                    <div className="Explorer-Input-Beans">
                        <div className="Explorer-Input-Beans-Action">
                        </div>
                        <div className="Explorer-Input-Beans-Status">
                            <div className="Explorer-Input-Bean-Container">
                                <div className="Explorer-Input-Bean">
                                </div>
                            </div>
                            <div className="Explorer-Input-Bean-Container">
                                <div className="Explorer-Input-Bean">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

function mapStateToExplorerProps(state: Store.RootState) {
    return {
        labView: state.labView,
        queryDuration: state.labQueryDuration,
        queryResult: state.labQueryResult,
        queryStart: state.labQueryStart,
    };
}

function mapDispatchToExplorerProps(dispatch: Store.Dispatch) {
    return {
        navigateLab: (tabID: number) => { dispatch(Store.navigateLab(tabID)); }
    };
}

export default withAppContext(connect(mapStateToExplorerProps, mapDispatchToExplorerProps)(Explorer));

