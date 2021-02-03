import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import { proto } from '@dashql/core';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';
import { ActionStatusIndicator } from './status';
import { ChevronRightIcon, CloseIcon } from '../svg/icons';
import styles from './log_viewer.module.css';

interface Props {
    className?: string;
    logs: Immutable.List<core.model.LogEntryVariant>;
    close: () => void;
}

class LogViewer extends React.Component<Props> {
    public render() {
        return (
            <div className={styles.log_viewer_panel}>
                <div className={styles.log_header}>
                    <div className={styles.log_header_title}>Log</div>
                    <div className={styles.log_header_subtitle}>started 20 ms ago</div>
                    <div className={styles.log_close} onClick={this.props.close}>
                        <CloseIcon width="20px" height="20px" />
                    </div>
                </div>
            </div>
        );
    }

    componentDidMount() {}

    componentDidUpdate(_prev: Readonly<Props>): void {}
}

const mapStateToProps = (state: AppState) => ({
    logs: state.core.logEntries,
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(LogViewer);
