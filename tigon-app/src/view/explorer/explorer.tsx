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
    AddIcon,
    ArcChartIcon,
    BarChartIcon,
    CloudUploadIcon,
    CodeIcon,
    ConsoleIcon,
    DatabaseIcon,
    DatabaseImportIcon,
    DatabaseSearchIcon,
    DocumentDownloadIcon,
    FileDocumentBoxPlusIcon,
    GitHubFaceIcon,
    LineChartIcon,
    LogIcon,
    PlanIcon,
    RefreshIcon,
    ResponsiveIcon,
    RulerIcon,
    ScatterChartIcon,
    TableChartIcon,
    TaskListIcon,
    TextCardIcon,
    VariableBoxIcon,
} from '../../svg/icons';
import classNames from 'classnames';
import { connect } from 'react-redux';

const VIZTYPE_ICON_WIDTH = "20px";
const VIZTYPE_ICON_HEIGHT = "20px";
const TOOL_ICON_WIDTH = "20px";
const TOOL_ICON_HEIGHT = "20px";
const TOPBAR_ICON_WIDTH = "20px";
const TOPBAR_ICON_HEIGHT = "20px";
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

function Section(props: { title: string, count: number, children?: React.ReactNodeArray }) {
    return (
        <div className="section">
            <div className={classNames("header", {
                "with_children": props.children && props.children.length > 0
            })} />
            <div className="title">
                {props.title}
            </div>
            <div className="badge">
                {props.count}
            </div>
            <div className="entries">
                {props.children}
            </div>
        </div>
    );
}

function SectionEntry(props: { name: string, description: string }) {
    return (
        <div className="entry">
            {props.name}
        </div>       
    );
}

function Outline(props: { modules: Immutable.List<Model.CoreBuffer<proto.tql.TQLModule>> }) {
    let query = TQLInterpreter.mapStatementsInModuleList(props.modules, new proto.tql.TQLQueryStatement(), (i, s) => 
        <SectionEntry key={i} name={s.queryName() || "-"} description={""} />
    );
    let param = TQLInterpreter.mapStatementsInModuleList(props.modules, new proto.tql.TQLParameterDeclaration(), (i, s) => 
        <SectionEntry key={i} name={s.parameterName() || "-"} description={""} />
    );
    let extract = TQLInterpreter.mapStatementsInModuleList(props.modules, new proto.tql.TQLExtractStatement(), (i, s) => 
        <SectionEntry key={i} name={s.extractName() || "-"} description={""} />
    );
    let load = TQLInterpreter.mapStatementsInModuleList(props.modules, new proto.tql.TQLLoadStatement(), (i, s) => 
        <SectionEntry key={i} name={s.dataName() || "-"} description={""} />
    );
    return (
        <div className="explorer_outline">
            <div className="header">
                TQL Program
            </div>
            <Section title="Parameters" count={param.length}>{param}</Section>
            <Section title="Load Statements" count={load.length}>{load}</Section>
            <Section title="Extract Statements" count={extract.length}>{extract}</Section>
            <Section title="Query Statements" count={query.length}>{query}</Section>
            <Section title="Display Statements" count={0} />
        </div>
    );
}

class Explorer extends React.Component<IExplorerProps> {

    public render() {
        return (
            <div className="explorer">
                <div className="explorer_topbar">
                    <div className="actionset">
                        <div className="action">
                            <AddIcon width={TOPBAR_ICON_WIDTH} height={TOPBAR_ICON_HEIGHT} />
                        </div>
                        <div className="action">
                            <RefreshIcon width={TOPBAR_ICON_WIDTH} height={TOPBAR_ICON_HEIGHT} />
                        </div>
                    </div>
                    <div className="actionset">
                        <div className="action">
                            <RulerIcon width={TOPBAR_ICON_WIDTH} height={TOPBAR_ICON_HEIGHT} />
                        </div>
                        <div className="action">
                            <ResponsiveIcon width={TOPBAR_ICON_WIDTH} height={TOPBAR_ICON_HEIGHT} />
                        </div>
                    </div>
                    <div className="actionset">
                        <div className="action">
                            <DatabaseIcon width={TOPBAR_ICON_WIDTH} height={TOPBAR_ICON_HEIGHT} />
                        </div>
                        <div className="action">
                            <TaskListIcon width={TOPBAR_ICON_WIDTH} height={TOPBAR_ICON_HEIGHT} />
                        </div>
                        <div className="action">
                            <LogIcon width={TOPBAR_ICON_WIDTH} height={TOPBAR_ICON_HEIGHT} />
                        </div>
                    </div>
                    <div className="actionset">
                        <div className="action">
                            <DocumentDownloadIcon width={TOPBAR_ICON_WIDTH} height={TOPBAR_ICON_HEIGHT} />

                        </div>
                        <div className="action">
                            <CloudUploadIcon width={TOPBAR_ICON_WIDTH} height={TOPBAR_ICON_HEIGHT} />

                        </div>
                    </div>
                    <div className="actionset">
                        <div className="action">
                            <GitHubFaceIcon width={TOPBAR_ICON_WIDTH} height={TOPBAR_ICON_HEIGHT} />

                        </div>
                    </div>
                </div>

                <Outline modules={this.props.tqlModules} />

                <div className="explorer_toolbar">
                    <div className="tool">
                        <VariableBoxIcon width={TOOL_ICON_WIDTH} height={TOOL_ICON_HEIGHT} />
                    </div>
                    <div className="tool">
                        <FileDocumentBoxPlusIcon width={TOOL_ICON_WIDTH} height={TOOL_ICON_HEIGHT} />
                    </div>
                    <div className="tool">
                        <DatabaseImportIcon width={TOOL_ICON_WIDTH} height={TOOL_ICON_HEIGHT} />
                    </div>
                    <div className="tool">
                        <DatabaseSearchIcon width={TOOL_ICON_WIDTH} height={TOOL_ICON_HEIGHT} />
                    </div>
                </div>

                <div className="explorer_board">
                    <Board scaleFactor={1.0}>
                    </Board>
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
                    <div className="explorer_input_toggle expanded">
                        <div className="explorer_input_type border_right active">
                            <ConsoleIcon width={INPUT_TOGGLE_ICON_WIDTH} height={INPUT_TOGGLE_ICON_HEIGHT} />
                        </div>
                        <div className="explorer_input_type">
                            <CodeIcon width={INPUT_TOGGLE_ICON_WIDTH} height={INPUT_TOGGLE_ICON_HEIGHT} />
                        </div>
                    </div>
                </div>

                <div className="explorer_viztypes">
                    <div className="viztype">
                        <PlanIcon width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                    </div>
                    <div className="viztype">
                        <TextCardIcon width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                    </div>
                    <div className="viztype">
                        <TableChartIcon width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                    </div>
                    <div className="viztypes_vega">
                        <div className="viztype">
                            <LineChartIcon width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                        </div>
                        <div className="viztype">
                            <BarChartIcon width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                        </div>
                        <div className="viztype">
                            <ScatterChartIcon width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                        </div>
                        <div className="viztype">
                            <ArcChartIcon width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                        </div>
                    </div>
                </div>

                <div className="explorer_properties">
                    <div className="header">
                        Visualization
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

