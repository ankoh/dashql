import * as Immutable from 'immutable';
import * as React from 'react';
import * as webdb from '@dashql/webdb';
import * as core from '@dashql/core';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';
import { SystemCard } from './system_card';
import { withCurrentTime } from './current_time';
import { List, ListRowProps, AutoSizer } from 'react-virtualized';

import icon_chevron_right from '../../static/svg/icons/chevron_right.svg';

import styles from './log_viewer.module.css';

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
            <div className={styles.expand}>
                <div className={styles.expand_icon}>
                    <svg width="18px" height="18px">
                        <use xlinkHref={`${icon_chevron_right}#sym`} />
                    </svg>
                </div>
            </div>
            <div className={styles.origin}>{core.model.getLogLevelLabel(props.entry.level)}</div>
            <div className={styles.origin}>{core.model.getLogOriginLabel(props.entry.origin)}</div>
            <div className={styles.topic}>{core.model.getLogTopicLabel(props.entry.topic)}</div>
            <div className={styles.event}>{core.model.getLogEventLabel(props.entry.event)}</div>
            <div className={styles.timestamp}>{core.utils.getRelativeTime(tsLog, tsNow)}</div>
        </div>
    );
}

interface Props {
    className?: string;
    logs: Immutable.List<core.model.LogEntryVariant>;
    currentTime: Date;
    updateCurrentTime: () => void;
    onClose: () => void;
}

class LogViewer extends React.Component<Props> {
    protected _getRowHeight = this.getRowHeight.bind(this);
    protected _renderRow = this.renderRow.bind(this);
    protected _renderEmptyList = this.renderEmptyList.bind(this);

    protected getRowHeight(args: { index: number }) {
        return 42;
    }

    protected renderRow(props: ListRowProps) {
        const log = this.props.logs.get(props.index);
        if (!log) return <div />;
        return <LogRow key={props.key} style={props.style} entry={log} currentTime={this.props.currentTime} />;
    }

    protected renderEmptyList() {
        return <div />;
    }

    public render() {
        const height = 200;
        return (
            <SystemCard title="Log" onClose={this.props.onClose}>
                <AutoSizer disableHeight>
                    {({ width }) => (
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

    componentDidUpdate(prevProps: Readonly<Props>): void {
        if (prevProps.logs !== this.props.logs) {
            this.props.updateCurrentTime();
        }
    }
}

const mapStateToProps = (state: AppState) => ({
    logs: state.core.logEntries,
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withCurrentTime(LogViewer, 5000));
