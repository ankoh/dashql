import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import classNames from 'classnames';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';
import { SystemCard } from './system_card';
import { withCurrentTime } from './current_time';
import { List, ListRowProps, AutoSizer } from 'react-virtualized';
import { motion, AnimatePresence } from 'framer-motion';

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
            focusedEntry: (this.state.focusedEntry != entry ? entry : null) || null,
        });
    }

    protected renderRow(props: ListRowProps) {
        const log = this.props.logs.get(props.index);
        if (!log) return <div style={props.style} />;
        const tsNow = this.props.currentTime;
        const tsLog = log.timestamp;
        return (
            <div
                key={props.key}
                style={props.style}
                className={styles.row_container}
                data-entry={props.index}
                onClick={this._focusEntry}
            >
                <div
                    className={classNames(styles.row, { [styles.row_focused]: props.index == this.state.focusedEntry })}
                >
                    <div className={styles.row_level}>{core.model.getLogLevelLabel(log.level)}</div>
                    <div className={styles.row_origin}>{core.model.getLogOriginLabel(log.origin)}</div>
                    <div className={styles.row_topic}>{core.model.getLogTopicLabel(log.topic)}</div>
                    <div className={styles.row_event}>{core.model.getLogEventLabel(log.event)}</div>
                    <div className={styles.row_timestamp}>{core.utils.getRelativeTime(tsLog, tsNow)}</div>
                </div>
            </div>
        );
    }

    protected renderEmptyList() {
        return <div />;
    }

    public render() {
        return (
            <SystemCard title="Log" onClose={this.props.onClose} className={this.props.className}>
                <div className={styles.content}>
                    {this.state.focusedEntry != null && (
                        <AnimatePresence>
                            <motion.div
                                className={styles.detail_container}
                                initial={{ height: 0 }}
                                animate={{ height: 'auto' }}
                                exit={{ height: 0 }}
                            >
                                {this.props.logs.get(this.state.focusedEntry)?.value}
                            </motion.div>
                        </AnimatePresence>
                    )}
                    <div className={styles.list_container}>
                        <AutoSizer>
                            {({ width, height }) => (
                                <>
                                    <List
                                        className={styles.list}
                                        currentTimeRef={this.props.currentTime}
                                        focusedEntry={this.state.focusedEntry}
                                        width={width}
                                        height={height}
                                        overscanRowCount={OVERSCAN_ROW_COUNT}
                                        rowCount={this.props.logs.size}
                                        rowHeight={32}
                                        rowRenderer={this._renderRow}
                                        noRowsRenderer={this._renderEmptyList}
                                        measureAllRows={true}
                                    />
                                </>
                            )}
                        </AutoSizer>
                    </div>
                </div>
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
