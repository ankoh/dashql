import * as React from "react";
import { Board, EditorLoader } from '../components';
// import Outline from './outline';
// import Library from './library';

import { TopBar } from './studio_topbar';
import { ToolBar } from './studio_toolbar';
import { Planner } from './studio_planner';

import styles from './studio.module.css';

class Studio extends React.Component {
    public render() {
        return (
            <div className={styles.studio}>
                <div className={styles.program}>
                    <EditorLoader className={styles.editor} />
                    <Planner />
                    <ToolBar />
                </div>
                <div className={styles.board}>
                    <Board scaleFactor={1.0} />
                </div>
                <TopBar />
                {
//                <div className={styles.viztypes}>
//                    <QueryPlanViz />
//                    <TextCardViz />
//                    <TableViz />
//                    <div className={styles.viztypes_charts}>
//                        <LineChartViz />
//                        <BarChartViz />
//                        <ScatterChartViz />
//                        <PieChartViz />
//                    </div>
//                </div>
                                    }
            </div>
        );
    }
}

export default Studio;

