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

// Stats Teaser should include a horizontal bar chart with avg download vs processing time!

class Studio extends React.Component<Props> {
    public render() {
        return (
            <div className={styles.studio}>
                <div className={styles.page_program}>
                    <div className={styles.program}>
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
                            <div className={styles.program_stats_views_chart}>
                                <ProgramStatsTeaser
                                    width={84}
                                    height={20}
                                    data={arrow.Table.new(
                                        [
                                            DateVector.from([
                                                new Date(2021, 1, 16),
                                                new Date(2021, 1, 17),
                                                new Date(2021, 1, 18),
                                                new Date(2021, 1, 19),
                                                new Date(2021, 1, 20),
                                                new Date(2021, 1, 21),
                                                new Date(2021, 1, 22),

                                                new Date(2021, 1, 23),
                                                new Date(2021, 1, 24),
                                                new Date(2021, 1, 25),
                                                new Date(2021, 1, 26),
                                                new Date(2021, 1, 27),
                                                new Date(2021, 1, 28),
                                                new Date(2021, 1, 29),
                                            ]),
                                            Float64Vector.from([5, 3, 8, 5, 1, 5, 3, 8, 5, 1, 5, 3, 8, 5]),
                                        ],
                                        ['date', 'views'],
                                    )}
                                />
                            </div>
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
