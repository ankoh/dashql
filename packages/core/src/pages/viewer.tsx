import * as React from 'react';
import styles from './viewer.module.css';
import styles_cmd from '../components/button.module.css';
import { AutoSizer } from '../utils/autosizer';
import { Board, OverlayContainer, ScriptNotFound, ShareDialog, useOverlaySetter, ProgramHeader } from '../components';
import { Link } from 'react-router-dom';

import icon_code from '../../static/svg/icons/code.svg';
import icon_star_outline from '../../static/svg/icons/star_outline.svg';
import icon_share from '../../static/svg/icons/share.svg';
import { ScriptOriginType, useProgramContext } from '../model';

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
    const programCtx = useProgramContext();
    const rowHeight = 48;
    const columnCount = 12;
    const padding: [number, number] = [20, 4];
    const margin: [number, number] = [10, 10];

    if (!programCtx.script) {
        return <ScriptNotFound />;
    }
    return (
        <div className={styles.container}>
            <div className={styles.header_anchor}>
                <div className={styles.header}>
                    <ProgramHeader script={programCtx.script} />
                </div>
                <div className={styles.cmdbar}>
                    {programCtx.script.origin.originType == ScriptOriginType.GITHUB_GIST && (
                        <div className={styles_cmd.button}>
                            <svg width="20px" height="20px">
                                <use xlinkHref={`${icon_star_outline}#sym`} />
                            </svg>
                        </div>
                    )}
                    <div className={styles_cmd.button} onClick={showShareDialog}>
                        <svg width="20px" height="20px">
                            <use xlinkHref={`${icon_share}#sym`} />
                        </svg>
                    </div>
                    <Link to="/explorer" className={styles_cmd.button}>
                        <svg width="20px" height="20px">
                            <use xlinkHref={`${icon_code}#sym`} />
                        </svg>
                    </Link>
                </div>
            </div>
            <div className={styles.board}>
                <AutoSizer disableHeight>
                    {({ width }) => (
                        <Board
                            className={styles.board_layout}
                            width={width}
                            rowHeight={rowHeight}
                            columnCount={columnCount}
                            containerPadding={padding}
                            elementMargin={margin}
                        />
                    )}
                </AutoSizer>
            </div>
            <OverlayContainer id={shareOverlay} className={styles.overlay} />
        </div>
    );
};
