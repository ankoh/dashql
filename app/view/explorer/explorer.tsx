import classNames from 'classnames';
import * as React from 'react';
import { connect } from 'react-redux';
import * as proto from '@tigon/proto';
import * as Store from '../../store';
import { IAppContext, withAppContext } from '../../app_context';
import Board from './board';
import Editor from './editor';

import {
    AddIcon,
    ArcChartIcon,
    AspectRatioIcon,
    BarChartIcon,
    CloudUploadIcon,
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

import styles from './explorer.module.scss';

const VIZTYPE_ICON_WIDTH = '20px';
const VIZTYPE_ICON_HEIGHT = '20px';
const TOOL_ICON_WIDTH = '20px';
const TOOL_ICON_HEIGHT = '20px';
const TOPBAR_ICON_WIDTH = '20px';
const TOPBAR_ICON_HEIGHT = '20px';

interface IExplorerProps {
    appContext: IAppContext;
    tqlModule: proto.tql.Module;
}

function Section(props: { title: string; children?: React.ReactNodeArray }) {
    return (
        <div className={styles.outline_section}>
            <div
                className={classNames(styles.outline_section_header, {
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

function SectionEntry(props: { name?: proto.tql.String; description: string }) {
    return (
        <div className={styles.outline_section_entry}>
            {props.name?.getString() ?? '(Unnamed)'}
        </div>
    );
}

function Outline(props: { module: proto.tql.Module }) {
    const statements = props.module.getStatementsList();

    const parameters: proto.tql.ParameterDeclaration[] = [];
    const loads: proto.tql.LoadStatement[] = [];
    const extracts: proto.tql.ExtractStatement[] = [];
    const queries: proto.tql.QueryStatement[] = [];
    const visualizations: proto.tql.VizStatement[] = [];

    for (const statement of statements) {
        switch (statement.getStatementCase()) {
            case proto.tql.Statement.StatementCase.PARAMETER:
                const parameter = statement.getParameter();
                if (parameter) {
                    parameters.push(parameter);
                }
                break;
            case proto.tql.Statement.StatementCase.LOAD:
                const load = statement.getLoad();
                if (load) {
                    loads.push(load);
                }
                break;
            case proto.tql.Statement.StatementCase.EXTRACT:
                const extract = statement.getExtract();
                if (extract) {
                    extracts.push(extract);
                }
                break;
            case proto.tql.Statement.StatementCase.QUERY:
                const query = statement.getQuery();
                if (query) {
                    queries.push(query);
                }
                break;
            case proto.tql.Statement.StatementCase.VIZ:
                const viz = statement.getViz();
                if (viz) {
                    visualizations.push(viz);
                }
                break;
            default:
                break;
        }
    }

    return (
        <div className={styles.outline}>
            <div className={styles.outline_header}>TQL Program</div>
            <Section title="Parameters">
                {parameters.map(
                    (parameter: proto.tql.ParameterDeclaration, i: number) => (
                        <SectionEntry
                            key={i}
                            name={parameter.getName()}
                            description={''}
                        />
                    ),
                )}
            </Section>
            <Section title="Load Statements">
                {loads.map((load: proto.tql.LoadStatement, i: number) => (
                    <SectionEntry
                        key={i}
                        name={load.getName()}
                        description={''}
                    />
                ))}
            </Section>
            <Section title="Extract Statements">
                {extracts.map(
                    (extract: proto.tql.ExtractStatement, i: number) => (
                        <SectionEntry
                            key={i}
                            name={extract.getName()}
                            description={''}
                        />
                    ),
                )}
            </Section>
            <Section title="Query Statements">
                {queries.map((query: proto.tql.QueryStatement, i: number) => (
                    <SectionEntry
                        key={i}
                        name={query.getName()}
                        description={''}
                    />
                ))}
            </Section>
            <Section title="Vizualizations">
                {visualizations.map(
                    (viz: proto.tql.VizStatement, i: number) => (
                        <SectionEntry
                            key={i}
                            name={viz.getName()}
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
                    <div className={styles.editor}>
                        <Editor />
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
                <Outline module={this.props.tqlModule} />
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
}

function mapStateToExplorerProps(state: Store.RootState) {
    return {
        tqlModule: state.tqlModule,
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
