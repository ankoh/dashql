import * as React from 'react';
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

import styles from './explorer.module.css';
import styles_cmd from '../components/cmdbar.module.css';

import icon_eye from '../../static/svg/icons/eye.svg';
import icon_delete from '../../static/svg/icons/delete.svg';
import icon_settings from '../../static/svg/icons/settings.svg';
import icon_fork from '../../static/svg/icons/fork.svg';
import icon_share from '../../static/svg/icons/share.svg';
import icon_star_outline from '../../static/svg/icons/star_outline.svg';
import icon_edit from '../../static/svg/icons/edit.svg';
import icon_blank from '../../static/svg/icons/file_outline.svg';
import {
    getScriptName,
    getScriptNamespace,
    REPLACE_PROGRAM,
    ScriptOriginType,
    useProgramContext,
    useProgramContextDispatch,
} from '../model';
import { useAnalyzer } from '../analyzer';

const forkOverlay = Symbol();
const shareOverlay = Symbol();

type Props = {
    className?: string;
};

type CmdProps = {
    /// The width
    width: string;
    /// The height
    height: string;
    /// The icon
    icon: string;
    /// The onclick handler
    onClick?: () => void;
};

const CmdButton = (props: CmdProps) => (
    <div className={styles_cmd.cmdbar_cmd} onClick={props.onClick}>
        <svg width="20px" height="20px">
            <use xlinkHref={`${props.icon}#sym`} />
        </svg>
    </div>
);

export const Explorer: React.FC<Props> = (props: Props) => {
    // Use state
    const programCtx = useProgramContext();
    const programCtxDispatch = useProgramContextDispatch();
    const analyzer = useAnalyzer();
    const scriptNamespace = getScriptNamespace(programCtx.script);
    const scriptName = getScriptName(programCtx.script);
    const setOverlay = useOverlaySetter();

    // Define callbacks
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
    const createBlankScript = React.useCallback(() => {
        const program = analyzer.parseProgram('');
        programCtxDispatch({
            type: REPLACE_PROGRAM,
            data: [
                program,
                {
                    origin: {
                        originType: ScriptOriginType.LOCAL,
                        fileName: 'unnamed.dashql',
                        exampleName: null,
                        httpURL: null,
                        githubAccount: null,
                        githubGistName: null,
                    },
                    description: '',
                    text: '',
                    modified: false,
                    lineCount: 1,
                    bytes: 0,
                },
            ],
        });
    }, [setOverlay]);

    const beans = [];
    switch (programCtx.script.origin.originType) {
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

    const BoardCommandBar = () => (
        <div className={styles.cmdbar_board}>
            <div className={styles_cmd.cmdbar_cmdset} />
            <div className={styles_cmd.cmdbar_cmdset}>
                {programCtx.script.origin.originType == ScriptOriginType.GITHUB_GIST && (
                    <CmdButton width="20px" height="20px" icon={icon_star_outline} />
                )}
                <CmdButton width="20px" height="20px" icon={icon_share} onClick={showShareDialog} />
                <Link to="/viewer">
                    <CmdButton width="20px" height="20px" icon={icon_eye} />
                </Link>
            </div>
        </div>
    );

    return (
        <div className={styles.explorer}>
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
                            <div className={styles.program_info_description}>{programCtx.script.description}</div>
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
                                        <CmdButton width="20px" height="20px" icon={icon_edit} />
                                        <CmdButton width="20px" height="20px" icon={icon_delete} />
                                        <CmdButton width="20px" height="20px" icon={icon_settings} />
                                    </>
                                ) : (
                                    <CmdButton width="20px" height="20px" icon={icon_fork} onClick={showForkDialog} />
                                )}
                                <CmdButton width="20px" height="20px" icon={icon_blank} onClick={createBlankScript} />
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
