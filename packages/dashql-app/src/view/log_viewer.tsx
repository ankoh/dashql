import * as React from 'react';
import * as styles from './log_viewer.module.css';

import { VariableSizeGrid as Grid } from 'react-window';
import { XIcon } from '@primer/octicons-react';

import { useScrollbarWidth } from '../utils/scrollbar.js';
import { LogLevel, getLogLevelName } from '../platform/log_buffer.js';
import { useLogger } from '../platform/logger_provider.js';
import { observeSize } from './foundations/size_observer.js';
import { ButtonVariant, IconButton } from './foundations/button.js';

interface LevelCellProps {
    level: LogLevel;
    style: React.CSSProperties;
    rowIndex: number;
}
export const LevelCell: React.FC<LevelCellProps> = (props: LevelCellProps) => {
    const level = getLogLevelName(props.level);
    return (
        <div className={styles.cell_level} style={props.style}>
            {level}
        </div>
    );
}

interface TimestampCellProps {
    children: number;
    style: React.CSSProperties;
    rowIndex: number;
}
export const TimestampCell: React.FC<TimestampCellProps> = (props: TimestampCellProps) => {
    return (
        <div className={styles.cell_timestamp} style={props.style}>
            {(new Date(props.children)).toLocaleTimeString()}
        </div>
    );
}

interface TargetCellProps {
    children: string;
    style: React.CSSProperties;
    rowIndex: number;
}
export const TargetCell: React.FC<TargetCellProps> = (props: TargetCellProps) => {
    return (
        <div className={styles.cell_target} style={props.style}>
            {props.children}
        </div>
    );
}

interface MessageCellProps {
    children: string;
    style: React.CSSProperties;
    rowIndex: number;
}
export const MessageCell: React.FC<MessageCellProps> = (props: MessageCellProps) => {
    return (
        <div className={styles.cell_message} style={props.style}>
            {props.children}
        </div>
    );
}

interface LogViewerProps {
    onClose: () => void;
}

const COLUMN_COUNT = 4;
const COLUMN_TIMESTAMP_WIDTH = 80;
const COLUMN_LEVEL_WIDTH = 48;
const COLUMN_TARGET_WIDTH = 160;
const ROW_HEIGHT = 32;

const PIXEL_PER_CHAR = 6.5;
const VALUE_PADDING = 0;

export const LogViewer: React.FC<LogViewerProps> = (props: LogViewerProps) => {
    const logger = useLogger();
    const logStats = logger.statistics;

    // Determine log container dimensions
    const containerRef = React.useRef<HTMLDivElement>(null);
    const containerSize = observeSize(containerRef);
    const containerWidth = containerSize?.width ?? 200;
    const containerHeight = containerSize?.height ?? 100;

    // Compute size of target and message column based on log statistics
    const targetColumnWidth = Math.min(logStats.maxTargetWidth * PIXEL_PER_CHAR + VALUE_PADDING, COLUMN_TARGET_WIDTH);
    let messageColumnWidth = logStats.maxMessageWidth * PIXEL_PER_CHAR + VALUE_PADDING;

    // Expand message column to the right if there's space
    const scrollBarShown = (logger.buffer.length * ROW_HEIGHT) >= containerHeight;
    const scrollBarWidth = useScrollbarWidth();
    const scrollBarWidthIfShown = scrollBarShown ? scrollBarWidth : 0;
    const columnWidthLeftOfMessage = COLUMN_TIMESTAMP_WIDTH + COLUMN_LEVEL_WIDTH + targetColumnWidth;
    const columnWidthRightOfTarget = Math.max(containerWidth - columnWidthLeftOfMessage - scrollBarWidthIfShown, 0);
    messageColumnWidth = Math.max(messageColumnWidth, columnWidthRightOfTarget);

    // Determine column width
    const columnWidths = [COLUMN_TIMESTAMP_WIDTH, COLUMN_LEVEL_WIDTH, targetColumnWidth, messageColumnWidth];
    const getColumnWidth = (col: number) => columnWidths[col];
    const getRowHeight = (_row: number) => ROW_HEIGHT;

    // Poll the log version when the viewer is opened and translate into React state
    const [logVersion, setLogVersion] = React.useState<number>(logger.buffer.version);
    React.useEffect(() => {
        const intervalId = setInterval(() => {
            if (logger.buffer.version !== logVersion) {
                setLogVersion(logger.buffer.version);
            }
        }, 100);
        return () => {
            clearInterval(intervalId);
        };
    }, []);


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
    }, [containerWidth, containerHeight, targetColumnWidth, messageColumnWidth]);

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

    // Helper to render a cell
    type CellProps = { columnIndex: number, rowIndex: number, style: React.CSSProperties, children?: React.ReactElement };
    const Cell: React.FC<CellProps> = React.useCallback<React.FC<CellProps>>((props: CellProps) => {
        if (props.rowIndex >= logger.buffer.length) {
            return <div />;
        }
        const record = logger.buffer.at(props.rowIndex)!;
        switch (props.columnIndex) {
            case 0: return <TimestampCell rowIndex={props.rowIndex} style={props.style}>{record.timestamp}</TimestampCell>;
            case 1: return <LevelCell rowIndex={props.rowIndex} level={record.level} style={props.style} />;
            case 2: return <TargetCell rowIndex={props.rowIndex} style={props.style}>{record.target}</TargetCell>;
            case 3: return <MessageCell rowIndex={props.rowIndex} style={props.style}>{record.message}</MessageCell>;
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
