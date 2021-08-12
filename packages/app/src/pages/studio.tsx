import * as React from 'react';
import * as arrow from 'apache-arrow';
import * as model from '../model';
import { Link } from 'react-router-dom';
import { Route, Routes } from 'react-router-dom';
import { BoardEditor, EditorLoader, ProgramStatsTeaser } from '../components';
import { motion, AnimatePresence } from 'framer-motion';

import styles from './studio.module.css';
import styles_cmd from '../components/cmdbar.module.css';

import icon_eye from '../../static/svg/icons/eye.svg';
import { DateVector, Float64Vector } from 'apache-arrow';

const BoardAction = (props: { icon: string }) => (
    <div className={styles.cmdbar_cmd}>
        <svg width="20px" height="20px">
            <use xlinkHref={`${props.icon}#sym`} />
        </svg>
    </div>
);

const BoardCommandBar = () => (
    <div className={styles_cmd.cmdbar_board}>
        <div className={styles_cmd.cmdbar_cmdset} />
        <div className={styles_cmd.cmdbar_cmdset}>
            <Link to="/viewer" className={styles_cmd.cmdbar_cmd}>
                <BoardAction icon={icon_eye} />
            </Link>
        </div>
    </div>
);

type Props = {
    className?: string;
};

export const Studio: React.FC<Props> = (props: Props) => {
    const { script } = model.useProgramContext();
    return (
        <div className={styles.studio}>
            <AnimatePresence>
                <motion.div key="header" className={styles.program_header}>
                    <motion.div key="info" className={styles.program_info}>
                        <motion.div className={styles.program_info_avatar}></motion.div>
                        <motion.div className={styles.program_info_name}>{script.uriName}</motion.div>
                        <motion.div className={styles.program_info_last_change}>Last updated 5 month ago</motion.div>
                        <motion.div className={styles.program_info_visibility}>Secret</motion.div>
                    </motion.div>
                    <motion.div key="stats" className={styles.program_stats}>
                        <motion.div className={styles.program_stats_views_chart}>
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
                                        Float64Vector.from([5, 3, 8, 9, 4, 2, 3, 8, 1, 1, 5, 3, 8, 5]),
                                    ],
                                    ['date', 'views'],
                                )}
                            />
                        </motion.div>
                    </motion.div>
                </motion.div>
                <Routes>
                    <Route
                        path="/"
                        element={
                            <>
                                <motion.div key="editor" className={styles.program_editor}>
                                    <EditorLoader />
                                </motion.div>
                                <motion.div key="board" className={styles.board}>
                                    <BoardEditor immutable={false} scaleFactor={1.0} className={styles.board_editor} />
                                    <BoardCommandBar />
                                </motion.div>
                            </>
                        }
                    />
                </Routes>
            </AnimatePresence>
        </div>
    );
};
