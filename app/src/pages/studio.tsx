import * as React from "react";
import * as core from "@dashql/core";
import { Board, EditorLoader } from '../components';
import { AppState, Dispatch } from '../store';
import { ProgramGraph } from "../components";
import { connect } from 'react-redux';
// import Outline from './outline';
// import Library from './library';

import { ProgramCommandBar } from './studio_cmdbar_program';
import { BoardCommandBar } from './studio_cmdbar_board';
import { ToolBar } from './studio_toolbar';

import styles from './studio.module.css';

interface Props {
    program: core.model.Program | null;
    className?: string
}

class Studio extends React.Component<Props> {
    public render() {
        return (
            <div className={styles.studio}>
                <div className={styles.program}>
                    <ProgramGraph className={styles.program_graph} program={this.props.program} />
                    <div className={styles.program_info}>
                        <div className={styles.program_info_entry}>
                            unnamed.dashql
                        </div>
                        <div className={styles.program_info_divider} />
                        <div className={styles.program_info_entry}>
                            233 lines
                        </div>
                        <div className={styles.program_info_divider} />
                        <div className={styles.program_info_entry}>
                            4.88 KB
                        </div>
                        <div className={styles.program_info_flex} />
                        <div className={styles.program_info_entry}>
                            5 statements
                        </div>
                        <div className={styles.program_info_divider} />
                        <div className={styles.program_info_entry}>
                            evaluated in 50 ms
                        </div>
                    </div>
                    <EditorLoader className={styles.program_editor} />
                    <ToolBar />
                </div>
                <div className={styles.board}>
                    <Board scaleFactor={1.0} />
                </div>
                <ProgramCommandBar />
                <BoardCommandBar />
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

