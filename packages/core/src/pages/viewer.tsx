import * as React from 'react';
import styles from './viewer.module.css';
import styles_cmd from '../components/cmd_bar.module.css';
import { AutoSizer } from '../utils/autosizer';
import { Board, OverlayContainer, ScriptNotFound, ShareDialog, SystemBar, useOverlaySetter } from '../components';
import { Link } from 'react-router-dom';
import { Scrollbars } from 'rc-scrollbars';

import logo from '../../static/svg/logo/logo.svg';
import icon_code from '../../static/svg/icons/code.svg';
import icon_star_outline from '../../static/svg/icons/star_outline.svg';
import icon_share from '../../static/svg/icons/share.svg';
import { ScriptOriginType, useProgramContext, getScriptNamespace, getScriptName } from '../model';

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
    const padding: [number, number] = [40, 4];
    const margin: [number, number] = [10, 10];

    const scriptNamespace = getScriptNamespace(programCtx.script);
    const scriptName = getScriptName(programCtx.script);

    if (!programCtx.script) {
        return <ScriptNotFound />;
    }
    return (
        <div className={styles.container}>
            <Link className={styles.logo} to="/">
                <svg width="32px" height="32px">
                    <use xlinkHref={`${logo}#sym`} />
                </svg>
            </Link>
            <div className={styles.body}>
                <div className={styles.header_container}>
                    <div className={styles.header}>
                        <div className={styles.program_info}>
                            <div className={styles.program_info_avatar}>
                                <div className={styles.program_info_avatar_icon}>
                                    <svg width="24px" height="24px">
                                        <use xlinkHref={`${logo}#sym`} />
                                    </svg>
                                </div>
                            </div>
                            <div className={styles.program_info_title}>
                                <span className={styles.program_info_title_namespace}>{scriptNamespace}</span>/
                                <span className={styles.program_info_title_name}>{scriptName}</span>
                            </div>
                            <div className={styles.program_info_description}>{programCtx.script.description}</div>
                        </div>
                    </div>
                </div>
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
            </div>
            <div className={styles.cmdbar}>
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
                    <Link to="/explorer" className={styles_cmd.cmdbar_cmd}>
                        <svg width="20px" height="20px">
                            <use xlinkHref={`${icon_code}#sym`} />
                        </svg>
                    </Link>
                </div>
            </div>
            <SystemBar className={styles.systembar} light={true} />
            <OverlayContainer id={shareOverlay} className={styles.overlay} />
        </div>
    );
};
