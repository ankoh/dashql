import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import { proto } from '@dashql/core';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';
import { SystemCard } from './system_card';
import { withCurrentTime } from './current_time';
import { ActionStatusIndicator } from './status';
import { ChevronRightIcon, CloseIcon } from '../svg/icons';
import { List, ListRowProps, AutoSizer } from 'react-virtualized';
import styles from './log_viewer.module.css';

interface Props {
    onClose: () => void;
    currentTime: Date;
}

class DatabaseStats extends React.Component<Props> {
    public render() {
        const height = 200;
        return (
            <SystemCard title="Database" subtitle="Foo" onClose={this.props.onClose} />
        );
    }

    componentDidMount() {}

    componentDidUpdate(_prev: Readonly<Props>): void {}
}

const mapStateToProps = (state: AppState) => ({
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withCurrentTime(DatabaseStats, 5000));
