import * as React from 'react';
import cn from 'classnames';
import { AnimatePresence } from 'framer-motion';
import { Route, Routes } from 'react-router-dom';
import { generateBlankScript, SAVE_SCRIPT, useScriptRegistry, useScriptRegistryDispatch } from '../model';
import { OverlayContainer, useOverlaySetter } from '../components/overlay';
import { LazyLoader } from '../components/lazy_loader';
import { BoardEditor } from '../components/board_editor';
import { Button, LinkButton } from '../components/button';
import { ShareDialog } from '../components/share_dialog';
import { ProgramHeader } from '../components/program_header';
import { useWorkflowSession, useWorkflowSessionState } from '../backend/workflow_session';

import styles from './explorer.module.css';
import styles_cmd from '../components/button.module.css';

import icon_eye from '../../static/svg/icons/eye.svg';
import icon_cloud_upload from '../../static/svg/icons/cloud_upload.svg';
import icon_share from '../../static/svg/icons/share.svg';
import icon_edit from '../../static/svg/icons/edit.svg';
import icon_blank from '../../static/svg/icons/file_outline.svg';

const CMD_ICON_SIZE = '20px';
const SYM_FORK_OVERLAY = Symbol();
const SYM_SHARE_OVERLAY = Symbol();

const LazyEditor = React.lazy(() => import('../components/editor'));

type Props = {
    className?: string;
};

export const Explorer: React.FC<Props> = (props: Props) => {
    const setOverlay = useOverlaySetter();
    const session = useWorkflowSession();
    const sessionState = useWorkflowSessionState();
    const scriptRegistry = useScriptRegistry();
    const modifyScriptRegistry = useScriptRegistryDispatch();
    const editorReadOnly = false;

    const showShareDialog = React.useCallback(() => {
        const share: React.FC = () => <ShareDialog onClose={() => setOverlay(null)} />;
        setOverlay({
            id: SYM_SHARE_OVERLAY,
            renderer: share,
        });
    }, [setOverlay]);

    const BoardCommandBar = () => (
        <div className={styles.board_cmdbar}>
            <div />
            <div className={styles_cmd.buttonset}>
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

    const createBlankScript = React.useCallback(() => {
        const script = generateBlankScript(scriptRegistry);
        modifyScriptRegistry({
            type: SAVE_SCRIPT,
            data: script,
        });
        session.updateProgram('', script.metadata);
    }, [setOverlay]);

    return (
        <OverlayContainer id={SYM_FORK_OVERLAY}>
            <OverlayContainer id={SYM_SHARE_OVERLAY}>
                <div className={styles.explorer}>
                    <AnimatePresence>
                        <div key="program_page" className={styles.program_page}>
                            <div className={styles.program_info_and_actions}>
                                <ProgramHeader className={styles.program_info} script={sessionState.scriptMetadata} />
                                <div className={cn(styles_cmd.buttonset, styles.program_actions)}>
                                    {false && (
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
                                    )}
                                    <Button
                                        className={styles.program_action}
                                        width={CMD_ICON_SIZE}
                                        height={CMD_ICON_SIZE}
                                        icon={icon_blank}
                                        onClick={createBlankScript}
                                    />
                                </div>
                            </div>
                            <Routes>
                                <Route
                                    path="/"
                                    element={
                                        <LazyLoader>
                                            <LazyEditor readOnly={editorReadOnly} />
                                        </LazyLoader>
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
                                            <BoardEditor
                                                immutable={false}
                                                scaleFactor={1.0}
                                                className={styles.board_editor}
                                            />
                                        </div>
                                    </>
                                }
                            />
                        </Routes>
                    </AnimatePresence>
                </div>
            </OverlayContainer>
        </OverlayContainer>
    );
};
