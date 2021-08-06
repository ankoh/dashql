import * as React from 'react';
import * as core from '@dashql/core';
import * as arrow from 'apache-arrow';
import { AppState, Dispatch } from '../model';
import { Link } from 'react-router-dom';
import { BoardEditor, EditorLoader, ProgramStatsTeaser } from '../components';
import { connect } from 'react-redux';

import styles from './studio.module.css';
import styles_cmd from '../components/cmdbar.module.css';

import icon_eye from '../../static/svg/icons/eye.svg';
import { DateVector, Float64Vector } from 'apache-arrow';

function BoardAction(props: { icon: string }): React.ReactElement {
    return (
        <div className={styles.cmdbar_cmd}>
            <svg width="20px" height="20px">
                <use xlinkHref={`${props.icon}#sym`} />
            </svg>
        </div>
    );
}

class BoardCommandBar extends React.Component {
    public render(): React.ReactElement {
        return (
            <div className={styles_cmd.cmdbar_board}>
                <div className={styles_cmd.cmdbar_cmdset} />
                <div className={styles_cmd.cmdbar_cmdset}>
                    <Link to="/viewer" className={styles_cmd.cmdbar_cmd}>
                        <BoardAction icon={icon_eye} />
                    </Link>
                </div>
            </div>
        );
    }
}

interface Props {
    script: core.model.Script;
    program: core.model.Program | null;
    className?: string;
}

class Studio extends React.Component<Props> {
    public render() {
        return (
            <div className={styles.studio}>
                <div className={styles.page_program}>
                    <div className={styles.program}>
                        <div className={styles.program_footer}>
                            <div className={styles.program_footer_flex} />
                            <div className={styles.program_footer_entry}>
                                {this.props.program?.buffer.statementsLength() || 0} statements
                            </div>
                            <div className={styles.program_footer_divider} />
                            <div className={styles.program_footer_entry}>{this.props.script.lineCount} lines</div>
                            <div className={styles.program_footer_divider} />
                            <div className={styles.program_footer_entry}>
                                {core.utils.formatBytes(this.props.script.bytes || 0)}
                            </div>
                        </div>
                        <EditorLoader className={styles.program_editor} />
                    </div>
                    <div className={styles.program_header}>
                        <div className={styles.program_info}>
                            <div className={styles.program_info_avatar}></div>
                            <div className={styles.program_info_name}>{this.props.script.uriName}</div>
                            <div className={styles.program_info_last_change}>Last updated 5 month ago</div>
                            <div className={styles.program_info_visibility}>Secret</div>
                        </div>
                        <div className={styles.program_stats}>
                            <ProgramStatsTeaser
                                width={200}
                                height={48}
                                data={arrow.Table.new(
                                    [
                                        DateVector.from([
                                            new Date(2021, 1),
                                            new Date(2021, 2),
                                            new Date(2021, 3),
                                            new Date(2021, 4),
                                            new Date(2021, 5),
                                            new Date(2021, 6),
                                        ]),
                                        Float64Vector.from([1, 5, 3, 8, 5, 6]),
                                    ],
                                    ['date', 'views'],
                                )}
                            />
                        </div>
                    </div>
                </div>
                <div className={styles.page_board}>
                    <div className={styles.board}>
                        <BoardEditor immutable={false} scaleFactor={1.0} />
                    </div>
                    <BoardCommandBar />
                </div>
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
