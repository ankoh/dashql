import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import { proto } from '@dashql/core';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';
import { SystemCard } from './system_card';
import { ActionStatusIndicator } from './status';
import { ChevronRightIcon, CloseIcon } from '../svg/icons';
import styles from './log_viewer.module.css';

interface Props {
    className?: string;
    logs: Immutable.List<core.model.LogEntryVariant>;
    onClose: () => void;
}

class LogViewer extends React.Component<Props> {
    public render() {
        return (
            <SystemCard title="Log" subtitle="Foo" onClose={this.props.onClose}>
            </SystemCard>
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
