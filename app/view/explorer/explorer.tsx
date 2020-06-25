import * as React from 'react';
import { connect } from 'react-redux';
import * as proto from '@tigon/proto';
import * as Store from '../../store';
import { IAppContext, withAppContext } from '../../app_context';
import Board from './board';
import Editor from './editor';
import Section from './section';
import SectionEntry from './section_entry';

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

function getSectionIndex(previous?: number, current?: number) {
    if (previous !== undefined && current !== undefined) {
        return Math.max(previous, current);
    } else if (previous !== undefined) {
        return previous;
    } else if (current !== undefined) {
        return current;
    } else {
        return undefined;
    }
}

function Outline(props: { module: proto.tql.Module }) {
    const statements = props.module.getStatementsList();

    const parameters: number[] = [];
    let lastParameter: number | undefined;

    const loads: number[] = [];
    let lastLoad: number | undefined;

    const extracts: number[] = [];
    let lastExtract: number | undefined;

    const queries: number[] = [];
    let lastQuery: number | undefined;

    const visualizations: number[] = [];
    let lastViz: number | undefined;

    for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];

        switch (statement.getStatementCase()) {
            case proto.tql.Statement.StatementCase.PARAMETER:
                parameters.push(i);
                lastParameter = i;
                break;
            case proto.tql.Statement.StatementCase.LOAD:
                loads.push(i);
                lastLoad = i;
                break;
            case proto.tql.Statement.StatementCase.EXTRACT:
                extracts.push(i);
                lastExtract = i;
                break;
            case proto.tql.Statement.StatementCase.QUERY:
                queries.push(i);
                lastQuery = i;
                break;
            case proto.tql.Statement.StatementCase.VIZ:
                visualizations.push(i);
                lastViz = i;
                break;
            default:
                break;
        }
    }

    lastLoad = getSectionIndex(lastParameter, lastLoad);
    lastExtract = getSectionIndex(lastLoad, lastExtract);
    lastQuery = getSectionIndex(lastExtract, lastQuery);
    lastViz = getSectionIndex(lastQuery, lastViz);

    return (
        <div className={styles.outline}>
            <div className={styles.outline_header}>TQL Program</div>
            <Section
                title="Parameters"
                indices={parameters}
                previousSectionIndex={undefined}
                template={`
DECLARE PARAMETER <name> AS INTEGER;

`}
            >
                {parameters.map((i: number) => (
                    <SectionEntry key={i} index={i} />
                ))}
            </Section>
            <Section
                title="Load Statements"
                indices={loads}
                previousSectionIndex={lastParameter}
                template={`
LOAD <name> FROM http (
    url = 'https://example.com',
    method = GET
);

`}
            >
                {loads.map((i: number) => (
                    <SectionEntry key={i} index={i} />
                ))}
            </Section>
            <Section
                title="Extract Statements"
                indices={extracts}
                previousSectionIndex={lastLoad}
                template={`
EXTRACT <name> FROM <name> USING json ();

`}
            >
                {extracts.map((i: number) => (
                    <SectionEntry key={i} index={i} />
                ))}
            </Section>
            <Section
                title="Query Statements"
                indices={queries}
                previousSectionIndex={lastExtract}
                template={`
QUERY <name> AS SELECT * FROM 1;

`}
            >
                {queries.map((i: number) => (
                    <SectionEntry key={i} index={i} />
                ))}
            </Section>
            <Section
                title="Vizualizations"
                indices={visualizations}
                previousSectionIndex={lastQuery}
                template={`
VIZ <name> FROM <name> USING TABLE;

`}
            >
                {visualizations.map((i: number) => (
                    <SectionEntry key={i} index={i} />
                ))}
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
