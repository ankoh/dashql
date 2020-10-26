import * as React from "react";
import { Board, EditorLoader } from '../components';
// import Outline from './outline';
// import Library from './library';

import {
    IIconProps,
    AddIcon,
    ArcChartIcon,
    AspectRatioIcon,
    BarChartIcon,
    CloudUploadIcon,
    DatabaseImportIcon,
    DatabaseSearchIcon,
    DocumentDownloadIcon,
    FileDocumentBoxPlusIcon,
    LineChartIcon,
    PlanIcon,
    RefreshIcon,
    RulerIcon,
    ScatterChartIcon,
    TableChartIcon,
    TextCardIcon,
    VariableBoxIcon,
} from '../svg/icons';

import styles from './studio.module.css';

const VIZTYPE_ICON_WIDTH = '20px';
const VIZTYPE_ICON_HEIGHT = '20px';

class TopBarActionProps {}
function createTopBarAction(Icon: React.FunctionComponent<IIconProps>): React.FunctionComponent<IIconProps & TopBarActionProps> {
    return (props: IIconProps & TopBarActionProps) => {
        return (
            <div className={styles.topbar_action}>
                <Icon
                    className={styles.topbar_icon}
                    width={'20px'}
                    height={'20px'}
                    {...props}
                />
            </div>
        );
    };
}
const AddAction = createTopBarAction(AddIcon);
const RefreshAction = createTopBarAction(RefreshIcon);
const RulerAction = createTopBarAction(RulerIcon);
const DeviceAction = createTopBarAction(AspectRatioIcon);
const DocumentDownloadAction = createTopBarAction(DocumentDownloadIcon);
const CloudUploadAction = createTopBarAction(CloudUploadIcon);

class ToolBarToolProps {}
function createToolBarTool(Icon: React.FunctionComponent<IIconProps>): React.FunctionComponent<IIconProps & ToolBarToolProps> {
    return (props: IIconProps & ToolBarToolProps) => {
        return (
            <div className={styles.toolbar_tool}>
                <Icon
                    className={styles.toolbar_icon}
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

class VizTypeProps {}
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

class Studio extends React.Component {
    public render() {
        return (
            <div className={styles.studio}>
                <div className={styles.board}>
                    <Board scaleFactor={1.0} />
                    <div className={styles.editor_container}>
                        <div className={styles.editor_sidebar} />
                        <EditorLoader className={styles.editor} />
                    </div>
                </div>
                <div className={styles.topbar}>
                    <div className={styles.topbar_actionset}>
                        <AddAction />
                        <RefreshAction />
                    </div>
                    <div className={styles.topbar_actionset}>
                        <RulerAction />
                        <DeviceAction />
                    </div>
                    <div className={styles.topbar_actionset}>
                        <DocumentDownloadAction />
                        <CloudUploadAction />
                    </div>
                    <div className={styles.topbar_actionset}>
                    </div>
                </div>
                <div className={styles.sidebar}>{
//                    <Outline />
//                    <Library />
}
                </div>
                <div className={styles.toolbar}>
                    <CreateVariable />
                    <CreateLoad />
                    <CreateExtract />
                    <CreateQuery />
                </div>
                <div className={styles.viztypes}>
                    <QueryPlanViz />
                    <TextCardViz />
                    <TableViz />
                    <div className={styles.viztypes_charts}>
                        <LineChartViz />
                        <BarChartViz />
                        <ScatterChartViz />
                        <PieChartViz />
                    </div>
                </div>
                <div className={styles.properties}>
                    <div className={styles.properties_header}>Properties</div>
                </div>
            </div>
        );
    }
}

export default Studio;

