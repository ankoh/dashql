import * as React from 'react';
import cn from 'classnames';
import { Route, Routes } from 'react-router-dom';
import {
    BoardEditor,
    LazyLoader,
    ForkDialog,
    OverlayContainer,
    ProgramStats,
    ScriptNotFound,
    ShareDialog,
    useOverlaySetter,
    Button,
    LinkButton,
    ProgramHeader,
} from '../components';
import { AnimatePresence } from 'framer-motion';

import styles from './explorer.module.css';
import styles_cmd from '../components/button.module.css';

import icon_eye from '../../static/svg/icons/eye.svg';
import icon_cloud_upload from '../../static/svg/icons/cloud_upload.svg';
import icon_fork from '../../static/svg/icons/fork.svg';
import icon_share from '../../static/svg/icons/share.svg';
import icon_star_outline from '../../static/svg/icons/star_outline.svg';
import icon_edit from '../../static/svg/icons/edit.svg';
import icon_blank from '../../static/svg/icons/file_outline.svg';
import {
    REPLACE_PROGRAM,
    SAVE_SCRIPT,
    ScriptOriginType,
    canEditScript,
    generateBlankScript,
    scriptSupportsStats,
    useProgramContext,
    useProgramContextDispatch,
    useScriptRegistry,
    useScriptRegistryDispatch,
} from '../model';
import { useAnalyzer } from '../analyzer';
import { useAppConfig } from '../model';

const CMD_ICON_SIZE = '20px';
const SYM_FORK_OVERLAY = Symbol();
const SYM_SHARE_OVERLAY = Symbol();

const LazyEditor = React.lazy(() => import('../components/editor'));

type Props = {
    className?: string;
};

export const Explorer: React.FC<Props> = (props: Props) => {
    const appConfig = useAppConfig();
    const programCtx = useProgramContext();
    const programCtxDispatch = useProgramContextDispatch();
    const scriptRegistry = useScriptRegistry();
    const scriptRegistryDispatch = useScriptRegistryDispatch();
    const analyzer = useAnalyzer();
    const setOverlay = useOverlaySetter();

    // Define callbacks
    const showForkDialog = React.useCallback(() => {
        const fork: React.FC = () => <ForkDialog onClose={() => setOverlay(null)} />;
        setOverlay({
            id: SYM_FORK_OVERLAY,
            renderer: fork,
        });
    }, [setOverlay]);
    const showShareDialog = React.useCallback(() => {
        const share: React.FC = () => <ShareDialog onClose={() => setOverlay(null)} />;
        setOverlay({
            id: SYM_SHARE_OVERLAY,
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

    // No script set?
    if (!programCtx.script) {
        return <ScriptNotFound />;
    }

    // Check script origin type
    const canEdit = canEditScript(programCtx.script);
    const editorReadOnly = false;

    const BoardCommandBar = () => (
        <div className={styles.board_cmdbar}>
            <div />
            <div className={styles_cmd.buttonset}>
                {programCtx.script.origin.originType == ScriptOriginType.GITHUB_GIST && (
                    <Button
                        className={styles.board_cmd}
                        width={CMD_ICON_SIZE}
                        height={CMD_ICON_SIZE}
                        icon={icon_star_outline}
                    />
                )}
                <Button
                    className={styles.board_cmd}
                    width={CMD_ICON_SIZE}
                    height={CMD_ICON_SIZE}
                    icon={icon_share}
                    onClick={showShareDialog}
                />
                <LinkButton
                    className={styles.board_cmd}
                    to="/viewer"
                    width={CMD_ICON_SIZE}
                    height={CMD_ICON_SIZE}
                    icon={icon_eye}
                />
            </div>
        </div>
    );

    return (
        <div className={styles.explorer}>
            <AnimatePresence>
                <div key="program_page" className={styles.program_page}>
                    <div className={styles.program_info_and_actions}>
                        <ProgramHeader className={styles.program_info} script={programCtx.script} />
                        {appConfig?.features?.editorControls && (
                            <div className={cn(styles_cmd.buttonset, styles.program_actions)}>
                                (canEdit ? (
                                <>
                                    <Button
                                        className={styles.program_action}
                                        width={CMD_ICON_SIZE}
                                        height={CMD_ICON_SIZE}
                                        icon={icon_edit}
                                    />
                                    <Button
                                        className={styles.program_action}
                                        width={CMD_ICON_SIZE}
                                        height={CMD_ICON_SIZE}
                                        icon={icon_cloud_upload}
                                    />
                                </>
                                ) : (
                                <Button
                                    className={styles.program_action}
                                    width={CMD_ICON_SIZE}
                                    height={CMD_ICON_SIZE}
                                    icon={icon_fork}
                                    onClick={showForkDialog}
                                />
                                ))
                                <Button
                                    className={styles.program_action}
                                    width={CMD_ICON_SIZE}
                                    height={CMD_ICON_SIZE}
                                    icon={icon_blank}
                                    onClick={createBlankScript}
                                />
                            </div>
                        )}
                    </div>
                    {appConfig.features?.scriptStatistics && scriptSupportsStats(programCtx.script) && (
                        <div className={styles.program_stats}>
                            <ProgramStats scriptID="changeme" />
                        </div>
                    )}
                    <Routes>
                        <Route
                            path="/"
                            element={
                                <OverlayContainer id={SYM_FORK_OVERLAY} className={styles.program_editor}>
                                    <LazyLoader>
                                        <LazyEditor readOnly={editorReadOnly} />
                                    </LazyLoader>
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
                                    <OverlayContainer id={SYM_SHARE_OVERLAY}>
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
