import * as Immutable from 'immutable';
import * as React from 'react';
import * as Model from '../../model';
import * as proto from 'tigon-proto';
import { TQLInterpreter } from '../../ctrl';
import { IAppContext, withAppContext } from '../../app_context';
import Terminal from './terminal';
import Board from './board';
import VizRenderer from './viz_renderer';
import s from './explorer.module.scss';
import {
    AddIcon,
    ArcChartIcon,
    AspectRatioIcon,
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
    RulerIcon,
    ScatterChartIcon,
    TableChartIcon,
    TaskListIcon,
    TextCardIcon,
    VariableBoxIcon,
} from '../../svg/icons';
import cN from 'classnames';
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
}

function Section(props: { title: string, count: number, children?: React.ReactNodeArray }) {
    return (
        <div className={s.outline_section}>
            <div className={cN(s.outline_section_header, {
                [s.with_children]: props.children && props.children.length > 0
            })} />
            <div className={s.outline_section_title}>
                {props.title}
            </div>
            <div className={s.outline_section_badge}>
                {props.count}
            </div>
            <div className={s.outline_section_entries}>
                {props.children}
            </div>
        </div>
    );
}

function SectionEntry(props: { name: string, description: string }) {
    return (
        <div className={s.outline_section_entry}>
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
    let viz = TQLInterpreter.mapStatementsInModuleList(props.modules, new proto.tql.TQLVizStatement(), (i, s) => 
        <SectionEntry key={i} name={s.vizName() || "-"} description={""} />
    );
    return (
        <div className={s.outline}>
            <div className={s.outline_header}>
                TQL Program
            </div>
            <Section title="Parameters" count={param.length}>{param}</Section>
            <Section title="Load Statements" count={load.length}>{load}</Section>
            <Section title="Extract Statements" count={extract.length}>{extract}</Section>
            <Section title="Query Statements" count={query.length}>{query}</Section>
            <Section title="Vizualizations" count={viz.length}>{viz}</Section>
        </div>
    );
}

class Explorer extends React.Component<IExplorerProps> {

    public render() {
        return (
            <div className={s.explorer}>
                <div className={s.topbar}>
                    <div className={s.topbar_actionset}>
                        <div className={s.topbar_action}>
                            <AddIcon className={s.topbar_icon} width={TOPBAR_ICON_WIDTH} height={TOPBAR_ICON_HEIGHT} />
                        </div>
                        <div className={s.topbar_action}>
                            <RefreshIcon className={s.topbar_icon} width={TOPBAR_ICON_WIDTH} height={TOPBAR_ICON_HEIGHT} />
                        </div>
                    </div>
                    <div className={s.topbar_actionset}>
                        <div className={s.topbar_action}>
                            <RulerIcon className={s.topbar_icon} width={TOPBAR_ICON_WIDTH} height={TOPBAR_ICON_HEIGHT} />
                        </div>
                        <div className={s.topbar_action}>
                            <AspectRatioIcon className={s.topbar_icon} width={TOPBAR_ICON_WIDTH} height={TOPBAR_ICON_HEIGHT} />
                        </div>
                    </div>
                    <div className={s.topbar_actionset}>
                        <div className={s.topbar_action}>
                            <DatabaseIcon className={s.topbar_icon} width={TOPBAR_ICON_WIDTH} height={TOPBAR_ICON_HEIGHT} />
                        </div>
                        <div className={s.topbar_action}>
                            <TaskListIcon className={s.topbar_icon} width={TOPBAR_ICON_WIDTH} height={TOPBAR_ICON_HEIGHT} />
                        </div>
                        <div className={s.topbar_action}>
                            <LogIcon className={s.topbar_icon} width={TOPBAR_ICON_WIDTH} height={TOPBAR_ICON_HEIGHT} />
                        </div>
                    </div>
                    <div className={s.topbar_actionset}>
                        <div className={s.topbar_action}>
                            <DocumentDownloadIcon className={s.topbar_icon} width={TOPBAR_ICON_WIDTH} height={TOPBAR_ICON_HEIGHT} />

                        </div>
                        <div className={s.topbar_action}>
                            <CloudUploadIcon className={s.topbar_icon} width={TOPBAR_ICON_WIDTH} height={TOPBAR_ICON_HEIGHT} />

                        </div>
                    </div>
                    <div className={s.topbar_actionset}>
                        <div className={s.topbar_action}>
                            <GitHubFaceIcon className={s.topbar_icon} width={TOPBAR_ICON_WIDTH} height={TOPBAR_ICON_HEIGHT} />

                        </div>
                    </div>
                </div>

                <Outline modules={this.props.tqlModules} />

                <div className={s.toolbar}>
                    <div className={s.toolbar_tool}>
                        <VariableBoxIcon className={s.toolbar_icon} width={TOOL_ICON_WIDTH} height={TOOL_ICON_HEIGHT} />
                    </div>
                    <div className={s.toolbar_tool}>
                        <FileDocumentBoxPlusIcon className={s.toolbar_icon} width={TOOL_ICON_WIDTH} height={TOOL_ICON_HEIGHT} />
                    </div>
                    <div className={s.toolbar_tool}>
                        <DatabaseImportIcon className={s.toolbar_icon} width={TOOL_ICON_WIDTH} height={TOOL_ICON_HEIGHT} />
                    </div>
                    <div className={s.toolbar_tool}>
                        <DatabaseSearchIcon className={s.toolbar_icon} width={TOOL_ICON_WIDTH} height={TOOL_ICON_HEIGHT} />
                    </div>
                </div>

                <div className={s.board}>
                    <Board scaleFactor={1.0}>
                        <VizRenderer />
                    </Board>
                    <div className={s.input}>
                        <div className={s.input_header}>
                            <div className={s.input_type}>
                                <ConsoleIcon className={s.input_icon} width={INPUT_HEADER_ICON_WIDTH} height={INPUT_HEADER_ICON_HEIGHT} />
                            </div>
                        </div>
                        <div className={s.input_terminal}>
                            <Terminal />
                        </div>
                    </div>
                    <div className={cN(s.input_toggle, s.expanded)}>
                        <div className={cN(s.input_toggle_type, s.border_right)}>
                            <ConsoleIcon className={s.input_toggle_icon} width={INPUT_TOGGLE_ICON_WIDTH} height={INPUT_TOGGLE_ICON_HEIGHT} />
                        </div>
                        <div className={s.input_toggle_type}>
                            <CodeIcon className={s.input_toggle_icon} width={INPUT_TOGGLE_ICON_WIDTH} height={INPUT_TOGGLE_ICON_HEIGHT} />
                        </div>
                    </div>
                </div>

                <div className={s.viztypes}>
                    <div className={s.viztypes_viztype}>
                        <PlanIcon className={s.viztypes_icon} width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                    </div>
                    <div className={s.viztypes_viztype}>
                        <TextCardIcon className={s.viztypes_icon} width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                    </div>
                    <div className={s.viztypes_viztype}>
                        <TableChartIcon className={s.viztypes_icon} width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                    </div>
                    <div className={s.viztypes_vega}>
                        <div className={s.viztypes_viztype}>
                            <LineChartIcon className={s.viztypes_icon} width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                        </div>
                        <div className={s.viztypes_viztype}>
                            <BarChartIcon className={s.viztypes_icon} width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                        </div>
                        <div className={s.viztypes_viztype}>
                            <ScatterChartIcon className={s.viztypes_icon} width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                        </div>
                        <div className={s.viztypes_viztype}>
                            <ArcChartIcon className={s.viztypes_icon} width={VIZTYPE_ICON_WIDTH} height={VIZTYPE_ICON_HEIGHT} />
                        </div>
                    </div>
                </div>

                <div className={s.properties}>
                    <div className={s.properties_header}>
                        Properties
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

