import * as React from 'react';
import * as model from '../model';
import { Link } from 'react-router-dom';
import { Route, Routes } from 'react-router-dom';
import { BoardEditor, EditorLoader, ProgramStatsBar } from '../components';
import { AnimatePresence } from 'framer-motion';

import styles from './studio.module.css';
import styles_cmd from '../components/cmdbar.module.css';

import icon_eye from '../../static/svg/icons/eye.svg';
import { getScriptName, getScriptNamespace } from '../model';

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
    const scriptNamespace = getScriptNamespace(script);
    const scriptName = getScriptName(script);
    return (
        <div className={styles.studio}>
            <AnimatePresence>
                <div key="header" className={styles.program_header}>
                    <div key="info" className={styles.program_info}>
                        <div className={styles.program_info_avatar}>
                            <div className={styles.program_info_avatar_icon} />
                        </div>
                        <div className={styles.program_info_name}>
                            <span className={styles.program_info_name_namespace}>{scriptNamespace}</span>/
                            <span className={styles.program_info_name_file}>{scriptName}</span>
                        </div>
                        <div className={styles.program_info_description}>{script.description}</div>
                        <div className={styles.program_info_beans}>
                            <div className={styles.program_info_bean}>Example</div>
                        </div>
                    </div>
                    <div key="stats" className={styles.program_stats}>
                        <ProgramStatsBar scriptID="changeme" />
                    </div>
                </div>
                <Routes>
                    <Route
                        path="/"
                        element={
                            <>
                                <div key="editor" className={styles.program_editor}>
                                    <EditorLoader />
                                </div>
                                <div key="board" className={styles.board}>
                                    <BoardEditor immutable={false} scaleFactor={1.0} className={styles.board_editor} />
                                    <BoardCommandBar />
                                </div>
                            </>
                        }
                    />
                </Routes>
            </AnimatePresence>
        </div>
    );
};
