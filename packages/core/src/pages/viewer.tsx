import * as React from 'react';
import styles from './viewer.module.css';
import styles_cmd from '../components/cmdbar.module.css';
import { AutoSizer } from '../utils/autosizer';
import { Board, ScriptLoader } from '../components';
import { Link } from 'react-router-dom';
import { Scrollbars } from 'rc-scrollbars';

import icon_code from '../../static/svg/icons/code.svg';
import icon_star_outline from '../../static/svg/icons/star_outline.svg';
import icon_share from '../../static/svg/icons/share.svg';

interface Props {
    className?: string;
}

export const Viewer: React.FC<Props> = () => {
    const rowHeight = 48;
    const columnCount = 12;
    const padding: [number, number] = [40, 40];
    const margin: [number, number] = [10, 10];
    return (
        <ScriptLoader>
            <div className={styles.container}>
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
                        <div className={styles_cmd.cmdbar_cmd}>
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
            </div>
        </ScriptLoader>
    );
};
