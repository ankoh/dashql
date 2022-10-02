import * as React from 'react';
import styles from './viewer.module.css';
import { Button, HoverMode, LinkButton } from '../components/button';
import { observeSize } from '../utils/size_observer';
import { Board } from '../components/board';
import { OverlayContainer, useOverlaySetter } from '../components/overlay';
import { ShareDialog } from '../components/share_dialog';
import { ProgramHeader } from '../components/program_header';
import { useWorkflowSessionState } from '../backend/workflow_session';

import icon_code from '../../static/svg/icons/code.svg';
import icon_star_outline from '../../static/svg/icons/star_outline.svg';
import icon_share from '../../static/svg/icons/share.svg';
import { ScriptOriginType } from '../model';

const CMD_ICON_SIZE = '20px';
const shareOverlay = Symbol();

interface Props {
    className?: string;
}

export const Viewer: React.FC<Props> = () => {
    const setOverlay = useOverlaySetter();
    const showShareDialog = React.useCallback(() => {
        const share: React.FC = () => <ShareDialog onClose={() => setOverlay(null)} />;
        setOverlay({
            id: shareOverlay,
            renderer: share,
        });
    }, [setOverlay]);
    const sessionState = useWorkflowSessionState();
    const rowHeight = 40;
    const columnCount = 12;
    const padding: [number, number] = [20, 4];
    const margin: [number, number] = [10, 10];

    const boardElement = React.useRef(null);
    const boardSize = observeSize(boardElement);

    let scriptMetadata = sessionState.scriptMetadata;
    return (
        <OverlayContainer id={shareOverlay} className={styles.overlay}>
            <div className={styles.container}>
                <div className={styles.header_anchor}>
                    <div className={styles.header}>
                        <ProgramHeader script={scriptMetadata} />
                    </div>
                    <div className={styles.cmdbar}>
                        {scriptMetadata.origin.originType == ScriptOriginType.GITHUB_GIST && (
                            <Button className={styles.cmdbutton} hover={HoverMode.Lighten} invert>
                                <svg width={CMD_ICON_SIZE} height={CMD_ICON_SIZE}>
                                    <use xlinkHref={`${icon_star_outline}#sym`} />
                                </svg>
                            </Button>
                        )}
                        <Button className={styles.cmdbutton} hover={HoverMode.Lighten} invert onClick={showShareDialog}>
                            <svg width={CMD_ICON_SIZE} height={CMD_ICON_SIZE}>
                                <use xlinkHref={`${icon_share}#sym`} />
                            </svg>
                        </Button>
                        <LinkButton className={styles.cmdbutton} hover={HoverMode.Lighten} invert to="/explorer">
                            <svg width={CMD_ICON_SIZE} height={CMD_ICON_SIZE}>
                                <use xlinkHref={`${icon_code}#sym`} />
                            </svg>
                        </LinkButton>
                    </div>
                </div>
                <div ref={boardElement} className={styles.board}>
                    {boardSize && (
                        <Board
                            className={styles.board_layout}
                            width={boardSize.width}
                            rowHeight={rowHeight}
                            columnCount={columnCount}
                            containerPadding={padding}
                            elementMargin={margin}
                        />
                    )}
                </div>
            </div>
        </OverlayContainer>
    );
};
