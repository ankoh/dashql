import * as Immutable from 'immutable';
import * as React from 'react';
import * as webdb from '@dashql/webdb';
import * as core from '@dashql/core';
import { proto } from '@dashql/core';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';
import { SystemCard } from './system_card';
import { withCurrentTime } from './current_time';
import { ActionStatusIndicator } from './status';
import { ChevronRightIcon, CloseIcon } from '../svg/icons';
import { List, ListRowProps, AutoSizer } from 'react-virtualized';
import classnames from 'classnames';

import styles from './log_viewer.module.css';

import CLO = core.model.LogOrigin;
import WLO = webdb.LogOrigin;

const OVERSCAN_ROW_COUNT = 5;

interface LogRowProps {
    style: React.CSSProperties;
    entry: core.model.LogEntryVariant;
    currentTime: Date;
}

function LogRow(props: LogRowProps) {
    const tsNow = props.currentTime;
    const tsLog = props.entry.timestamp;
    return (
        <div className={styles.row}>
            <div className={styles.origin}>
                {core.model.getLogOriginLabel(props.entry.origin)}
            </div>
            <div className={styles.topic}>
                {core.model.getLogTopicLabel(props.entry.topic)}
            </div>
            <div className={styles.event}>
                {core.model.getLogEventLabel(props.entry.event)}
            </div>
            <div className={styles.timestamp}>
                {core.utils.getRelativeTime(tsLog, tsNow)}
            </div>
        </div>
    );
}

interface Props {
    className?: string;
    logs: Immutable.List<core.model.LogEntryVariant>;
    currentTime: Date;
    onClose: () => void;
}

class LogViewer extends React.Component<Props> {
    protected _getRowHeight = this.getRowHeight.bind(this);
    protected _renderRow = this.renderRow.bind(this);
    protected _renderEmptyList = this.renderEmptyList.bind(this);

    protected getRowHeight(args: {index: number}) {
        return 42;
    }

    protected renderRow(props: ListRowProps) {
        const log = this.props.logs.get(props.index);
        if (!log) return <div />;
        return (
            <LogRow key={props.index} style={props.style} entry={log} currentTime={this.props.currentTime} />
        );
    }

    protected renderEmptyList() {
        return <div />;
    }

    public render() {
        const height = 200;
        return (
            <SystemCard title="Log" subtitle="Foo" onClose={this.props.onClose}>
                <AutoSizer disableHeight>
                    {({width}) => (
                        <List
                            className={styles.list}
                            currentTimeRef={this.props.currentTime}
                            height={200}
                            width={width}
                            overscanRowCount={OVERSCAN_ROW_COUNT}
                            rowCount={this.props.logs.size}
                            rowHeight={this._getRowHeight}
                            rowRenderer={this._renderRow}
                            noRowsRenderer={this._renderEmptyList}
                        />
                    )}
                </AutoSizer>
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

export default connect(mapStateToProps, mapDispatchToProps)(withCurrentTime(LogViewer, 5000));
