import * as React from 'react';
import * as styles from './log_viewer.module.css';

import { List, useListRef } from 'react-window';
import type { RowComponentProps } from 'react-window';
import { XIcon } from '@primer/octicons-react';

import { getLogLevelName, LogRecord } from '../../platform/logger/log_buffer.js';
import { pollLogVersion, useLogger } from '../../platform/logger/logger_provider.js';
import { observeSize } from '../foundations/size_observer.js';
import { ButtonVariant, IconButton } from '../foundations/button.js';
import { AnchorAlignment, AnchorSide } from '../foundations/anchored_position.js';
import { useKeyEvents } from '../../utils/key_events.js';
import { LogJsonModal } from './log_json_modal.js';

export const ROW_HEIGHT = 32;

export function computeLogRowHeight(): number {
    return ROW_HEIGHT;
}

export interface LogRowProps {
    logger: ReturnType<typeof useLogger>;
    showJsonRecord: (rowIndex: number) => void;
    selectedRecordIndex: number;
    filteredLogs?: LogRecord[];
}

export const LogRow = (props: RowComponentProps<LogRowProps>) => {
    const { logger, showJsonRecord, selectedRecordIndex, filteredLogs } = props;
    const rowIndex = props.index;

    // Use filtered logs if provided, otherwise use the full buffer
    let record: LogRecord | null;
    if (filteredLogs) {
        record = filteredLogs[rowIndex] ?? null;
    } else {
        if (rowIndex >= logger.buffer.length) {
            return <div style={props.style} />;
        }
        record = logger.buffer.at(rowIndex);
    }

    if (!record) {
        return <div style={props.style} />;
    }

    const isSelected = rowIndex === selectedRecordIndex;
    return (
        <div
            className={`${styles.log_row} ${isSelected ? styles.log_row_selected : ''}`}
            style={props.style}
            onClick={() => showJsonRecord(rowIndex)}
        >
            <div className={styles.log_row_main}>
                <div className={styles.log_cell_timestamp}>
                    {(new Date(record.timestamp)).toLocaleTimeString('en-GB', { hour12: false })}
                </div>
                <div className={styles.log_cell_level}>
                    {getLogLevelName(record.level)}
                </div>

                <div className={styles.log_cell_target} title={record.target}>
                    {record.target}
                </div>
                <div className={styles.log_cell_message} title={record.message}>
                    {record.message}
                </div>
            </div>
        </div>
    );
};

interface LogViewerProps {
    onClose: () => void;
    traceId?: number;
}

export const LogViewer: React.FC<LogViewerProps> = (props: LogViewerProps) => {
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
    const containerHeight = containerSize?.height ?? 100;

    // Redraw whenever the log version changes or filtered logs change
    const seenLogRows = React.useRef<number>(0);
    const listRef = useListRef(null);
    React.useEffect(() => {
        if (listRef.current) {
            const rowCount = props.traceId !== undefined ? filteredLogs.length : logger.buffer.length;
            seenLogRows.current = rowCount;

            // Scroll to last row
            listRef.current.scrollToRow({
                index: Math.max(rowCount, 1) - 1,
                align: 'end',
            });
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
                    capture: true,
                },
                {
                    key: 'ArrowDown',
                    callback: (e: KeyboardEvent) => {
                        e.preventDefault();
                        e.stopPropagation();
                        showNextRecord();
                    },
                    capture: true,
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

    // Row props passed to the row component
    const rowProps = React.useMemo<LogRowProps>(() => ({
        logger,
        showJsonRecord,
        selectedRecordIndex: jsonModalRecordIndex,
        filteredLogs: props.traceId !== undefined ? filteredLogs : undefined,
    }), [logger, showJsonRecord, jsonModalRecordIndex, props.traceId, filteredLogs]);

    // Determine row count based on whether we're filtering by trace
    const rowCount = props.traceId !== undefined ? filteredLogs.length : logger.buffer.length;

    return (
        <>
            <div className={styles.overlay}>
                <div className={styles.header_container}>
                    <div className={styles.header_left_container}>
                        <div className={styles.title}>
                            {props.traceId !== undefined ? `Logs (Trace ${props.traceId})` : 'Logs'}
                        </div>
                    </div>
                    <div className={styles.header_right_container}>
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            aria-label="Close"
                            onClick={props.onClose}
                        >
                            <XIcon />
                        </IconButton>
                    </div>
                </div>
                <div className={styles.log_grid_container} ref={containerRef}>
                    <List
                        listRef={listRef}
                        style={{ width: containerWidth, height: containerHeight }}
                        rowCount={rowCount}
                        rowHeight={computeLogRowHeight}
                        rowComponent={LogRow}
                        rowProps={rowProps}
                    />
                </div>
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
