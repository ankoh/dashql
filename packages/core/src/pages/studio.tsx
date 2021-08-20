import * as React from 'react';
import * as model from '../model';
import { Link } from 'react-router-dom';
import { Route, Routes } from 'react-router-dom';
import { BoardEditor, EditorLoader, ProgramStatsBar } from '../components';
import { motion, AnimatePresence } from 'framer-motion';

import styles from './studio.module.css';
import styles_cmd from '../components/cmdbar.module.css';

import icon_eye from '../../static/svg/icons/eye.svg';

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
                        <ProgramStatsBar scriptID="changeme" />
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
