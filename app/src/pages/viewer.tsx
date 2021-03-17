import * as React from 'react';
import * as core from '@dashql/core';
import { Board, BoardCommandBar } from '../components';
import { AppState, Dispatch } from '../model';
import { AutoSizer, withAutoSizer } from '../util/autosizer';
import { Scrollbars, positionValues } from 'react-custom-scrollbars';
import BoardLayout from '../components/board_layout';
import { connect } from 'react-redux';

import styles from './viewer.module.css';

interface Props {
    className?: string;
}

class Viewer extends React.Component<Props> {
    public render() {
        return (
            <div className={styles.container}>
                <div className={styles.board}>
                    <AutoSizer>
                        {({width, height}) =>
                            <div style={{width, height}}>
                                <Scrollbars height={height} width={width}>
                                    <BoardLayout className={styles.board_layout} width={width} />
                                </Scrollbars>
                            </div>
                        }
                    </AutoSizer>
                </div>
            </div>
        );
    }
}

const mapStateToProps = (state: AppState) => ({
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(Viewer);
