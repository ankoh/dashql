import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import { Board, EditorLoader, StudioCommandBar, StudioToolBar, BoardCommandBar } from '../components';
import { AppState, Dispatch } from '../model';
import ProgramGraph from '../components/program_graph';
import { connect } from 'react-redux';

import styles from './studio.module.css';

interface Props {
    fileName: string;
    fileSize: number;
    fileLineCount: number;
    program: core.model.Program | null;
    className?: string;
}

class Studio extends React.Component<Props> {
    public render() {
        return (
            <div className={styles.studio}>
                <div className={styles.program}>
                    <div className={styles.program_info}>
                        <div className={styles.program_info_entry}>{this.props.fileName}</div>
                        <div className={styles.program_info_flex} />
                        <div className={styles.program_info_entry}>
                            {this.props.program?.buffer.statementsLength() || 0} statements
                        </div>
                        <div className={styles.program_info_divider} />
                        <div className={styles.program_info_entry}>{this.props.fileLineCount} lines</div>
                        <div className={styles.program_info_divider} />
                        <div className={styles.program_info_entry}>{core.utils.formatBytes(this.props.fileSize)}</div>
                    </div>
                    <EditorLoader className={styles.program_editor} />
                    <StudioToolBar />
                </div>
                <div className={styles.board}>
                    <Board scaleFactor={1.0} />
                </div>
                <StudioCommandBar />
                <BoardCommandBar />
            </div>
        );
    }
}

const mapStateToProps = (state: AppState) => ({
    fileName: state.core.fileName,
    fileSize: state.core.fileSize,
    fileLineCount: state.core.fileLineCount,
    program: state.core.program,
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(Studio);
