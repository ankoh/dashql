import * as React from 'react';
import * as Model from '../model';
import { IAppContext, withAppContext } from '../app_context';
import Terminal from './terminal';
import './explorer.css';
import {
    BarChartIcon,
    BubbleChartIcon,
    ConsoleIcon,
    DNSIcon,
    LineChartIcon,
    PieChartIcon,
    PlanIcon,
    ProgramIcon,
    SaveIcon,
    SettingsIcon,
    TableChartIcon,
    UndoIcon,
} from '../svg/icons';
import { connect } from 'react-redux';

interface IExplorerProps {
    appContext: IAppContext;
}

class Explorer extends React.Component<IExplorerProps> {
    public render() {
        return (
            <div className="Explorer">
                <div className="Explorer-Viewer">
                    <div className="Explorer-Viewer-Output-Container">
                        <div className="Explorer-Viewer-Output">
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

                        <div className="Explorer-Viewer-Settings-Container">
                            <div className="Explorer-Viewer-Settings">
                                <SettingsIcon fill="rgb(0, 0, 0)" />
                            </div>
                        </div>

                        <div className="Explorer-Viewer-Actions">
                            <div className="Explorer-Viewer-Action-Container">
                                <div className="Explorer-Viewer-Action">
                                    <UndoIcon fill="rgb(255, 255, 255)" />
                                </div>
                            </div>
                            <div className="Explorer-Viewer-Action-Container">
                                <div className="Explorer-Viewer-Action">
                                    <SaveIcon fill="rgb(255, 255, 255)" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="Explorer-Input">
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
                                <DNSIcon fill="rgb(0, 0, 0)" />
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

function mapStateToExplorerProps(state: Model.RootState) {
    return {
    };
}

function mapDispatchToExplorerProps(dispatch: Model.Dispatch) {
    return {
    };
}

export default withAppContext(connect(mapStateToExplorerProps, mapDispatchToExplorerProps)(Explorer));

