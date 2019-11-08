import * as React from 'react';
import * as Model from '../model';
import { IAppContext, withAppContext } from '../app_context';
import Table from './viz/table';
import PlanViewer from './viz/plan_viewer';
import Terminal from './terminal';
import Board from './board';
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

const VIZTYPE_ICON_WIDTH = "20px";
const VIZTYPE_ICON_HEIGHT = "20px";
const INPUT_HEADER_ICON_WIDTH = "16px";
const INPUT_HEADER_ICON_HEIGHT = "16px";
const INPUT_TOGGLE_ICON_WIDTH = "20px";
const INPUT_TOGGLE_ICON_HEIGHT = "20px";

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
            <div className="explorer_viewer_output_container">
                {
                    <div className="explorer_viewer_output">
                        <Table data={this.props.dataSource || new Model.DataSource()} />
                    </div>   
                }
                {
                    false &&
                    <div className="explorer_viewer_output">
                        <PlanViewer plan={this.props.plan} />
                    </div>
                }
            </div>
        );
    }

    public render() {
        return (
            <div className="explorer"> <div className="explorer_topbar"></div>
                <div className="explorer_outline"></div>
                <div className="explorer_toolbar"></div>

                <div className="explorer_board">
                    <Board scaleFactor={1.0}>
                        <div className="explorer_input_toggle">
                            <div className="explorer_input_type">
                                <ConsoleIcon width={INPUT_TOGGLE_ICON_WIDTH} height={INPUT_TOGGLE_ICON_HEIGHT} />
                            </div>
                            <div className="explorer_input_type">
                                <ProgramIcon width={INPUT_TOGGLE_ICON_WIDTH} height={INPUT_TOGGLE_ICON_HEIGHT} />
                            </div>
                        </div>
                    </Board>
                </div>

                <div className="explorer_viztypes">
                    <div className="explorer_viztype">
                        <PlanIcon width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                    </div>
                    <div className="explorer_viztype">
                        <TableChartIcon width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                    </div>
                    <div className="explorer_viztype">
                        <LineChartIcon width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                    </div>
                    <div className="explorer_viztype">
                        <BarChartIcon width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                    </div>
                    <div className="explorer_viztype">
                        <BubbleChartIcon width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                    </div>
                    <div className="explorer_viztype">
                        <PieChartIcon width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                    </div>

                </div>
                <div className="explorer_properties"></div>

                <div className="explorer_input">
                    <div className="explorer_input_header">
                        <div className="explorer_input_type">
                            <ConsoleIcon width={INPUT_HEADER_ICON_WIDTH} height={INPUT_HEADER_ICON_HEIGHT} />
                        </div>
                    </div>
                    <div className="explorer_input_terminal">
                        <Terminal />
                    </div>
                </div>
            </div>
        );
    }

    // public render() {
    //     return (
    //         <div className="explorer">
    //             <div className="explorer_viewer">
    //                 <div className="explorer_viewer_controls">
    //                     <div className="explorer_viewer_viztypes">
    //                         <div className="explorer_viewer_viztype_container">
    //                             <div className="explorer_viewer_viztype">
    //                                 <PlanIcon width="20px" height="20px" fill="rgb(0, 0, 0)" />
    //                             </div>
    //                         </div>
    //                         <div className="explorer_viewer_viztype_container">
    //                             <div className="explorer_viewer_viztype active">
    //                                 <TableChartIcon width="20px" height="20px" fill="rgb(255, 255, 255)" />
    //                             </div>
    //                         </div>
    //                         <div className="explorer_viewer_viztype_container">
    //                             <div className="explorer_viewer_viztype">
    //                                 <LineChartIcon width="20px" height="20px" fill="rgb(0, 0, 0)" />
    //                             </div>
    //                         </div>
    //                         <div className="explorer_viewer_viztype_container">
    //                             <div className="explorer_viewer_viztype">
    //                                 <BarChartIcon width="20px" height="20px" fill="rgb(0, 0, 0)" />
    //                             </div>
    //                         </div>
    //                         <div className="explorer_viewer_viztype_container">
    //                             <div className="explorer_viewer_viztype">
    //                                 <BubbleChartIcon width="20px" height="20px" fill="rgb(0, 0, 0)" />
    //                             </div>
    //                         </div>
    //                         <div className="explorer_viewer_viztype_container">
    //                             <div className="explorer_viewer_viztype">
    //                                 <PieChartIcon width="20px" height="20px" fill="rgb(0, 0, 0)" />
    //                             </div>
    //                         </div>
    //                     </div>

    //                     <div className="explorer_viewer_Settings_container">
    //                         <div className="explorer_viewer_Settings">
    //                             <SettingsIcon width="20px" height="20px" fill="rgb(0, 0, 0)" />
    //                         </div>
    //                     </div>

    //                     <div className="explorer_viewer_actions">
    //                         <div className="explorer_viewer_action_container">
    //                             <div className="explorer_viewer_action">
    //                                 <SaveIcon width="20px" height="20px" fill="rgb(255, 255, 255)" />
    //                             </div>
    //                         </div>
    //                     </div>
    //                 </div>
    //                 {this.renderOutput()}
    //             </div>
    //             <div className="explorer_input">
    //                 <div className="explorer_input_tabbar">
    //                     <div className="explorer_input_tab_container">
    //                         <div className="explorer_input_tab active">
    //                             <ConsoleIcon width="20px" height="20px" />
    //                         </div>
    //                     </div>
    //                     <div className="explorer_input_tab_container">
    //                         <div className="explorer_input_tab">
    //                             <ProgramIcon width="20px" height="20px" fill="rgb(0, 0, 0)" />
    //                         </div>
    //                     </div>
    //                 </div>

    //                 <div className="explorer_input_terminal">
    //                     <Terminal />
    //                 </div>
    //             </div>
    //         </div>
    //     );
    // }

    protected async evalTermInput(text: string) {
        let ctrl = this.props.appContext.ctrl;
        let session = await ctrl.core.createSession(); // TODO

        text = text.replace("run", "");

        // let result = await ctrl.core.runQuery(session, text);
        // let d = new Model.QueryResultDataSource(result);
        // self.props.setExplorerDataSource(d);

        let plan = await ctrl.core.planQuery(session, text);
        let p = new Model.QueryPlan(plan);
        this.props.setExplorerPlan(p);
    }

    protected async runTermEvalLoop(text: string | null = null) {
        let ctrl = this.props.appContext.ctrl;

        // Handle terminal input
        if (text != null) {
            await this.evalTermInput(text)
        }

        // Schedule next read
        ctrl.terminal.read("> ",  "   ",)
            .then(this.runTermEvalLoop.bind(this))
            .catch(function(text: string) {
                ctrl.terminal.printLine("exception: " + text);
            });       
    }

    // Component did mount to the dom
    public componentDidMount() {
        this.runTermEvalLoop();
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

