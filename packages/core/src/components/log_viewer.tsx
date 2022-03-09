import * as React from 'react';
import * as model from '../model';
import * as utils from '../utils';
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

export const LogViewer: React.FC<Props> = (props: Props) => {
    const [focused, setFocused] = React.useState<number | null>(null);
    const log = model.useLogState();

    React.useEffect(() => props.updateCurrentTime(), [log.entries]);

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        let nextEntry = focused || 0;
        switch (event.key) {
            case 'Down':
            case 'ArrowDown':
                nextEntry = Math.min(nextEntry + 1, Math.max(log.entries.size - 1, 0));
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
        setFocused((focused != entry ? parseInt(entry) : null) ?? null);
    };

    const renderRow = (rowProps: ListRowProps) => {
        const logEntry = log.entries.get(rowProps.index);
        if (!logEntry) return <div style={rowProps.style} />;
        const tsNow = props.currentTime;
        const tsLog = logEntry.timestamp;
        return (
            <div
                key={rowProps.key}
                style={rowProps.style}
                className={styles.row_container}
                data-entry={rowProps.index}
                onClick={focusEntry}
            >
                <div className={classNames(styles.row, { [styles.row_focused]: rowProps.index == focused })}>
                    <div className={styles.row_level}>{model.getLogLevelLabel(logEntry.level)}</div>
                    <div className={styles.row_origin}>{model.getLogOriginLabel(logEntry.origin)}</div>
                    <div className={styles.row_topic}>{model.getLogTopicLabel(logEntry.topic)}</div>
                    <div className={styles.row_event}>{model.getLogEventLabel(logEntry.event)}</div>
                    <div className={styles.row_timestamp}>{utils.getRelativeTime(tsLog, tsNow)}</div>
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
                            {log.entries.get(focused)?.value.toString()}
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
                                    width={width || 150}
                                    height={height || 100}
                                    overscanRowCount={OVERSCAN_ROW_COUNT}
                                    rowCount={log.entries.size}
                                    rowHeight={32}
                                    rowRenderer={renderRow}
                                    noRowsRenderer={renderEmptyList}
                                    measureAllRows={true}
                                    scrollToIndex={focused || undefined}
                                />
                            </>
                        )}
                    </AutoSizer>
                </div>
            </div>
        </SystemCard>
    );
};

export const RefreshingLogViewer = withCurrentTime(LogViewer, 5000);
