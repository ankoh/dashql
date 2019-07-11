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
            <div className="explorer">
                <div className="explorer-viewer">
                    <div className="explorer-viewer-output-container">
                        <div className="explorer-viewer-output">
                        </div>
                    </div>
                    <div className="explorer-viewer-controls">
                        <div className="explorer-viewer-viztypes">
                            <div className="explorer-viewer-viztype-container">
                                <div className="explorer-viewer-viztype">
                                    <PlanIcon fill="rgb(0, 0, 0)" />
                                </div>
                            </div>
                            <div className="explorer-viewer-viztype-container">
                                <div className="explorer-viewer-viztype  explorer-viewer-viztype-active">
                                    <TableChartIcon fill="rgb(255, 255, 255)" />
                                </div>
                            </div>
                            <div className="explorer-viewer-viztype-container">
                                <div className="explorer-viewer-viztype">
                                    <LineChartIcon fill="rgb(0, 0, 0)" />
                                </div>
                            </div>
                            <div className="explorer-viewer-viztype-container">
                                <div className="explorer-viewer-viztype">
                                    <BarChartIcon fill="rgb(0, 0, 0)" />
                                </div>
                            </div>
                            <div className="explorer-viewer-viztype-container">
                                <div className="explorer-viewer-viztype">
                                    <BubbleChartIcon fill="rgb(0, 0, 0)" />
                                </div>
                            </div>
                            <div className="explorer-viewer-viztype-container">
                                <div className="explorer-viewer-viztype">
                                    <PieChartIcon fill="rgb(0, 0, 0)" />
                                </div>
                            </div>
                        </div>

                        <div className="explorer-viewer-Settings-container">
                            <div className="explorer-viewer-Settings">
                                <SettingsIcon fill="rgb(0, 0, 0)" />
                            </div>
                        </div>

                        <div className="explorer-viewer-actions">
                            <div className="explorer-viewer-action-container">
                                <div className="explorer-viewer-action">
                                    <UndoIcon fill="rgb(255, 255, 255)" />
                                </div>
                            </div>
                            <div className="explorer-viewer-action-container">
                                <div className="explorer-viewer-action">
                                    <SaveIcon fill="rgb(255, 255, 255)" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="explorer-input">
                    <div className="explorer-input-tabBar">
                        <div className="explorer-input-tab-container">
                            <div className="explorer-input-tab explorer-input-tab-active">
                                <ConsoleIcon />
                            </div>
                        </div>
                        <div className="explorer-input-tab-container">
                            <div className="explorer-input-tab">
                                <ProgramIcon fill="rgb(0, 0, 0)" />
                            </div>
                        </div>
                        <div className="explorer-input-tab-container">
                            <div className="explorer-input-tab">
                                <DNSIcon fill="rgb(0, 0, 0)" />
                            </div>
                        </div>
                    </div>

                    <div className="explorer-input-terminal">
                        <Terminal />
                    </div>
                    <div className="explorer-input-beans">
                        <div className="explorer-input-beans-action">
                        </div>
                        <div className="explorer-input-beans-status">
                            <div className="explorer-input-bean-container">
                                <div className="explorer-input-bean">
                                </div>
                            </div>
                            <div className="explorer-input-bean-container">
                                <div className="explorer-input-bean">
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

