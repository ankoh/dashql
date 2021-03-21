import * as React from 'react';
import * as core from '@dashql/core';
import { BoardEditor, EditorLoader, StudioCommandBar, StudioToolBar, BoardCommandBar } from '../components';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';

import styles from './studio.module.css';

interface Props {
    script: core.model.Script;
    program: core.model.Program | null;
    className?: string;
}

class Studio extends React.Component<Props> {
    public render() {
        return (
            <div className={styles.studio}>
                <div className={styles.program}>
                    <div className={styles.program_info}>
                        <div className={styles.program_info_entry}>{core.model.getScriptURIPrefixName(this.props.script.uriPrefix)}://{this.props.script.uriName}{this.props.script.modified ? '*' : ''}</div>
                        <div className={styles.program_info_flex} />
                        <div className={styles.program_info_entry}>
                            {this.props.program?.buffer.statementsLength() || 0} statements
                        </div>
                        <div className={styles.program_info_divider} />
                        <div className={styles.program_info_entry}>{this.props.script.lineCount} lines</div>
                        <div className={styles.program_info_divider} />
                        <div className={styles.program_info_entry}>{core.utils.formatBytes(this.props.script.bytes || 0)}</div>
                    </div>
                    <EditorLoader className={styles.program_editor} />
                    <StudioToolBar />
                </div>
                <div className={styles.board}>
                    <BoardEditor immutable={false} scaleFactor={1.0} />
                </div>
                <StudioCommandBar />
                <BoardCommandBar />
            </div>
        );
    }
}

const mapStateToProps = (state: AppState) => ({
    script: state.core.script,
    program: state.core.program,
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(Studio);
