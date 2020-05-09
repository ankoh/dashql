import * as Immutable from 'immutable';
import * as React from 'react';
import * as Store from '../../store';
import * as proto from 'tigon-proto';
import Board from './board';
import Terminal from './terminal';
import cN from 'classnames';
import styles from './explorer.module.scss';
import { IAppContext, withAppContext } from '../../app_context';
import { connect } from 'react-redux';
import { mapStatements } from '../../proto/tql_access';

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

const VIZTYPE_ICON_WIDTH = '20px';
const VIZTYPE_ICON_HEIGHT = '20px';
const TOOL_ICON_WIDTH = '20px';
const TOOL_ICON_HEIGHT = '20px';
const TOPBAR_ICON_WIDTH = '20px';
const TOPBAR_ICON_HEIGHT = '20px';
const INPUT_HEADER_ICON_WIDTH = '16px';
const INPUT_HEADER_ICON_HEIGHT = '16px';
const INPUT_TOGGLE_ICON_WIDTH = '20px';
const INPUT_TOGGLE_ICON_HEIGHT = '20px';

interface IExplorerProps {
    appContext: IAppContext;
    tqlStatements: Immutable.List<proto.tql.Statement>;
}

function Section(props: { title: string; children?: React.ReactNodeArray }) {
    return (
        <div className={styles.outline_section}>
            <div
                className={cN(styles.outline_section_header, {
                    [styles.with_children]:
                        props.children && props.children.length > 0,
                })}
            />
            <div className={styles.outline_section_title}>{props.title}</div>
            <div className={styles.outline_section_badge}>
                {props.children ? props.children.length : 0}
            </div>
            <div className={styles.outline_section_entries}>
                {props.children}
            </div>
        </div>
    );
}

function SectionEntry(props: { name: string; description: string }) {
    return <div className={styles.outline_section_entry}>{props.name}</div>;
}

function Outline(props: { statements: Immutable.List<proto.tql.Statement> }) {
    return (
        <div className={styles.outline}>
            <div className={styles.outline_header}>TQL Program</div>
            <Section title="Parameters">
                {mapStatements(
                    props.statements,
                    proto.tql.Statement.StatementCase.PARAMETER,
                    (i, s: proto.tql.ParameterDeclaration) => (
                        <SectionEntry
                            key={i}
                            name={s.getParameterId() || '-'}
                            description={''}
                        />
                    ),
                )}
            </Section>
            <Section title="Load Statements">
                {mapStatements(
                    props.statements,
                    proto.tql.Statement.StatementCase.LOAD,
                    (i, s: proto.tql.LoadStatement) => (
                        <SectionEntry
                            key={i}
                            name={s.getDataId() || '-'}
                            description={''}
                        />
                    ),
                )}
            </Section>
            <Section title="Extract Statements">
                {mapStatements(
                    props.statements,
                    proto.tql.Statement.StatementCase.EXTRACT,
                    (i, s: proto.tql.ExtractStatement) => (
                        <SectionEntry
                            key={i}
                            name={s.getExtractId() || '-'}
                            description={''}
                        />
                    ),
                )}
            </Section>
            <Section title="Query Statements">
                {mapStatements(
                    props.statements,
                    proto.tql.Statement.StatementCase.QUERY,
                    (i, s: proto.tql.QueryStatement) => (
                        <SectionEntry
                            key={i}
                            name={s.getQueryId() || '-'}
                            description={''}
                        />
                    ),
                )}
            </Section>
            <Section title="Vizualizations">
                {mapStatements(
                    props.statements,
                    proto.tql.Statement.StatementCase.VIZ,
                    (i, s: proto.tql.VizStatement) => (
                        <SectionEntry
                            key={i}
                            name={s.getVizId() || '-'}
                            description={''}
                        />
                    ),
                )}
            </Section>
        </div>
    );
}

