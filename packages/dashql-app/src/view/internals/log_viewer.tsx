import * as React from 'react';
import * as styles from './log_viewer.module.css';

import { VariableSizeGrid as Grid } from 'react-window';
import { XIcon } from '@primer/octicons-react';

import { useScrollbarWidth } from '../../utils/scrollbar.js';
import { LogLevel, LogRecord, getLogLevelName } from '../../platform/log_buffer.js';
import { pollLogVersion, useLogger } from '../../platform/logger_provider.js';
import { observeSize } from '../foundations/size_observer.js';
import { ButtonVariant, IconButton } from '../foundations/button.js';

interface LevelCellProps {
    level: LogLevel;
    style: React.CSSProperties;
    rowIndex: number;
    onClick: React.MouseEventHandler;
    expanded: boolean;
}
export const LevelCell: React.FC<LevelCellProps> = (props: LevelCellProps) => {
    const level = getLogLevelName(props.level);
    return (
        <div
            className={styles.cell}
            style={props.style}
            onClick={props.onClick}
            data-row={props.rowIndex}
        >
            <div className={styles.cell_level}>
                {level}
            </div>
        </div>
    );
}

interface TimestampCellProps {
    children: number;
    style: React.CSSProperties;
    rowIndex: number;
    onClick: React.MouseEventHandler;
    expanded: boolean;
}
export const TimestampCell: React.FC<TimestampCellProps> = (props: TimestampCellProps) => {
    return (
        <div
            className={styles.cell}
            style={props.style}
            onClick={props.onClick}
            data-row={props.rowIndex}
        >
            <div className={styles.cell_timestamp}>
                {(new Date(props.children)).toLocaleTimeString('en-GB', { hour12: false })}
            </div>
        </div>
    );
}

interface TargetCellProps {
    children: string;
    style: React.CSSProperties;
    rowIndex: number;
    onClick: React.MouseEventHandler;
    expanded: boolean;
}
export const TargetCell: React.FC<TargetCellProps> = (props: TargetCellProps) => {
    return (
        <div
            className={styles.cell}
            style={props.style}
            onClick={props.onClick}
            data-row={props.rowIndex}
        >
            <div className={styles.cell_target}>
                {props.children}
            </div>
        </div>
    );
}

interface MessageCellProps {
    children: LogRecord;
    style: React.CSSProperties;
    rowIndex: number;
    onClick: React.MouseEventHandler;
    expanded: boolean;
}
export const DetailsCell: React.FC<MessageCellProps> = (props: MessageCellProps) => {
    return (
        <div
            className={styles.cell}
            style={props.style}
            onClick={props.onClick}
            data-row={props.rowIndex}
        >
            <div className={styles.cell_message}>
                {props.children.message}
            </div>
            {props.expanded && (
                <div className={styles.cell_details}>
                    {Object.entries(props.children.keyValues).map(([k, v], i) => (
                        <React.Fragment key={i}>
                            <span key={i * 2 + 0} className={styles.cell_details_key}>{k}</span>
                            <span key={i * 2 + 1} className={styles.cell_details_value}>{v}</span>
                        </React.Fragment>
                    ))}
                </div>
            )}
        </div>
    );
}

interface LogViewerProps {
    onClose: () => void;
}

const COLUMN_COUNT = 4;
const COLUMN_TIMESTAMP_WIDTH = 80;
const COLUMN_LEVEL_WIDTH = 44;
const COLUMN_TARGET_WIDTH = 160;
const ROW_HEIGHT = 32;
const ROW_HEIGHT_EXPANDED_BASE = 8;
const ROW_HEIGHT_EXPANDED_PER_DETAIL_KEY = 20;

const PIXEL_PER_CHAR = 8;
const VALUE_PADDING = 0;

