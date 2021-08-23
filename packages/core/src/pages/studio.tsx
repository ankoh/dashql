import * as React from 'react';
import * as model from '../model';
import classNames from 'classnames';
import { Link } from 'react-router-dom';
import { Route, Routes } from 'react-router-dom';
import {
    BoardEditor,
    EditorLoader,
    ProgramStatsBar,
    OverlayContainer,
    useOverlaySetter,
    ForkDialog,
    ShareDialog,
} from '../components';
import { AnimatePresence } from 'framer-motion';

import styles from './studio.module.css';
import styles_cmd from '../components/cmdbar.module.css';

import icon_eye from '../../static/svg/icons/eye.svg';
import icon_delete from '../../static/svg/icons/delete.svg';
import icon_settings from '../../static/svg/icons/settings.svg';
import icon_fork from '../../static/svg/icons/fork.svg';
import icon_share from '../../static/svg/icons/share.svg';
import icon_star_outline from '../../static/svg/icons/star_outline.svg';
import icon_edit from '../../static/svg/icons/edit.svg';
import { getScriptName, getScriptNamespace, ScriptOriginType, useProgramContext } from '../model';

const forkOverlay = Symbol();
const shareOverlay = Symbol();

type Props = {
    className?: string;
};

export const Studio: React.FC<Props> = (props: Props) => {
    const { script } = model.useProgramContext();
    const setOverlay = useOverlaySetter();
    const showForkDialog = React.useCallback(() => {
        const fork: React.FC = () => <ForkDialog onClose={() => setOverlay(null)} />;
        setOverlay({
            id: forkOverlay,
            renderer: fork,
        });
    }, [setOverlay]);
    const showShareDialog = React.useCallback(() => {
        const share: React.FC = () => <ShareDialog onClose={() => setOverlay(null)} />;
        setOverlay({
            id: shareOverlay,
            renderer: share,
        });
    }, [setOverlay]);

    const programCtx = useProgramContext();
    const scriptNamespace = getScriptNamespace(script);
    const scriptName = getScriptName(script);
    const beans = [];
    switch (script.origin.originType) {
        case ScriptOriginType.LOCAL:
            beans.push('Local');
            break;
        case ScriptOriginType.EXAMPLES:
            beans.push('Example');
            break;
        case ScriptOriginType.GITHUB_GIST:
            beans.push('Gist');
            break;
    }
    const editorReadOnly = false;
    const ownScript = false;

    const BoardAction = (p: { icon: string }) => (
        <svg width="20px" height="20px">
            <use xlinkHref={`${p.icon}#sym`} />
        </svg>
    );

    const BoardCommandBar = () => (
        <div className={styles.cmdbar_board}>
            <div className={styles_cmd.cmdbar_cmdset} />
            <div className={styles_cmd.cmdbar_cmdset}>
                {programCtx.script.origin.originType == ScriptOriginType.GITHUB_GIST && (
                    <div className={styles_cmd.cmdbar_cmd}>
                        <svg width="20px" height="20px">
                            <use xlinkHref={`${icon_star_outline}#sym`} />
                        </svg>
                    </div>
                )}
                <div className={styles_cmd.cmdbar_cmd} onClick={showShareDialog}>
                    <svg width="20px" height="20px">
                        <use xlinkHref={`${icon_share}#sym`} />
                    </svg>
                </div>
                <Link to="/viewer" className={styles_cmd.cmdbar_cmd}>
                    <BoardAction icon={icon_eye} />
                </Link>
            </div>
        </div>
    );

    return (
        <div className={styles.studio}>
            <AnimatePresence>
                <div key="header" className={styles.program_header}>
                    <div key="info" className={styles.program_info_and_actions}>
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
                                {beans.map(b => (
                                    <div key={b} className={styles.program_info_bean}>
                                        {b}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div key="actions" className={styles.program_actions}>
                            <div className={classNames(styles_cmd.cmdbar_cmdset, styles.program_action)}>
                                {ownScript ? (
                                    <>
                                        <div className={styles_cmd.cmdbar_cmd}>
                                            <svg width="20px" height="20px">
                                                <use xlinkHref={`${icon_edit}#sym`} />
                                            </svg>
                                        </div>
                                        <div className={styles_cmd.cmdbar_cmd}>
                                            <svg width="20px" height="20px">
                                                <use xlinkHref={`${icon_delete}#sym`} />
                                            </svg>
                                        </div>
                                        <div className={styles_cmd.cmdbar_cmd}>
                                            <svg width="20px" height="20px">
                                                <use xlinkHref={`${icon_settings}#sym`} />
                                            </svg>
                                        </div>
                                    </>
                                ) : (
                                    <div className={styles_cmd.cmdbar_cmd} onClick={showForkDialog}>
                                        <svg width="20px" height="20px">
                                            <use xlinkHref={`${icon_fork}#sym`} />
                                        </svg>
                                    </div>
                                )}
                            </div>
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
                                <OverlayContainer id={forkOverlay} className={styles.program_editor}>
                                    <EditorLoader readOnly={editorReadOnly} />
                                </OverlayContainer>
                                <div key="board" className={styles.board}>
                                    <OverlayContainer id={shareOverlay}>
                                        <BoardEditor
                                            immutable={false}
                                            scaleFactor={1.0}
                                            className={styles.board_editor}
                                        />
                                    </OverlayContainer>
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
