import * as React from 'react';
import * as styles from './log_viewer.module.css';

import { List, useListRef } from 'react-window';

import { LogRecord } from '../../platform/logger/log_buffer.js';
import { pollLogVersion, useLogger } from '../../platform/logger/logger_provider.js';
import { observeSize } from '../foundations/size_observer.js';
import {
    LogRow,
    LogRowProps,
    computeLogRowHeight,
} from './log_viewer.js';

interface TraceLogViewerProps {
    traceId?: number;
    height?: number;
}

export const TraceLogViewer: React.FC<TraceLogViewerProps> = (props: TraceLogViewerProps) => {
    const logger = useLogger();
    const logVersion = pollLogVersion(100);

    // Maintain filtered log records for trace-specific viewing
    const [filteredLogs, setFilteredLogs] = React.useState<LogRecord[]>([]);

    // Subscribe to trace-specific logs if traceId is provided
    React.useEffect(() => {
        if (props.traceId === undefined) {
            return;
        }

        // Get initial logs for this trace
        const initialLogs = logger.buffer.collectTraceLogs(props.traceId);
        setFilteredLogs(initialLogs);

        // Subscribe to new logs for this trace
        const observer = (record: LogRecord) => {
            setFilteredLogs(prev => [...prev, record]);
        };
        logger.buffer.subscribeTrace(props.traceId, observer);

        // Cleanup subscription
        return () => {
            logger.buffer.unsubscribeTrace(props.traceId!, observer);
        };
    }, [props.traceId, logger]);

    // Determine log container dimensions
    const containerRef = React.useRef<HTMLDivElement>(null);
    const containerSize = observeSize(containerRef);
    const containerWidth = containerSize?.width ?? 200;
    const containerHeight = props.height ?? 200;

    // Redraw whenever the log version changes or filtered logs change
    const seenLogRows = React.useRef<number>(0);
    const listRef = useListRef(null);
    React.useEffect(() => {
        if (listRef.current) {
            const rowCount = props.traceId !== undefined ? filteredLogs.length : logger.buffer.length;
            seenLogRows.current = rowCount;

            // Scroll to last row
            if (rowCount > 0) {
                listRef.current.scrollToRow({
                    index: rowCount - 1,
                    align: 'end',
                });
            }
        }
    }, [logVersion, containerHeight, filteredLogs, props.traceId, logger]);

    // Helper to toggle the log row details
    const expandedRows = React.useRef<Set<number>>(new Set());
    const [expandedVersion, setExpandedVersion] = React.useState(0);
    const toggleLogRowDetails: React.MouseEventHandler = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        const row = event.currentTarget.dataset.row;
        if (row === undefined) {
            return;
        }
        let rowIdx: number = +row;
        if (expandedRows.current.has(rowIdx)) {
            expandedRows.current.delete(rowIdx);
        } else {
            expandedRows.current.add(rowIdx);
        }
        // Increment version to trigger rowProps change
        setExpandedVersion(v => v + 1);
    }, []);

    // Helper to get the row height
    const getRowHeight = React.useCallback((row: number) => {
        const getRecord = (index: number): LogRecord | null => {
            if (props.traceId !== undefined) {
                return filteredLogs[index] ?? null;
            } else {
                return logger.buffer.at(index);
            }
        };
        return computeLogRowHeight(row, expandedRows.current, getRecord);
    }, [props.traceId, filteredLogs, logger]);

    // Row props
    const rowProps = React.useMemo<LogRowProps>(() => ({
        logger,
        expandedRows,
        expandedVersion,
        toggleLogRowDetails,
        filteredLogs: props.traceId !== undefined ? filteredLogs : undefined,
    }), [logger, expandedRows, expandedVersion, toggleLogRowDetails, props.traceId, filteredLogs]);

    // Determine row count
    const rowCount = props.traceId !== undefined ? filteredLogs.length : logger.buffer.length;

    return (
        <div className={styles.log_grid_container} ref={containerRef} style={{ height: containerHeight }}>
            <List
                listRef={listRef}
                style={{ width: containerWidth, height: containerHeight }}
                rowCount={rowCount}
                rowHeight={getRowHeight}
                rowComponent={LogRow}
                rowProps={rowProps}
            />
        </div>
    );
}
