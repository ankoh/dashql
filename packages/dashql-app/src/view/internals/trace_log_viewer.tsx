import * as React from 'react';
import * as styles from './log_viewer.module.css';

import { List, useListRef } from 'react-window';

import { LogRecord } from '../../platform/logger/log_buffer.js';
import { pollLogVersion, useLogger } from '../../platform/logger/logger_provider.js';
import { observeSize } from '../foundations/size_observer.js';
import { AnchorAlignment, AnchorSide } from '../foundations/anchored_position.js';
import { useKeyEvents } from '../../utils/key_events.js';
import { LogJsonModal } from './log_json_modal.js';
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

    // Track which log record to show in JSON modal (record and index as tuple)
    const [jsonModalState, setJsonModalState] = React.useState<[LogRecord | null, number]>([null, -1]);
    const [jsonModalRecord, jsonModalRecordIndex] = jsonModalState;

    // Close the modal
    const closeJsonModal = React.useCallback(() => {
        setJsonModalState([null, -1]);
    }, []);

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

    // Helper to show JSON modal for a log record
    const showJsonRecord = React.useCallback((rowIndex: number) => {
        let record: LogRecord | null;
        if (props.traceId !== undefined) {
            record = filteredLogs[rowIndex] ?? null;
        } else {
            record = logger.buffer.at(rowIndex);
        }
        if (record) {
            setJsonModalState([record, rowIndex]);
        }
    }, [props.traceId, filteredLogs, logger]);

    // Navigate to previous log record
    const showPreviousRecord = React.useCallback(() => {
        if (jsonModalRecordIndex <= 0) return;
        showJsonRecord(jsonModalRecordIndex - 1);
    }, [jsonModalRecordIndex, showJsonRecord]);

    // Navigate to next log record
    const showNextRecord = React.useCallback(() => {
        const maxIndex = props.traceId !== undefined ? filteredLogs.length - 1 : logger.buffer.length - 1;
        if (jsonModalRecordIndex >= maxIndex) return;
        showJsonRecord(jsonModalRecordIndex + 1);
    }, [jsonModalRecordIndex, showJsonRecord, props.traceId, filteredLogs, logger]);

    // Keyboard navigation when modal is open
    useKeyEvents(
        jsonModalRecord
            ? [
                {
                    key: 'ArrowUp',
                    callback: (e: KeyboardEvent) => {
                        e.preventDefault();
                        e.stopPropagation();
                        showPreviousRecord();
                    },
                },
                {
                    key: 'ArrowDown',
                    callback: (e: KeyboardEvent) => {
                        e.preventDefault();
                        e.stopPropagation();
                        showNextRecord();
                    },
                },
            ]
            : []
    );

    // Scroll to the selected row when it changes
    React.useEffect(() => {
        if (jsonModalRecordIndex >= 0 && listRef.current) {
            listRef.current.scrollToRow({
                index: jsonModalRecordIndex,
                align: 'center',
            });
        }
    }, [jsonModalRecordIndex]);

    // Row props
    const rowProps = React.useMemo<LogRowProps>(() => ({
        logger,
        showJsonRecord,
        selectedRecordIndex: jsonModalRecordIndex,
        filteredLogs: props.traceId !== undefined ? filteredLogs : undefined,
    }), [logger, showJsonRecord, jsonModalRecordIndex, props.traceId, filteredLogs]);

    // Determine row count
    const rowCount = props.traceId !== undefined ? filteredLogs.length : logger.buffer.length;

    return (
        <>
            <div className={styles.log_grid_container} ref={containerRef} style={{ height: containerHeight, position: 'relative' }}>
                <List
                    listRef={listRef}
                    style={{ width: containerWidth, height: containerHeight }}
                    rowCount={rowCount}
                    rowHeight={computeLogRowHeight}
                    rowComponent={LogRow}
                    rowProps={rowProps}
                />
            </div>
            <LogJsonModal
                record={jsonModalRecord}
                recordIndex={jsonModalRecordIndex}
                maxIndex={props.traceId !== undefined ? filteredLogs.length - 1 : logger.buffer.length - 1}
                anchorRef={containerRef}
                align={AnchorAlignment.Start}
                side={AnchorSide.OutsideLeft}
                onClose={closeJsonModal}
                onPrevious={showPreviousRecord}
                onNext={showNextRecord}
            />
        </>
    );
}
