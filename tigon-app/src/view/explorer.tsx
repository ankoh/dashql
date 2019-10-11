import * as React from 'react';
import * as Model from '../model';
import { IAppContext, withAppContext } from '../app_context';
import Table from './viz/table';
import PlanViewer from './viz/plan_viewer';
import Terminal from './terminal';
import './explorer.scss';
import {
    BarChartIcon,
    BubbleChartIcon,
    ConsoleIcon,
    LineChartIcon,
    PieChartIcon,
    PlanIcon,
    ProgramIcon,
    SaveIcon,
    SettingsIcon,
    TableChartIcon,
} from '../svg/icons';
import { connect } from 'react-redux';

interface IExplorerProps {
    appContext: IAppContext;
    dataSource: Model.DataSource | null;
    plan: Model.QueryPlan | null;

    setExplorerDataSource: (d: Model.DataSource) => void;
    setExplorerPlan: (d: Model.QueryPlan) => void;
}

class Explorer extends React.Component<IExplorerProps> {
    public renderOutput() {
        return (
            <div className="explorer-viewer-output-container">
                {
                    false &&
                    <div className="explorer-viewer-output">
                        <Table data={this.props.dataSource || new Model.DataSource()} />
                    </div>   
                }
                {
                    this.props.plan &&
                    <div className="explorer-viewer-output">
                        <PlanViewer plan={this.props.plan} />
                    </div>
                }
            </div>
        );
    }

    public render() {
        return (
            <div className="explorer">
                <div className="explorer-viewer">
                    {this.renderOutput()}
                    <div className="explorer-viewer-controls">
                        <div className="explorer-viewer-viztypes">
                            <div className="explorer-viewer-viztype-container">
                                <div className="explorer-viewer-viztype">
                                    <PlanIcon width="20px" height="20px" fill="rgb(0, 0, 0)" />
                                </div>
                            </div>
                            <div className="explorer-viewer-viztype-container">
                                <div className="explorer-viewer-viztype active">
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
                                    <SaveIcon width="20px" height="20px" fill="rgb(255, 255, 255)" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="explorer-input">
                    <div className="explorer-input-tabbar">
                        <div className="explorer-input-tab-container">
                            <div className="explorer-input-tab active">
                                <ConsoleIcon width="20px" height="20px" />
                            </div>
                        </div>
                        <div className="explorer-input-tab-container">
                            <div className="explorer-input-tab">
                                <ProgramIcon width="20px" height="20px" fill="rgb(0, 0, 0)" />
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

            // let result = await ctrl.core.runQuery(session, text);
            // let d = new Model.QueryResultDataSource(result);
            // self.props.setExplorerDataSource(d);

            let plan = await ctrl.core.planQuery(session, text);
            let p = new Model.QueryPlan(plan);
            self.props.setExplorerPlan(p);
        })
        .catch(function(text: string) {
            ctrl.terminal.printLine("exception: " + text);
        });

    }
}

function mapStateToExplorerProps(state: Model.RootState) {
    return {
        dataSource: state.explorerDataSource,
        plan: state.explorerPlan,
    };
}

function mapDispatchToExplorerProps(dispatch: Model.Dispatch) {
    return {
        setExplorerDataSource: (d: Model.DataSource) => { dispatch(Model.setExplorerDataSource(d)); },
        setExplorerPlan: (p: Model.QueryPlan) => { dispatch(Model.setExplorerPlan(p)); },
    };
}

export default withAppContext(connect(mapStateToExplorerProps, mapDispatchToExplorerProps)(Explorer));

