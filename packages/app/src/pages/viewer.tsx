import * as React from 'react';
import logo from '../../static/svg/logo/logo_robot_grey.svg';
import styles from './viewer.module.css';
import styles_cmd from '../components/cmdbars.module.css';
import { AppState, Dispatch } from '../model';
import { AutoSizer } from '../util/autosizer';
import { Board, ScriptLoader } from '../components';
import { Link } from 'react-router-dom';
import { Scrollbars } from 'react-custom-scrollbars';
import { connect } from 'react-redux';

import icon_code from '../../static/svg/icons/code.svg';

interface Props {
    className?: string;
}

class Viewer extends React.Component<Props> {
    public render() {
        return (
            <ScriptLoader>
                <div className={styles.container}>
                    <div className={styles.brand}>
                        <div className={styles.brand_logo}>
                            <img src={logo} />
                        </div>
                        <div className={styles.brand_name}>DashQL</div>
                    </div>
                    <div className={styles.board}>
                        <AutoSizer>
                            {({ width, height }) => (
                                <div style={{ width, height }}>
                                    <Scrollbars height={height} width={width}>
                                        <Board className={styles.board_layout} width={width} />
                                    </Scrollbars>
                                </div>
                            )}
                        </AutoSizer>
                    </div>
                    <div className={styles.cmdbar}>
                        <Link to="/studio" className={styles_cmd.cmdbar_cmd}>
                            <svg width="20px" height="20px">
                                <use xlinkHref={`${icon_code}#sym`} />
                            </svg>
                        </Link>
                    </div>
                </div>
            </ScriptLoader>
        );
    }
}

const mapStateToProps = (state: AppState) => ({});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(Viewer);
