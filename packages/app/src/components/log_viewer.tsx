import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';
import { SystemCard } from './system_card';
import { withCurrentTime } from './current_time';
import { List, ListRowProps, AutoSizer } from 'react-virtualized';
import { motion, AnimateSharedLayout, AnimatePresence } from 'framer-motion';

import styles from './log_viewer.module.css';

const OVERSCAN_ROW_COUNT = 5;

interface Props {
    className?: string;
    logs: Immutable.List<core.model.LogEntryVariant>;
    currentTime: Date;
    updateCurrentTime: () => void;
    onClose: () => void;
}

interface State {
    focusedEntry: number | null;
}

class LogViewer extends React.Component<Props, State> {
    protected _renderRow = this.renderRow.bind(this);
    protected _renderEmptyList = this.renderEmptyList.bind(this);
    protected _focusEntry = this.focusEntry.bind(this);

    constructor(props: Props) {
        super(props);
        this.state = {
            focusedEntry: null,
        };
    }

    protected focusEntry(elem: React.MouseEvent<HTMLDivElement>) {
        const entry = (elem.currentTarget as any).dataset.entry;
        this.setState({
            ...this.state,
            focusedEntry: entry || null,
        });
    }

    protected renderRow(props: ListRowProps) {
        const log = this.props.logs.get(props.index);
        if (!log) return <div style={props.style} />;
        const tsNow = this.props.currentTime;
        const tsLog = log.timestamp;
        return (
            <motion.div
                key={props.key}
                style={props.style}
                className={styles.row}
                data-entry={props.index}
                onClick={this._focusEntry}
            >
                <motion.div className={styles.level}>{core.model.getLogLevelLabel(log.level)}</motion.div>
                <motion.div className={styles.origin}>{core.model.getLogOriginLabel(log.origin)}</motion.div>
                <motion.div className={styles.topic}>{core.model.getLogTopicLabel(log.topic)}</motion.div>
                <motion.div className={styles.event}>{core.model.getLogEventLabel(log.event)}</motion.div>
                <motion.div className={styles.timestamp}>{core.utils.getRelativeTime(tsLog, tsNow)}</motion.div>
            </motion.div>
        );
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

    public renderFocusedEntry(): React.ReactElement {
        return <div />;
    }

    public render() {
        return (
            <SystemCard title="Log" onClose={this.props.onClose} className={this.props.className}>
                <AnimateSharedLayout type="crossfade">
                    <AutoSizer>{({ width, height }) => this.renderList(width, height)}</AutoSizer>
                    <AnimatePresence>{this.state.focusedEntry && this.renderFocusedEntry()}</AnimatePresence>
                </AnimateSharedLayout>
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
