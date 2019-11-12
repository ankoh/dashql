import * as Immutable from 'immutable';
import * as React from 'react';
import * as Model from '../../model';
import * as proto from 'tigon-proto';
import { TQLInterpreter } from '../../ctrl';
import { IAppContext, withAppContext } from '../../app_context';
import Terminal from './terminal';
import Board from './board';
import './explorer.scss';
import {
    BarChartIcon,
    ScatterChartIcon,
    ConsoleIcon,
    LineChartIcon,
    ArcChartIcon,
    PlanIcon,
    DatabaseSearchIcon,
    DatabaseImportIcon,
    TableChartIcon,
    FileDocumentBoxPlusIcon,
    VariableIcon,
    TextCardIcon,
    CodeIcon,
} from '../../svg/icons';
import { connect } from 'react-redux';

const VIZTYPE_ICON_WIDTH = "20px";
const VIZTYPE_ICON_HEIGHT = "20px";
const TOOL_ICON_WIDTH = "20px";
const TOOL_ICON_HEIGHT = "20px";
const INPUT_HEADER_ICON_WIDTH = "16px";
const INPUT_HEADER_ICON_HEIGHT = "16px";
const INPUT_TOGGLE_ICON_WIDTH = "20px";
const INPUT_TOGGLE_ICON_HEIGHT = "20px";

interface IExplorerProps {
    appContext: IAppContext;
    tqlModules: Immutable.List<Model.CoreBuffer<proto.tql.TQLModule>>;
    queryResults: Immutable.List<Model.CoreBuffer<proto.duckdb.QueryResult>>;
    queryPlans: Immutable.List<Model.CoreBuffer<proto.duckdb.QueryPlan>>;
}

function ExplorerOutlineSection(props: { title: string, children?: React.ReactNode }) {
    return (
        <div className="explorer_outline_section">
            <div className="explorer_outline_section_header">
                {props.title}
            </div>
            {props.children}
        </div>
    );
}

function ExplorerOutline(props: { modules: Immutable.List<Model.CoreBuffer<proto.tql.TQLModule>> }) {
    let query = new proto.tql.TQLQueryStatement();
    return (
        <div className="explorer_outline">
            <div className="explorer_outline_header">
                TQL Program
            </div>
            <ExplorerOutlineSection title="Parameter Declarations" />
            <ExplorerOutlineSection title="Load Statements" />
            <ExplorerOutlineSection title="Extract Statements" />
            <ExplorerOutlineSection title="Query Statements">
                {TQLInterpreter.mapStatementsInModuleList(props.modules, query, (i, _q) => 
                    <div key={i} className="explorer_outline_query">foo</div>
                )}
            </ExplorerOutlineSection>
            <ExplorerOutlineSection title="Display Statements" />
        </div>
    );
}

class Explorer extends React.Component<IExplorerProps> {

    public render() {
        return (
            <div className="explorer"> <div className="explorer_topbar"></div>
                <ExplorerOutline modules={this.props.tqlModules} />

                <div className="explorer_toolbar">
                    <div className="explorer_tool">
                        <VariableIcon width={TOOL_ICON_WIDTH} height={TOOL_ICON_HEIGHT} />
                    </div>
                    <div className="explorer_tool">
                        <FileDocumentBoxPlusIcon width={TOOL_ICON_WIDTH} height={TOOL_ICON_HEIGHT} />
                    </div>
                    <div className="explorer_tool">
                        <DatabaseImportIcon width={TOOL_ICON_WIDTH} height={TOOL_ICON_HEIGHT} />
                    </div>
                    <div className="explorer_tool">
                        <DatabaseSearchIcon width={TOOL_ICON_WIDTH} height={TOOL_ICON_HEIGHT} />
                    </div>
                </div>

                <div className="explorer_board">
                    <Board scaleFactor={1.0}>
                        <div className="explorer_input_toggle">
                            <div className="explorer_input_type border_right">
                                <ConsoleIcon width={INPUT_TOGGLE_ICON_WIDTH} height={INPUT_TOGGLE_ICON_HEIGHT} />
                            </div>
                            <div className="explorer_input_type">
                                <CodeIcon width={INPUT_TOGGLE_ICON_WIDTH} height={INPUT_TOGGLE_ICON_HEIGHT} />
                            </div>
                        </div>
                    </Board>
                </div>

                <div className="explorer_viztypes">
                    <div className="explorer_viztype">
                        <PlanIcon width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                    </div>
                    <div className="explorer_viztype">
                        <TextCardIcon width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                    </div>
                    <div className="explorer_viztype">
                        <TableChartIcon width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                    </div>
                    <div className="explorer_viztypes_vega">
                        <div className="explorer_viztype">
                            <LineChartIcon width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                        </div>
                        <div className="explorer_viztype">
                            <BarChartIcon width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                        </div>
                        <div className="explorer_viztype">
                            <ScatterChartIcon width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                        </div>
                        <div className="explorer_viztype">
                            <ArcChartIcon width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                        </div>
                    </div>
                </div>

                <div className="explorer_properties">
                    <div className="explorer_properties_header">
                        Visualization
                    </div>
                </div>

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

    protected async evalTermInput(text: string) {
        let ctrl = this.props.appContext.ctrl;
        let session = await ctrl.core.createSession(); // TODO

        text = text.replace("run", "");

        // let result = await ctrl.core.runQuery(session, text);
        // let d = new Model.QueryResultDataSource(result);
        // self.props.setExplorerDataSource(d);

        //        let plan = await ctrl.core.planQuery(session, text);
        //        let p = new Model.QueryPlan(plan);
        //        this.props.setExplorerPlan(p);
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
        tqlModules: state.transientTQLModules,
        queryResults: state.transientQueryResults,
        queryPlans: state.transientQueryPlans,
    };
}

function mapDispatchToExplorerProps(_dispatch: Model.Dispatch) {
    return {
    };
}

export default withAppContext(connect(mapStateToExplorerProps, mapDispatchToExplorerProps)(Explorer));

