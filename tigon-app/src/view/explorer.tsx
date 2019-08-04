import * as React from 'react';
import * as Model from '../model';
import { IAppContext, withAppContext } from '../app_context';
import Table from './viz/table';
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
    dataSource: Model.DataSource;

    setExplorerDataSource: (d: Model.DataSource) => void;
}

class Explorer extends React.Component<IExplorerProps> {
    public render() {
        return (
            <div className="explorer">
                <div className="explorer-viewer">
                    <div className="explorer-viewer-output-container">
                        <div className="explorer-viewer-output">
                            <Table data={this.props.dataSource} />
                        </div>
                    </div>
                    <div className="explorer-viewer-controls">
                        <div className="explorer-viewer-viztypes">
                            <div className="explorer-viewer-viztype-container">
                                <div className="explorer-viewer-viztype">
                                    <PlanIcon width="20px" height="20px" fill="rgb(0, 0, 0)" />
                                </div>
                            </div>
                            <div className="explorer-viewer-viztype-container">
                                <div className="explorer-viewer-viztype  explorer-viewer-viztype-active">
                                    <TableChartIcon width="20px" height="20px" fill="rgb(255, 255, 255)" />
                                </div>
                            </div>
                            <div className="explorer-viewer-viztype-container">
                                <div className="explorer-viewer-viztype">
                                    <LineChartIcon width="20px" height="20px" fill="rgb(0, 0, 0)" />
                                </div>
                            </div>
                            <div className="explorer-viewer-viztype-container">
                                <div className="explorer-viewer-viztype">
                                    <BarChartIcon width="20px" height="20px" fill="rgb(0, 0, 0)" />
                                </div>
                            </div>
                            <div className="explorer-viewer-viztype-container">
                                <div className="explorer-viewer-viztype">
                                    <BubbleChartIcon width="20px" height="20px" fill="rgb(0, 0, 0)" />
                                </div>
                            </div>
                            <div className="explorer-viewer-viztype-container">
                                <div className="explorer-viewer-viztype">
                                    <PieChartIcon width="20px" height="20px" fill="rgb(0, 0, 0)" />
                                </div>
                            </div>
                        </div>

                        <div className="explorer-viewer-Settings-container">
                            <div className="explorer-viewer-Settings">
                                <SettingsIcon width="20px" height="20px" fill="rgb(0, 0, 0)" />
                            </div>
                        </div>

                        <div className="explorer-viewer-actions">
                            <div className="explorer-viewer-action-container">
                                <div className="explorer-viewer-action">
                                    <UndoIcon width="20px" height="20px" fill="rgb(255, 255, 255)" />
                                </div>
                            </div>
                            <div className="explorer-viewer-action-container">
                                <div className="explorer-viewer-action">
                                    <SaveIcon width="20px" height="20px" fill="rgb(255, 255, 255)" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="explorer-input">
                    <div className="explorer-input-tabBar">
                        <div className="explorer-input-tab-container">
                            <div className="explorer-input-tab explorer-input-tab-active">
                                <ConsoleIcon width="20px" height="20px" />
                            </div>
                        </div>
                        <div className="explorer-input-tab-container">
                            <div className="explorer-input-tab">
                                <ProgramIcon width="20px" height="20px" fill="rgb(0, 0, 0)" />
                            </div>
                        </div>
                        <div className="explorer-input-tab-container">
                            <div className="explorer-input-tab">
                                <DNSIcon width="20px" height="20px" fill="rgb(0, 0, 0)" />
                            </div>
                        </div>
                    </div>

                    <div className="explorer-input-terminal">
                        <Terminal />
                    </div>
                </div>
            </div>
        );
    }

    // Component did mount to the dom
    public componentDidMount() {
        let ctrl = this.props.appContext.ctrl;
        let self = this;
        ctrl.terminal.read("> ", "   ",)
        .then(async function(text: string) {
                let session = await ctrl.core.createSession(); // TODO
                let result = await ctrl.core.query(session, text);
                let d = new Model.QueryResultDataSource(result);
                self.props.setExplorerDataSource(d);
            })
            .catch(function(text: string) {
                ctrl.terminal.printLine("err: " + text);
            });

    }
}

function mapStateToExplorerProps(state: Model.RootState) {
    return {
        dataSource: state.explorerDataSource,
    };
}

function mapDispatchToExplorerProps(dispatch: Model.Dispatch) {
    return {
        setExplorerDataSource: (d: Model.DataSource) => { dispatch(Model.setExplorerDataSource(d)); },
    };
}

export default withAppContext(connect(mapStateToExplorerProps, mapDispatchToExplorerProps)(Explorer));