export const LogViewer: React.FC<LogViewerProps> = (props: LogViewerProps) => {
    const logger = useLogger();
    const logStats = logger.statistics;
    const logVersion = pollLogVersion(100);

    // Determine log container dimensions
    const containerRef = React.useRef<HTMLDivElement>(null);
    const containerSize = observeSize(containerRef);
    const containerWidth = containerSize?.width ?? 200;
    const containerHeight = containerSize?.height ?? 100;

    // Compute size of target and details column based on log statistics
    const targetColumnWidth = Math.min(logStats.maxTargetWidth * PIXEL_PER_CHAR + VALUE_PADDING, COLUMN_TARGET_WIDTH);

    // Expand message column to the right if there's space
    const scrollBarShown = (logger.buffer.length * ROW_HEIGHT) >= containerHeight;
    const scrollBarWidth = useScrollbarWidth();
    const scrollBarWidthIfShown = scrollBarShown ? scrollBarWidth : 0;
    const columnWidthLeftOfDetails = COLUMN_TIMESTAMP_WIDTH + COLUMN_LEVEL_WIDTH + targetColumnWidth;
    const columnWidthRightOfTarget = Math.max(containerWidth - columnWidthLeftOfDetails - scrollBarWidthIfShown, 0);
    const detailsColumnWidth = columnWidthRightOfTarget;

    // Determine column width
    const columnWidths = [COLUMN_TIMESTAMP_WIDTH, COLUMN_LEVEL_WIDTH, targetColumnWidth, detailsColumnWidth];
    const getColumnWidth = (col: number) => columnWidths[col];

    // Reset the grid styling when container dimensions change or message column gets updated
    const gridRef = React.useRef<Grid>(null);
    React.useEffect(() => {
        if (gridRef.current) {
            gridRef.current.resetAfterIndices({
                rowIndex: 0,
                columnIndex: 0,
                shouldForceUpdate: true
            });
        }
    }, [containerWidth, containerHeight, targetColumnWidth, detailsColumnWidth]);

    // Redraw whenever the log version changes
    const seenLogRows = React.useRef<number>(0);
    React.useEffect(() => {
        if (gridRef.current) {
            const rowCount = logger.buffer.length;
            seenLogRows.current = rowCount;

            // Only tell the grid about the new rows.
            // Note that this relies on the detail that we're currently not flushing out old records.
            gridRef.current.resetAfterIndices({
                rowIndex: Math.max(seenLogRows.current, 1) - 1,
                columnIndex: 0,
                shouldForceUpdate: true
            });

            // Scroll to last row.
            // Note that this is the index of a pseudo-row after the last content row
            gridRef.current.scrollToItem({
                align: 'end',
                rowIndex: Math.max(rowCount, 1)
            });
        }
    }, [logVersion, containerHeight]);

    // Helper to toggle the log row details
    const expandedRows = React.useRef<Set<number>>(new Set());
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
        if (gridRef.current) {
            gridRef.current.resetAfterIndices({
                rowIndex: Math.max(rowIdx, 1) - 1,
                columnIndex: 0,
                shouldForceUpdate: true
            });
        }
    }, []);

    // Helper to get the row height
    const getRowHeight = React.useCallback((row: number) => {
        if (expandedRows.current.has(row)) {
            const record = logger.buffer.at(row);
            if (record == null) {
                return ROW_HEIGHT;
            } else {
                const keyCount = Object.keys(record.keyValues).length;
                let height = ROW_HEIGHT;
                if (keyCount > 0) {
                    height += ROW_HEIGHT_EXPANDED_BASE + keyCount * ROW_HEIGHT_EXPANDED_PER_DETAIL_KEY;
                }
                return height;
            }
        } else {
            return ROW_HEIGHT;
        }
    }, []);

    // Helper to render a cell
    type CellProps = { columnIndex: number, rowIndex: number, style: React.CSSProperties, children?: React.ReactElement };
    const Cell: React.FC<CellProps> = React.useCallback<React.FC<CellProps>>((props: CellProps) => {
        if (props.rowIndex >= logger.buffer.length) {
            return <div />;
        }
        const expanded = expandedRows.current.has(props.rowIndex);
        const record = logger.buffer.at(props.rowIndex)!;
        switch (props.columnIndex) {
            case 0: return (
                <TimestampCell
                    rowIndex={props.rowIndex}
                    style={props.style}
                    onClick={toggleLogRowDetails}
                    expanded={expanded}
                >
                    {record.timestamp}
                </TimestampCell>
            );
            case 1: return (
                <LevelCell
                    rowIndex={props.rowIndex}
                    level={record.level}
                    style={props.style}
                    onClick={toggleLogRowDetails}
                    expanded={expanded} />
            );
            case 2: return (
                <TargetCell
                    rowIndex={props.rowIndex}
                    style={props.style}
                    onClick={toggleLogRowDetails}
                    expanded={expanded}
                >
                    {record.target}
                </TargetCell>
            );
            case 3: return (
                <DetailsCell
                    rowIndex={props.rowIndex}
                    style={props.style}
                    onClick={toggleLogRowDetails}
                    expanded={expanded}
                >
                    {record}
                </DetailsCell>
            );
            default: return <div />;
        }
    }, [logger]);

    return (
        <div className={styles.overlay}>
            <div className={styles.header_container}>
                <div className={styles.header_left_container}>
                    <div className={styles.title}>Logs</div>
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
                <Grid
                    ref={gridRef}
                    width={containerWidth}
                    height={containerHeight}
                    columnCount={COLUMN_COUNT}
                    columnWidth={getColumnWidth}
                    rowCount={logger.buffer.length + 1}
                    rowHeight={getRowHeight}
                    estimatedColumnWidth={containerWidth / COLUMN_COUNT}
                    estimatedRowHeight={ROW_HEIGHT}
                >
                    {Cell}
                </Grid>
            </div>
        </div>
    );
}
