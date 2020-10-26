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

class ToolBarToolProps {}
class VizTypeProps {}

function createToolBarTool(Icon: React.FunctionComponent<IIconProps>): React.FunctionComponent<IIconProps & ToolBarToolProps> {
    return (props: IIconProps & ToolBarToolProps) => {
        return (
            <div className={styles.editor_toolbar_tool}>
                <Icon
                    className={styles.editor_toolbar_icon}
                    width={'20px'}
                    height={'20px'}
                    {...props}
                />
            </div>
        );
    };
}
const CreateVariable = createToolBarTool(VariableBoxIcon);
const CreateLoad = createToolBarTool(FileDocumentBoxPlusIcon);
const CreateExtract = createToolBarTool(DatabaseImportIcon);
const CreateQuery = createToolBarTool(DatabaseSearchIcon);
const CreateViz = createToolBarTool(AnalyticsIcon);

function createVizType(Icon: React.FunctionComponent<IIconProps>): React.FunctionComponent<IIconProps & VizTypeProps> {
    return (props: IIconProps & VizTypeProps) => {
        return (
            <div className={styles.viztypes_viztype}>
                <Icon
                    className={styles.viztypes_icon}
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

export class ToolBar extends React.Component<{}> {
    public render() {
        return (
            <div className={styles.editor_toolbar}>
                <CreateVariable />
                <CreateLoad />
                <CreateExtract />
                <CreateQuery />
                <CreateViz />
            </div>
        );
    }
};
