import * as React from 'react';
import * as core from '@dashql/core';
import logo from '../../public/logo_robot_grey.svg';
import styles from './viewer.module.css';
import styles_cmd from '../components/cmdbars.module.css';
import { AppState, Dispatch } from '../model';
import { AutoSizer } from '../util/autosizer';
import { Board, ScriptLoader } from '../components';
import { CodeIcon } from '../svg/icons';
import { Link } from 'react-router-dom';
import { Scrollbars } from 'react-custom-scrollbars';
import { connect } from 'react-redux';
import { RouteComponentProps, withRouter } from 'react-router';

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
                            <CodeIcon className={styles_cmd.cmdbar_icon} width={'20px'} height={'20px'} />
                        </Link>
                    </div>
                </div>
            </ScriptLoader>
        );
    }
}

const mapStateToProps = (state: AppState) => ({
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(Viewer);
