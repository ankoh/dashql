import * as React from "react";
import * as core from "@dashql/core";
import { Board, EditorLoader } from '../components';
import { AppState, Dispatch } from '../store';
import { ProgramInspector, ProgramGraph } from "../components";
import { connect } from 'react-redux';
// import Outline from './outline';
// import Library from './library';

import { TopBar } from './studio_topbar';
import { ToolBar } from './studio_toolbar';

import styles from './studio.module.css';

interface Props {
    program: core.parser.Program | null;
    className?: string
}

class Studio extends React.Component<Props> {
    public render() {
        return (
            <div className={styles.studio}>
                <div className={styles.program}>
                    <EditorLoader className={styles.editor} />
                    <div className={styles.program_details}>
                        <ProgramInspector className={styles.program_inspector} program={this.props.program} />
                        <ProgramGraph className={styles.program_graph} program={this.props.program} />
                    </div>
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

const mapStateToProps = (state: AppState) => ({
    program: state.studioProgram
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({
});

export default connect(mapStateToProps, mapDispatchToProps)(Studio);

