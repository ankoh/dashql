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

import logo from '../../static/svg/logo/logo.svg';
import icon_eye from '../../static/svg/icons/eye.svg';
import icon_cloud_upload from '../../static/svg/icons/cloud_upload.svg';
import icon_fork from '../../static/svg/icons/fork.svg';
import icon_share from '../../static/svg/icons/share.svg';
import icon_star_outline from '../../static/svg/icons/star_outline.svg';
import icon_edit from '../../static/svg/icons/edit.svg';
import icon_blank from '../../static/svg/icons/file_outline.svg';
import {
    generateBlankScript,
    getScriptName,
    getScriptNamespace,
    REPLACE_PROGRAM,
    SAVE_SCRIPT,
    ScriptOriginType,
    useProgramContext,
    useProgramContextDispatch,
    useScriptRegistry,
    useScriptRegistryDispatch,
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
    const scriptRegistry = useScriptRegistry();
    const scriptRegistryDispatch = useScriptRegistryDispatch();
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
        const script = generateBlankScript(scriptRegistry);
        scriptRegistryDispatch({
            type: SAVE_SCRIPT,
            data: script,
        });
        programCtxDispatch({
            type: REPLACE_PROGRAM,
            data: [program, generateBlankScript(scriptRegistry)],
        });
    }, [setOverlay]);

    const beans = [];
    let ownScript = false;
    let hasStats = true;
    switch (programCtx.script.origin.originType) {
        case ScriptOriginType.LOCAL:
            beans.push('Local');
            ownScript = true;
            hasStats = false;
            break;
        case ScriptOriginType.EXAMPLES:
            beans.push('Example');
            break;
        case ScriptOriginType.GITHUB_GIST:
            beans.push('Gist');
            ownScript = true; // XXX
            break;
    }
    const editorReadOnly = false;

    const BoardCommandBar = () => (
        <div className={styles.board_cmdbar}>
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
                <div key="program" className={styles.program_page}>
                    <div key="info_actions" className={styles.program_info_and_actions}>
                        <div key="info" className={styles.program_info}>
                            <div className={styles.program_info_avatar}>
                                <div className={styles.program_info_avatar_icon}>
                                    <svg width="24px" height="24px">
                                        <use xlinkHref={`${logo}#sym`} />
                                    </svg>
                                </div>
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
                                        <CmdButton width="20px" height="20px" icon={icon_cloud_upload} />
                                    </>
                                ) : (
                                    <CmdButton width="20px" height="20px" icon={icon_fork} onClick={showForkDialog} />
                                )}
                                <CmdButton width="20px" height="20px" icon={icon_blank} onClick={createBlankScript} />
                            </div>
                        </div>
                    </div>
                    {hasStats && (
                        <div key="stats" className={styles.program_stats}>
                            <ProgramStatsBar scriptID="changeme" />
                        </div>
                    )}
                    <Routes>
                        <Route
                            path="/"
                            element={
                                <OverlayContainer id={forkOverlay} className={styles.program_editor}>
                                    <EditorLoader readOnly={editorReadOnly} />
                                </OverlayContainer>
                            }
                        />
                    </Routes>
                </div>
                <Routes>
                    <Route
                        path="/"
                        element={
                            <>
                                <div key="board" className={styles.board}>
                                    <BoardCommandBar />
                                    <OverlayContainer id={shareOverlay}>
                                        <BoardEditor
                                            immutable={false}
                                            scaleFactor={1.0}
                                            className={styles.board_editor}
                                        />
                                    </OverlayContainer>
                                </div>
                            </>
                        }
                    />
                </Routes>
            </AnimatePresence>
        </div>
    );
};
