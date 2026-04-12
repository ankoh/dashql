import * as React from 'react';
import * as styles from './log_viewer.module.css';
import symbols from '@ankoh/dashql-svg-symbols';

import { List, useListRef } from 'react-window';
import type { RowComponentProps } from 'react-window';
import { XIcon } from '@primer/octicons-react';

import { getLogLevelName, LogRecord } from '../../platform/logger/log_buffer.js';
import { pollLogVersion, useLogger } from '../../platform/logger/logger_provider.js';
import { observeSize } from '../foundations/size_observer.js';
import { ButtonVariant, IconButton } from '../foundations/button.js';

export const ROW_HEIGHT = 32;

// Height calculation constants - applied as inline styles to ensure consistency
export const DETAILS_PADDING_TOP = 4;
export const DETAILS_PADDING_BOTTOM = 12;
export const DETAILS_PADDING_LEFT = 36;
export const DETAILS_PADDING_RIGHT = 4;
export const DETAIL_ROW_HEIGHT = 12;
export const DETAIL_ROW_GAP = 4;

// Computed height values
export const ROW_HEIGHT_EXPANDED_PADDING = DETAILS_PADDING_TOP + DETAILS_PADDING_BOTTOM;
export const ROW_HEIGHT_DETAIL_ROW = DETAIL_ROW_HEIGHT + DETAIL_ROW_GAP;

/// Compute the height of a log row, taking into account whether it's expanded
/// @param row The row index
/// @param expandedRows Set of expanded row indices
/// @param getRecord Function to retrieve the LogRecord at the given index
/// @returns The computed height in pixels
export function computeLogRowHeight(
    row: number,
    expandedRows: Set<number>,
    getRecord: (row: number) => LogRecord | null
): number {
    if (!expandedRows.has(row)) {
        return ROW_HEIGHT;
    }

    const record = getRecord(row);
    if (record == null) {
        return ROW_HEIGHT;
    }

    const keyCount = Object.keys(record.keyValues).length;
    const contextRowCount = record.context ? 1 : 0;
    const traceRowCount = record.tracing ? (record.tracing.parentSpanId ? 3 : 2) : 0;
    const totalRowCount = contextRowCount + traceRowCount + keyCount;

    // If no expanded content, return base height
    if (totalRowCount === 0) {
        return ROW_HEIGHT;
    }

    let height = ROW_HEIGHT;
    // Add padding for details container
    height += ROW_HEIGHT_EXPANDED_PADDING;
    // Add height for all detail rows (context + trace + key-values)
    height += totalRowCount * ROW_HEIGHT_DETAIL_ROW;

    return height;
}

export interface LogRowProps {
    logger: ReturnType<typeof useLogger>;
    expandedRows: React.RefObject<Set<number>>;
    expandedVersion: number;
    toggleLogRowDetails: React.MouseEventHandler;
    filteredLogs?: LogRecord[];
}

export const LogRow = (props: RowComponentProps<LogRowProps>) => {
    const { logger, expandedRows, toggleLogRowDetails, filteredLogs } = props;
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
    const expanded = expandedRows.current?.has(rowIndex) ?? false;
    const keyCount = Object.keys(record.keyValues).length;

    return (
        <div
            className={styles.log_row}
            style={props.style}
            onClick={toggleLogRowDetails}
            data-row={rowIndex}
        >
            {/* Main row content - uses CSS grid for column alignment */}
            <div className={styles.log_row_main}>
                {/* Expand button */}
                <div className={styles.log_cell_expand}>
                    {(keyCount > 0 || record.tracing || record.context) && (
                        <svg width="14px" height="14px">
                            <use xlinkHref={`${symbols}#${expanded ? "chevron_up_16" : "chevron_down_16"}`} />
                        </svg>
                    )}
                </div>

                {/* Timestamp */}
                <div className={styles.log_cell_timestamp}>
                    {(new Date(record.timestamp)).toLocaleTimeString('en-GB', { hour12: false })}
                </div>

                {/* Level */}
                <div className={styles.log_cell_level}>
                    {getLogLevelName(record.level)}
                </div>

                {/* Target */}
                <div className={styles.log_cell_target}>
                    {record.target}
                </div>

                {/* Message */}
                <div className={styles.log_cell_message}>
                    {record.message}
                </div>
            </div>

            {/* Expanded details - full width */}
            {expanded && (record.context || record.tracing || keyCount > 0) && (() => {
                // Calculate total row count (context + trace entries + key-value entries)
                const contextRowCount = record.context ? 1 : 0;
                const traceRowCount = record.tracing ? (record.tracing.parentSpanId ? 3 : 2) : 0;
                const totalRowCount = contextRowCount + traceRowCount + keyCount;

                return (
                    <div
                        className={styles.log_row_details}
                        style={{
                            paddingTop: `${DETAILS_PADDING_TOP}px`,
                            paddingRight: `${DETAILS_PADDING_RIGHT}px`,
                            paddingBottom: `${DETAILS_PADDING_BOTTOM}px`,
                            paddingLeft: `${DETAILS_PADDING_LEFT}px`,
                        }}
                    >
                        <div
                            className={styles.cell_details}
                            style={{
                                gridTemplateRows: `repeat(${totalRowCount}, ${DETAIL_ROW_HEIGHT}px)`,
                                rowGap: `${DETAIL_ROW_GAP}px`,
                                alignItems: 'start',
                            }}
                        >
                            {/* Context information rendered first */}
                            {record.context && (
                                <>
                                    <span className={styles.cell_details_key_context}>Context</span>
                                    <span className={styles.cell_details_value}>{record.context}</span>
                                </>
                            )}

                            {/* Trace information rendered as key-value pairs */}
                            {record.tracing && (
                                <>
                                    <span className={styles.cell_details_key_trace}>Trace</span>
                                    <span className={styles.cell_details_value}>{record.tracing.traceId}</span>
                                    <span className={styles.cell_details_key_trace}>Span</span>
                                    <span className={styles.cell_details_value}>{record.tracing.spanId}</span>
                                    {record.tracing.parentSpanId && (
                                        <>
                                            <span className={styles.cell_details_key_trace}>ParentSpan</span>
                                            <span className={styles.cell_details_value}>{record.tracing.parentSpanId}</span>
                                        </>
                                    )}
                                </>
                            )}

                            {/* Regular key-value details */}
                            {Object.entries(record.keyValues).map(([k, v], i) => (
                                <React.Fragment key={i}>
                                    <span className={styles.cell_details_key}>{k}</span>
                                    <span className={styles.cell_details_value}>{v}</span>
                                </React.Fragment>
                            ))}
                        </div>
                    </div>
                );
            })()}
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

    // Helper to toggle the log row details
    // We use a version counter to signal to the List that row heights have changed.
    // In react-window v2, changing rowProps triggers a recalculation of row heights.
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
        // Increment version to trigger rowProps change, which causes List to recalculate row heights
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

    // Row props passed to the row component
    // expandedVersion is used to signal to the List that row heights have changed
    const rowProps = React.useMemo<LogRowProps>(() => ({
        logger,
        expandedRows,
        expandedVersion,
        toggleLogRowDetails,
        filteredLogs: props.traceId !== undefined ? filteredLogs : undefined,
    }), [logger, expandedRows, expandedVersion, toggleLogRowDetails, props.traceId, filteredLogs]);

    // Determine row count based on whether we're filtering by trace
    const rowCount = props.traceId !== undefined ? filteredLogs.length : logger.buffer.length;

    return (
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
                    rowHeight={getRowHeight}
                    rowComponent={LogRow}
                    rowProps={rowProps}
                />
            </div>
        </div>
    );
}
