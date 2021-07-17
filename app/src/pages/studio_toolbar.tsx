import * as React from "react";
import {
    IIconProps,
    AnalyticsIcon,
    ArcChartIcon,
    BarChartIcon,
    DatabaseImportIcon,
    DatabaseSearchIcon,
    FileDocumentBoxPlusIcon,
    LineChartIcon,
    PlanIcon,
    ScatterChartIcon,
    TableChartIcon,
    TextCardIcon,
    VariableBoxIcon,
} from '../svg/icons';
import styles from './studio.module.css';
import classNames from 'classnames';

class ToolProps {}
function createTool(Icon: React.FunctionComponent<IIconProps>): React.FunctionComponent<IIconProps & ToolProps> {
    return (props: IIconProps & ToolProps) => {
        return (
            <div className={styles.tool}>
                <Icon
                    className={styles.tool_icon}
                    width={'20px'}
                    height={'20px'}
                    {...props}
                />
            </div>
        );
    };
}
const CreateVariable = createTool(VariableBoxIcon);
const CreateLoad = createTool(FileDocumentBoxPlusIcon);
const CreateExtract = createTool(DatabaseImportIcon);
const CreateQuery = createTool(DatabaseSearchIcon);

class VizTypeProps {}
function createVizType(Icon: React.FunctionComponent<IIconProps>): React.FunctionComponent<IIconProps & VizTypeProps> {
    return (props: IIconProps & VizTypeProps) => {
        return (
            <div className={styles.viztype}>
                <Icon
                    className={styles.viztype_icon}
                    width={'20px'}
                    height={'20px'}
                    {...props}
                />
            </div>
        );
    };
}
const QueryPlanViz = createVizType(PlanIcon);
const TextCardViz = createVizType(TextCardIcon);
const TableViz = createVizType(TableChartIcon);
const LineChartViz = createVizType(LineChartIcon);
const BarChartViz = createVizType(BarChartIcon);
const ScatterChartViz = createVizType(ScatterChartIcon);
const PieChartViz = createVizType(ArcChartIcon);

type ToolBarState = {
    vizExpanded: boolean;
};
export class ToolBar extends React.Component<{}, ToolBarState> {
    constructor(props: {}) {
        super(props);
        this.state = {
            vizExpanded: false,
        };
    }
    protected toggleViz() {
        this.setState({...this.state, vizExpanded: !this.state.vizExpanded});
    }
    public render() {
        return (
            <div className={styles.toolbar}>
                <CreateVariable />
                <CreateLoad />
                <CreateExtract />
                <CreateQuery />
                <div className={classNames(styles.tool, {
                        [styles.active]: this.state.vizExpanded
                    })}
                    onClick={this.toggleViz.bind(this)}
                >
                    <AnalyticsIcon
                        className={classNames(styles.tool_icon, {
                            [styles.active]: this.state.vizExpanded
                        })}
                        width={'20px'}
                        height={'20px'}
                    />
                </div>
                {this.state.vizExpanded && (
                    <div className={styles.tool_sublist}>
                        <QueryPlanViz />
                        <TextCardViz />
                        <TableViz />
                        <LineChartViz />
                        <BarChartViz />
                        <ScatterChartViz />
                        <PieChartViz />
                    </div>
                )}
            </div>
        );
    }
};