class Explorer extends React.Component<IExplorerProps> {
    public render() {
        return (
            <div className={styles.explorer}>
                <div className={styles.board}>
                    <Board scaleFactor={1.0} />
                    <div className={styles.input}>
                        <div className={styles.input_header}>
                            <div className={styles.input_type}>
                                <ConsoleIcon
                                    className={styles.input_icon}
                                    width={INPUT_HEADER_ICON_WIDTH}
                                    height={INPUT_HEADER_ICON_HEIGHT}
                                />
                            </div>
                        </div>
                        <div className={styles.input_terminal}>
                            <Terminal />
                        </div>
                    </div>
                    <div className={cN(styles.input_toggle, styles.expanded)}>
                        <div
                            className={cN(
                                styles.input_toggle_type,
                                styles.border_right,
                            )}
                        >
                            <ConsoleIcon
                                className={styles.input_toggle_icon}
                                width={INPUT_TOGGLE_ICON_WIDTH}
                                height={INPUT_TOGGLE_ICON_HEIGHT}
                            />
                        </div>
                        <div className={styles.input_toggle_type}>
                            <CodeIcon
                                className={styles.input_toggle_icon}
                                width={INPUT_TOGGLE_ICON_WIDTH}
                                height={INPUT_TOGGLE_ICON_HEIGHT}
                            />
                        </div>
                    </div>
                </div>

                <div className={styles.topbar}>
                    <div className={styles.topbar_actionset}>
                        <div className={styles.topbar_action}>
                            <AddIcon
                                className={styles.topbar_icon}
                                width={TOPBAR_ICON_WIDTH}
                                height={TOPBAR_ICON_HEIGHT}
                            />
                        </div>
                        <div className={styles.topbar_action}>
                            <RefreshIcon
                                className={styles.topbar_icon}
                                width={TOPBAR_ICON_WIDTH}
                                height={TOPBAR_ICON_HEIGHT}
                            />
                        </div>
                    </div>
                    <div className={styles.topbar_actionset}>
                        <div className={styles.topbar_action}>
                            <RulerIcon
                                className={styles.topbar_icon}
                                width={TOPBAR_ICON_WIDTH}
                                height={TOPBAR_ICON_HEIGHT}
                            />
                        </div>
                        <div className={styles.topbar_action}>
                            <AspectRatioIcon
                                className={styles.topbar_icon}
                                width={TOPBAR_ICON_WIDTH}
                                height={TOPBAR_ICON_HEIGHT}
                            />
                        </div>
                    </div>
                    <div className={styles.topbar_actionset}>
                        <div className={styles.topbar_action}>
                            <DatabaseIcon
                                className={styles.topbar_icon}
                                width={TOPBAR_ICON_WIDTH}
                                height={TOPBAR_ICON_HEIGHT}
                            />
                        </div>
                        <div className={styles.topbar_action}>
                            <TaskListIcon
                                className={styles.topbar_icon}
                                width={TOPBAR_ICON_WIDTH}
                                height={TOPBAR_ICON_HEIGHT}
                            />
                        </div>
                        <div className={styles.topbar_action}>
                            <LogIcon
                                className={styles.topbar_icon}
                                width={TOPBAR_ICON_WIDTH}
                                height={TOPBAR_ICON_HEIGHT}
                            />
                        </div>
                    </div>
                    <div className={styles.topbar_actionset}>
                        <div className={styles.topbar_action}>
                            <DocumentDownloadIcon
                                className={styles.topbar_icon}
                                width={TOPBAR_ICON_WIDTH}
                                height={TOPBAR_ICON_HEIGHT}
                            />
                        </div>
                        <div className={styles.topbar_action}>
                            <CloudUploadIcon
                                className={styles.topbar_icon}
                                width={TOPBAR_ICON_WIDTH}
                                height={TOPBAR_ICON_HEIGHT}
                            />
                        </div>
                    </div>
                    <div className={styles.topbar_actionset}>
                        <div className={styles.topbar_action}>
                            <GitHubFaceIcon
                                className={styles.topbar_icon}
                                width={TOPBAR_ICON_WIDTH}
                                height={TOPBAR_ICON_HEIGHT}
                            />
                        </div>
                    </div>
                </div>

                <Outline statements={this.props.tqlStatements} />

                <div className={styles.toolbar}>
                    <div className={styles.toolbar_tool}>
                        <VariableBoxIcon
                            className={styles.toolbar_icon}
                            width={TOOL_ICON_WIDTH}
                            height={TOOL_ICON_HEIGHT}
                        />
                    </div>
                    <div className={styles.toolbar_tool}>
                        <FileDocumentBoxPlusIcon
                            className={styles.toolbar_icon}
                            width={TOOL_ICON_WIDTH}
                            height={TOOL_ICON_HEIGHT}
                        />
                    </div>
                    <div className={styles.toolbar_tool}>
                        <DatabaseImportIcon
                            className={styles.toolbar_icon}
                            width={TOOL_ICON_WIDTH}
                            height={TOOL_ICON_HEIGHT}
                        />
                    </div>
                    <div className={styles.toolbar_tool}>
                        <DatabaseSearchIcon
                            className={styles.toolbar_icon}
                            width={TOOL_ICON_WIDTH}
                            height={TOOL_ICON_HEIGHT}
                        />
                    </div>
                </div>

                <div className={styles.viztypes}>
                    <div className={styles.viztypes_viztype}>
                        <PlanIcon
                            className={styles.viztypes_icon}
                            width={VIZTYPE_ICON_WIDTH}
                            height={VIZTYPE_ICON_HEIGHT}
                        />
                    </div>
                    <div className={styles.viztypes_viztype}>
                        <TextCardIcon
                            className={styles.viztypes_icon}
                            width={VIZTYPE_ICON_WIDTH}
                            height={VIZTYPE_ICON_HEIGHT}
                        />
                    </div>
                    <div className={styles.viztypes_viztype}>
                        <TableChartIcon
                            className={styles.viztypes_icon}
                            width={VIZTYPE_ICON_WIDTH}
                            height={VIZTYPE_ICON_HEIGHT}
                        />
                    </div>
                    <div className={styles.viztypes_vega}>
                        <div className={styles.viztypes_viztype}>
                            <LineChartIcon
                                className={styles.viztypes_icon}
                                width={VIZTYPE_ICON_WIDTH}
                                height={VIZTYPE_ICON_HEIGHT}
                            />
                        </div>
                        <div className={styles.viztypes_viztype}>
                            <BarChartIcon
                                className={styles.viztypes_icon}
                                width={VIZTYPE_ICON_WIDTH}
                                height={VIZTYPE_ICON_HEIGHT}
                            />
                        </div>
                        <div className={styles.viztypes_viztype}>
                            <ScatterChartIcon
                                className={styles.viztypes_icon}
                                width={VIZTYPE_ICON_WIDTH}
                                height={VIZTYPE_ICON_HEIGHT}
                            />
                        </div>
                        <div className={styles.viztypes_viztype}>
                            <ArcChartIcon
                                className={styles.viztypes_icon}
                                width={VIZTYPE_ICON_WIDTH}
                                height={VIZTYPE_ICON_HEIGHT}
                            />
                        </div>
                    </div>
                </div>

                <div className={styles.properties}>
                    <div className={styles.properties_header}>Properties</div>
                </div>
            </div>
        );
    }

