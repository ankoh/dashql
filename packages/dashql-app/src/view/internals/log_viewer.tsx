import * as React from 'react';
import * as styles from './log_viewer.module.css';
import symbols from '../../../static/svg/symbols.generated.svg';

import { Grid, useGridRef } from 'react-window';
import type { CellComponentProps } from 'react-window';
import { XIcon } from '@primer/octicons-react';

import { useScrollbarWidth } from '../../utils/scrollbar.js';
import { LogLevel, LogRecord, getLogLevelName } from '../../platform/log_buffer.js';
import { pollLogVersion, useLogger } from '../../platform/logger_provider.js';
import { observeSize } from '../foundations/size_observer.js';
import { ButtonVariant, IconButton } from '../foundations/button.js';

interface ExpandCellProps {
    children: LogRecord;
    style: React.CSSProperties;
    rowIndex: number;
    onClick: React.MouseEventHandler;
    expanded: boolean;
}
export const ExpandCell: React.FC<ExpandCellProps> = (props: ExpandCellProps) => {
    const sym = props.expanded ? "chevron_up_16" : "chevron_down_16";
    const keyCount = Object.keys(props.children.keyValues).length;
    return (
        <div
            className={styles.cell}
            style={props.style}
            onClick={props.onClick}
            data-row={props.rowIndex}
        >
            {(keyCount > 0) && (
                <div className={styles.cell_expand}>
                    <svg width="14px" height="14px">
                        <use xlinkHref={`${symbols}#${sym}`} />
                    </svg>
                </div>
            )}
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

interface DetailsCellProps {
    children: LogRecord;
    style: React.CSSProperties;
    rowIndex: number;
    onClick: React.MouseEventHandler;
    expanded: boolean;
}
export const DetailsCell: React.FC<DetailsCellProps> = (props: DetailsCellProps) => {
    const sym = props.expanded ? "chevron_up_16" : "chevron_down_16";
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

const COLUMN_COUNT = 5;
const COLUMN_BUTTON_WIDTH = 36;
const COLUMN_TIMESTAMP_WIDTH = 72;
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
    const columnWidthLeftOfDetails = COLUMN_BUTTON_WIDTH + COLUMN_TIMESTAMP_WIDTH + COLUMN_LEVEL_WIDTH + targetColumnWidth;
    const columnWidthRightOfTarget = Math.max(containerWidth - columnWidthLeftOfDetails - scrollBarWidthIfShown, 0);
    const detailsColumnWidth = columnWidthRightOfTarget;

    // Determine column width
    const columnWidths = [COLUMN_BUTTON_WIDTH, COLUMN_TIMESTAMP_WIDTH, COLUMN_LEVEL_WIDTH, targetColumnWidth, detailsColumnWidth];
    const getColumnWidth = (col: number) => columnWidths[col];

    // Force update mechanism to trigger re-renders.
    // Re-render grid when container dimensions change.
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => forceUpdate(), [
        containerWidth, containerHeight, targetColumnWidth, detailsColumnWidth
    ]);

    // Redraw whenever the log version changes
    const seenLogRows = React.useRef<number>(0);
    const gridRef = useGridRef(null);
    React.useEffect(() => {
        if (gridRef.current) {
            const rowCount = logger.buffer.length;
            seenLogRows.current = rowCount;

            // Scroll to last row.
            // Note that this is the index of a pseudo-row after the last content row
            gridRef.current.scrollToRow({
                index: Math.max(rowCount, 1) - 1,
                align: 'end',
            });
        }
    }, [logVersion, containerHeight]);

    // Helper to toggle the log row details
    // We use a version counter to signal to the Grid that row heights have changed.
    // In react-window v2, changing cellProps triggers a recalculation of row heights.
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
        // Increment version to trigger cellProps change, which causes Grid to recalculate row heights
        setExpandedVersion(v => v + 1);
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

    // Cell props passed to the cell component
    // expandedVersion is used to signal to the Grid that row heights have changed
    interface LogCellProps {
        logger: typeof logger;
        expandedRows: React.RefObject<Set<number>>;
        expandedVersion: number;
        toggleLogRowDetails: React.MouseEventHandler;
    }

    // Helper to render a cell
    const Cell = React.useCallback((props: CellComponentProps<LogCellProps>) => {
        const { logger, expandedRows, toggleLogRowDetails } = props;
        if (props.rowIndex >= logger.buffer.length) {
            return <div />;
        }
        const expanded = expandedRows.current?.has(props.rowIndex) ?? false;
        const record = logger.buffer.at(props.rowIndex)!;
        switch (props.columnIndex) {
            case 0: return (
                <ExpandCell
                    rowIndex={props.rowIndex}
                    style={props.style}
                    onClick={toggleLogRowDetails}
                    expanded={expanded}
                >
                    {record}
                </ExpandCell>
            );
            case 1: return (
                <TimestampCell
                    rowIndex={props.rowIndex}
                    style={props.style}
                    onClick={toggleLogRowDetails}
                    expanded={expanded}
                >
                    {record.timestamp}
                </TimestampCell>
            );
            case 2: return (
                <LevelCell
                    rowIndex={props.rowIndex}
                    level={record.level}
                    style={props.style}
                    onClick={toggleLogRowDetails}
                    expanded={expanded} />
            );
            case 3: return (
                <TargetCell
                    rowIndex={props.rowIndex}
                    style={props.style}
                    onClick={toggleLogRowDetails}
                    expanded={expanded}
                >
                    {record.target}
                </TargetCell>
            );
            case 4: return (
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
    }, []);

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
                    gridRef={gridRef}
                    style={{ width: containerWidth, height: containerHeight }}
                    columnCount={COLUMN_COUNT}
                    columnWidth={getColumnWidth}
                    rowCount={logger.buffer.length + 1}
                    rowHeight={getRowHeight}
                    cellComponent={Cell}
                    cellProps={{
                        logger,
                        expandedRows,
                        expandedVersion,
                        toggleLogRowDetails,
                    }}
                />
            </div>
        </div>
    );
}
