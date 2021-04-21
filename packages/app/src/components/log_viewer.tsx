import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';
import { SystemCard } from './system_card';
import { withCurrentTime } from './current_time';
import { List, ListRowProps, AutoSizer } from 'react-virtualized';
import { motion } from 'framer-motion';

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
        <motion.div className={styles.row} style={props.style}>
            <motion.div className={styles.level}>{core.model.getLogLevelLabel(props.entry.level)}</motion.div>
            <motion.div className={styles.origin}>{core.model.getLogOriginLabel(props.entry.origin)}</motion.div>
            <motion.div className={styles.topic}>{core.model.getLogTopicLabel(props.entry.topic)}</motion.div>
            <motion.div className={styles.event}>{core.model.getLogEventLabel(props.entry.event)}</motion.div>
            <motion.div className={styles.timestamp}>{core.utils.getRelativeTime(tsLog, tsNow)}</motion.div>
        </motion.div>
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
    protected _renderRow = this.renderRow.bind(this);
    protected _renderEmptyList = this.renderEmptyList.bind(this);

    constructor(props: Props) {
        super(props);
        this.state = {
            expanded: new Map(),
        };
    }

    protected renderRow(props: ListRowProps) {
        const log = this.props.logs.get(props.index);
        if (!log) return <div style={props.style} />;
        return <LogRow key={props.key} style={props.style} entry={log} currentTime={this.props.currentTime} />;
    }

    protected renderEmptyList() {
        return <div />;
    }

    public renderList(width: number, height: number): React.ReactElement {
        return (
            <List
                className={styles.list}
                currentTimeRef={this.props.currentTime}
                width={width}
                height={height}
                overscanRowCount={OVERSCAN_ROW_COUNT}
                rowCount={this.props.logs.size}
                rowHeight={32}
                rowRenderer={this._renderRow}
                noRowsRenderer={this._renderEmptyList}
                measureAllRows={true}
            />
        );
    }

    public render() {
        return (
            <SystemCard title="Log" onClose={this.props.onClose} className={this.props.className}>
                <AutoSizer>{({ width, height }) => this.renderList(width, height)}</AutoSizer>
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