    protected async evalTermInput(text: string) {
        text = text.replace('run', '');

        // let result = await controller.core.runQuery(session, text);
        // let d = new Store.QueryResultDataSource(result);
        // self.props.setExplorerDataSource(d);

        //        let plan = await controller.core.planQuery(session, text);
        //        let p = new Store.QueryPlan(plan);
        //        this.props.setExplorerPlan(p);
    }

    protected async runTermEvalLoop(text: string | null = null) {
        let controller = this.props.appContext.controller;

        // Handle terminal input
        if (text != null) {
            await this.evalTermInput(text);
        }

        // Schedule next read
        controller.terminal
            .read('> ', '   ')
            .then(this.runTermEvalLoop.bind(this))
            .catch(function (text: string) {
                controller.terminal.printLine('exception: ' + text);
            });
    }

    // Component did mount to the dom
    public componentDidMount() {
        this.runTermEvalLoop();
    }
}

function mapStateToExplorerProps(state: Store.RootState) {
    return {
        tqlStatements: state.tqlStatements,
        queryResults: state.tqlQueryResults,
        queryPlans: state.tqlQueryPlans,
    };
}

function mapDispatchToExplorerProps(_dispatch: Store.Dispatch) {
    return {};
}

export default withAppContext(
    connect(mapStateToExplorerProps, mapDispatchToExplorerProps)(Explorer),
);
