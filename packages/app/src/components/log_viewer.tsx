import * as React from 'react';
import * as core from '@dashql/core';
import classNames from 'classnames';
import { SystemCard } from './system_card';
import { withCurrentTime } from './current_time';
import { List, ListRowProps, AutoSizer } from 'react-virtualized';
import { motion, AnimatePresence } from 'framer-motion';

import styles from './log_viewer.module.css';

const OVERSCAN_ROW_COUNT = 5;

interface Props {
    className?: string;
    currentTime: Date;
    updateCurrentTime: () => void;
    onClose: () => void;
}

const InnerLogViewer: React.FC<Props> = (props: Props) => {
    const [focused, setFocused] = React.useState<number | null>(null);
    const logState = core.model.useLogState();
    React.useEffect(() => props.updateCurrentTime(), [logState.entries]);

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        let nextEntry = focused || 0;
        switch (event.key) {
            case 'Down':
            case 'ArrowDown':
                nextEntry = Math.min(nextEntry + 1, Math.max(logState.entries.size - 1, 0));
                break;
            case 'Up':
            case 'ArrowUp':
                nextEntry = Math.max(nextEntry, 1) - 1;
                break;
        }
        event.preventDefault();
        event.stopPropagation();
        setFocused(nextEntry);
    };

    const focusEntry = (elem: React.MouseEvent<HTMLDivElement>) => {
        const entry = (elem.currentTarget as any).dataset.entry;
        setFocused((focused != entry ? entry : null) || null);
    };

    const renderRow = (rowProps: ListRowProps) => {
        const log = logState.entries.get(rowProps.index);
        if (!log) return <div style={rowProps.style} />;
        const tsNow = props.currentTime;
        const tsLog = log.timestamp;
        return (
            <div
                key={rowProps.key}
                style={rowProps.style}
                className={styles.row_container}
                data-entry={rowProps.index}
                onClick={focusEntry}
            >
                <div className={classNames(styles.row, { [styles.row_focused]: rowProps.index == focused })}>
                    <div className={styles.row_level}>{core.model.getLogLevelLabel(log.level)}</div>
                    <div className={styles.row_origin}>{core.model.getLogOriginLabel(log.origin)}</div>
                    <div className={styles.row_topic}>{core.model.getLogTopicLabel(log.topic)}</div>
                    <div className={styles.row_event}>{core.model.getLogEventLabel(log.event)}</div>
                    <div className={styles.row_timestamp}>{core.utils.getRelativeTime(tsLog, tsNow)}</div>
                </div>
            </div>
        );
    };

    const renderEmptyList = () => {
        return <div />;
    };

    return (
        <SystemCard title="Log" onClose={props.onClose} className={props.className}>
            <div className={styles.content} onKeyDown={onKeyDown}>
                {focused != null && (
                    <AnimatePresence>
                        <motion.div
                            className={styles.detail_container}
                            initial={{ height: 0 }}
                            animate={{ height: 100 }}
                            exit={{ height: 0 }}
                        >
                            {logState.entries.get(focused)?.value.toString()}
                        </motion.div>
                    </AnimatePresence>
                )}
                <div className={styles.list_container}>
                    <AutoSizer>
                        {({ width, height }) => (
                            <>
                                <List
                                    className={styles.list}
                                    currentTimeRef={props.currentTime}
                                    focusedEntry={focused}
                                    width={width}
                                    height={height}
                                    overscanRowCount={OVERSCAN_ROW_COUNT}
                                    rowCount={logState.entries.size}
                                    rowHeight={32}
                                    rowRenderer={renderRow}
                                    noRowsRenderer={renderEmptyList}
                                    measureAllRows={true}
                                    scrollToIndex={focused || 0}
                                />
                            </>
                        )}
                    </AutoSizer>
                </div>
            </div>
        </SystemCard>
    );
};

export const LogViewer = withCurrentTime(InnerLogViewer, 5000);
