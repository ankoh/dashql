import * as React from "react";
import { Board, EditorLoader } from '../components';
// import Outline from './outline';
// import Library from './library';

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
} from '../svg/icons';

import styles from './explorer.module.css';

const VIZTYPE_ICON_WIDTH = '20px';
const VIZTYPE_ICON_HEIGHT = '20px';
const TOOL_ICON_WIDTH = '20px';
const TOOL_ICON_HEIGHT = '20px';
const TOPBAR_ICON_WIDTH = '20px';
const TOPBAR_ICON_HEIGHT = '20px';

class Explorer extends React.Component {
    public render() {
        return (
            <div className={styles.explorer}>
                <div className={styles.board}>
                    <Board scaleFactor={1.0} />{
                    <EditorLoader />
                }</div>
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
                <div className={styles.sidebar}>{
//                    <Outline />
//                    <Library />
}
                </div>
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

export default Explorer;

