import * as React from 'react';
import styles from './viewer.module.css';
import styles_cmd from '../components/cmdbar.module.css';
import { AutoSizer } from '../utils/autosizer';
import { Board, ScriptLoader, OverlayContainer, useOverlaySetter, ShareDialog } from '../components';
import { Link } from 'react-router-dom';
import { Scrollbars } from 'rc-scrollbars';

import logo from '../../static/svg/logo/logo.svg';
import icon_code from '../../static/svg/icons/code.svg';
import icon_star_outline from '../../static/svg/icons/star_outline.svg';
import icon_share from '../../static/svg/icons/share.svg';

const shareOverlay = Symbol();

interface Props {
    className?: string;
}

export const Viewer: React.FC<Props> = () => {
    const setOverlay = useOverlaySetter();
    const showShareDialog = React.useCallback(() => {
        const fork: React.FC = () => <ShareDialog onClose={() => setOverlay(null)} />;
        setOverlay({
            id: shareOverlay,
            renderer: fork,
        });
    }, [setOverlay]);
    const rowHeight = 48;
    const columnCount = 12;
    const padding: [number, number] = [40, 40];
    const margin: [number, number] = [10, 10];
    return (
        <div className={styles.container}>
            <div className={styles.logo}>
                <svg width="32px" height="32px">
                    <use xlinkHref={`${logo}#sym`} />
                </svg>
            </div>
            <ScriptLoader>
                <>
                    <div className={styles.board}>
                        <AutoSizer>
                            {({ width, height }) => (
                                <div style={{ width, height }}>
                                    <Scrollbars style={{ height, width }}>
                                        <Board
                                            className={styles.board_layout}
                                            width={width}
                                            rowHeight={rowHeight}
                                            columnCount={columnCount}
                                            containerPadding={padding}
                                            elementMargin={margin}
                                        />
                                    </Scrollbars>
                                </div>
                            )}
                        </AutoSizer>
                    </div>
                    <div className={styles.cmdbar}>
                        <div className={styles_cmd.cmdbar_cmdset}>
                            <div className={styles_cmd.cmdbar_cmd}>
                                <svg width="20px" height="20px">
                                    <use xlinkHref={`${icon_star_outline}#sym`} />
                                </svg>
                            </div>
                            <div className={styles_cmd.cmdbar_cmd} onClick={showShareDialog}>
                                <svg width="20px" height="20px">
                                    <use xlinkHref={`${icon_share}#sym`} />
                                </svg>
                            </div>
                            <Link to="/studio" className={styles_cmd.cmdbar_cmd}>
                                <svg width="20px" height="20px">
                                    <use xlinkHref={`${icon_code}#sym`} />
                                </svg>
                            </Link>
                        </div>
                    </div>
                    <OverlayContainer id={shareOverlay} className={styles.overlay} />
                </>
            </ScriptLoader>
        </div>
    );
};
