import * as React from 'react';
import cn from 'classnames';
import { AnimatePresence } from 'framer-motion';
import { Route, Routes } from 'react-router-dom';
import { ScriptOriginType, useAppConfig } from '../model';
import { OverlayContainer, useOverlaySetter } from '../components/overlay';
import { LazyLoader } from '../components/lazy_loader';
import { BoardEditor } from '../components/board_editor';
import { Button, LinkButton } from '../components/button';
import { ShareDialog } from '../components/share_dialog';

import styles from './explorer.module.css';
import styles_cmd from '../components/button.module.css';

import icon_eye from '../../static/svg/icons/eye.svg';
import icon_cloud_upload from '../../static/svg/icons/cloud_upload.svg';
import icon_fork from '../../static/svg/icons/fork.svg';
import icon_share from '../../static/svg/icons/share.svg';
import icon_star_outline from '../../static/svg/icons/star_outline.svg';
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
    const appConfig = useAppConfig();
    const editorReadOnly = false;
    const setOverlay = useOverlaySetter();

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

    return (
        <div className={styles.explorer}>
            <AnimatePresence>
                <div key="program_page" className={styles.program_page}>
                    <div className={styles.program_info_and_actions}></div>
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
