import * as React from 'react';
import * as styles from './storage_writer_view.module.css';

import { List, useListCallbackRef } from 'react-window';
import type { RowComponentProps } from 'react-window';
import { XIcon, ChevronUpIcon, ChevronDownIcon } from '../../ui/foundations/symbol_icon.js';

import { ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { AnchoredOverlay } from '../../ui/foundations/anchored_overlay.js';
import { OverlaySize } from '../../ui/foundations/overlay.js';
import { AnchorAlignment, AnchorSide } from '../../ui/foundations/anchored_position.js';
import { JsonView } from '../../ui/json/json_view.js';
import { useRuntime } from '../../runtime/runtime_hooks.js';
import { type StorageWriteKey, type StorageWriterStatistics, storageWriteKeyBelongsToWorkbook, storageWriteKeyWithinWorkbook } from '@ankoh/dashql-runtime/storage/runtime_storage';
import { formatBytes, formatMilliseconds } from '../../utils/format.js';
import { observeSize } from '../../ui/foundations/size_observer.js';
import { useKeyEvents } from '../../utils/key_events.js';
import { VerticalScrollShadows } from '../../ui/foundations/vertical_scroll_shadows.js';

export const ROW_HEIGHT = 32;

/// How often the view reads the statistics of the writer while it shows them
export const STATISTICS_POLL_MS = 500;

/// The statistics of the writer by key
type StorageWriteStatisticsMap = ReadonlyMap<StorageWriteKey, StorageWriterStatistics>;

/// What changes when the statistics change
function statisticsSignature(statistics: StorageWriteStatisticsMap): string {
    return [...statistics].map(([key, s]) => `${key}:${s.totalScheduledWrites}:${s.totalWrites}:${s.lastWrite?.getTime() ?? ''}`).join('\n');
}

export interface StorageWriterEntry {
    key: StorageWriteKey;
    /// The key with the active workbook's id prefix stripped, shown in the Key column (the full key
    /// stays in the row tooltip and the detail modal).
    label: string;
    stats: StorageWriterStatistics;
}

export interface StorageWriterRowProps {
    entries: StorageWriterEntry[];
    showDetail: (rowIndex: number) => void;
    selectedIndex: number;
}

export const StorageWriterRow = (props: RowComponentProps<StorageWriterRowProps>) => {
    const { entries, showDetail, selectedIndex } = props;
    const rowIndex = props.index;
    const entry = entries[rowIndex];

    if (!entry) {
        return <div style={props.style} />;
    }

    const isSelected = rowIndex === selectedIndex;
    return (
        <div
            className={`${styles.stat_row} ${isSelected ? styles.stat_row_selected : ''}`}
            style={props.style}
            onClick={() => showDetail(rowIndex)}
        >
            <div className={styles.stat_row_main}>
                <div className={styles.stat_cell_key} title={entry.key}>
                    {entry.label}
                </div>
                <div className={styles.stat_cell_tasks}>
                    {entry.stats.totalScheduledWrites}
                </div>
                <div className={styles.stat_cell_writes}>
                    {entry.stats.totalWrites}
                </div>
                <div className={styles.stat_cell_time}>
                    {formatMilliseconds(entry.stats.totalWriteTime)}
                </div>
                <div className={styles.stat_cell_bytes}>
                    {formatBytes(entry.stats.totalWrittenBytes)}
                </div>
            </div>
        </div>
    );
};

function buildEntries(statsMap: StorageWriteStatisticsMap, workbookId: string): StorageWriterEntry[] {
    const entries: StorageWriterEntry[] = [...statsMap.entries()]
        .filter(([key]) => storageWriteKeyBelongsToWorkbook(key, workbookId))
        .map(([key, stats]) => ({ key, label: storageWriteKeyWithinWorkbook(key, workbookId), stats }));
    // Sort by last write ascending, the list scrolls to its end where the most recent write is.
    // Entries with no write come first.
    entries.sort((a, b) => {
        const at = a.stats.lastWrite?.getTime() ?? -1;
        const bt = b.stats.lastWrite?.getTime() ?? -1;
        return at - bt;
    });
    return entries;
}

function entryToObject(entry: StorageWriterEntry): object {
    return {
        key: entry.key,
        totalScheduledWrites: entry.stats.totalScheduledWrites,
        totalWrites: entry.stats.totalWrites,
        totalWrittenBytes: entry.stats.totalWrittenBytes,
        totalWriteTime: entry.stats.totalWriteTime,
        lastWrite: entry.stats.lastWrite?.toISOString() ?? null,
    };
}

export function StorageWriterView(props: { workbookId: string | null; onClose: () => void; }) {
    const { workbookId } = props;

    // The statistics change with every write, the view reads them while it shows them
    const storageWriter = useRuntime().storage;
    const [statsMap, setStatsMap] = React.useState<StorageWriteStatisticsMap | null>(() => storageWriter.getStatistics());
    React.useEffect(() => {
        let signature = statsMap == null ? '' : statisticsSignature(statsMap);
        const poll = setInterval(() => {
            const next = storageWriter.getStatistics();
            const nextSignature = statisticsSignature(next);
            if (nextSignature === signature) return;
            signature = nextSignature;
            setStatsMap(next);
        }, STATISTICS_POLL_MS);
        return () => clearInterval(poll);
    }, [storageWriter]);

    // Build sorted entries from the stats map, scoped to the active workbook.
    const entries = React.useMemo<StorageWriterEntry[]>(() => {
        if (!statsMap || workbookId == null) return [];
        return buildEntries(statsMap, workbookId);
    }, [statsMap, workbookId]);

    // Container size for the virtual list
    const containerRef = React.useRef<HTMLDivElement>(null);
    const containerSize = observeSize(containerRef);
    const containerWidth = containerSize?.width ?? 200;
    const containerHeight = containerSize?.height ?? 100;

    // Detail modal state: [entry | null, index]
    const [modalState, setModalState] = React.useState<[StorageWriterEntry | null, number]>([null, -1]);
    const [modalEntry, modalIndex] = modalState;

    const closeRef = React.useRef<HTMLButtonElement>(null);
    const closeModal = React.useCallback(() => setModalState([null, -1]), []);

    const showDetail = React.useCallback((rowIndex: number) => {
        const entry = entries[rowIndex] ?? null;
        if (entry) {
            setModalState([entry, rowIndex]);
        }
    }, [entries]);

    const showPrevious = React.useCallback(() => {
        if (modalIndex <= 0) return;
        showDetail(modalIndex - 1);
    }, [modalIndex, showDetail]);

    const showNext = React.useCallback(() => {
        if (modalIndex >= entries.length - 1) return;
        showDetail(modalIndex + 1);
    }, [modalIndex, entries.length, showDetail]);

    // Keyboard navigation when modal is open
    useKeyEvents(
        modalEntry
            ? [
                {
                    key: 'ArrowUp',
                    callback: (e: KeyboardEvent) => {
                        e.preventDefault();
                        e.stopPropagation();
                        showPrevious();
                    },
                    capture: true,
                },
                {
                    key: 'ArrowDown',
                    callback: (e: KeyboardEvent) => {
                        e.preventDefault();
                        e.stopPropagation();
                        showNext();
                    },
                    capture: true,
                },
            ]
            : []
    );

    // Auto-scroll to bottom when entries change; scroll to selected row when modal opens
    const [listApi, setListApi] = useListCallbackRef(null);
    const getScrollElement = React.useCallback(() => listApi?.element ?? null, [listApi]);
    React.useEffect(() => {
        if (modalIndex >= 0 && listApi) {
            listApi.scrollToRow({ index: modalIndex, align: 'center' });
        } else if (listApi && entries.length > 0) {
            listApi.scrollToRow({ index: entries.length - 1, align: 'end' });
        }
    }, [entries, modalIndex, listApi]);

    const rowProps = React.useMemo<StorageWriterRowProps>(() => ({
        entries,
        showDetail,
        selectedIndex: modalIndex,
    }), [entries, showDetail, modalIndex]);

    const modalObject = React.useMemo<object | null>(
        () => modalEntry ? entryToObject(modalEntry) : null,
        [modalEntry]
    );

    return (
        <>
            <div className={styles.overlay}>
                <div className={styles.header_container}>
                    <div className={styles.header_left_container}>
                        <div className={styles.title}>Storage Writer</div>
                    </div>
                    <div className={styles.header_right_container}>
                        <IconButton
                            ref={closeRef}
                            variant={ButtonVariant.Invisible}
                            aria-label="close-overlay"
                            onClick={props.onClose}
                        >
                            <XIcon />
                        </IconButton>
                    </div>
                </div>
                <div className={styles.stat_header_row}>
                    <div className={styles.stat_header_main}>
                        <div className={styles.stat_cell_key}>Key</div>
                        <div className={styles.stat_cell_tasks}>Tasks</div>
                        <div className={styles.stat_cell_writes}>Writes</div>
                        <div className={styles.stat_cell_time}>Time</div>
                        <div className={styles.stat_cell_bytes}>Bytes</div>
                    </div>
                </div>
                <div className={styles.stat_grid_container} ref={containerRef}>
                    {entries.length === 0 ? (
                        <div className={styles.empty_state}>
                            {workbookId == null ? 'Select a workbook to see its storage writes' : 'Nothing to see here'}
                        </div>
                    ) : (
                        <List
                            listRef={setListApi}
                            style={{ width: containerWidth, height: containerHeight }}
                            rowCount={entries.length}
                            rowHeight={ROW_HEIGHT}
                            rowComponent={StorageWriterRow}
                            rowProps={rowProps}
                        />
                    )}
                    <VerticalScrollShadows
                        getScrollElement={getScrollElement}
                        refreshKey={entries.length}
                    />
                </div>
            </div>
            <AnchoredOverlay
                renderAnchor={null}
                anchorRef={containerRef}
                returnFocusRef={closeRef}
                open={modalEntry !== null}
                onClose={closeModal}
                width={OverlaySize.L}
                align={AnchorAlignment.Start}
                side={AnchorSide.OutsideLeft}
            >
                <div className={styles.detail_modal}>
                    <div className={styles.detail_modal_main}>
                        <div className={styles.detail_modal_content}>
                            {modalObject && <JsonView value={modalObject} />}
                        </div>
                    </div>
                    <div className={styles.detail_modal_sidebar}>
                        <div className={styles.detail_modal_sidebar_top}>
                            <IconButton
                                variant={ButtonVariant.Invisible}
                                aria-label="Close"
                                onClick={closeModal}
                            >
                                <XIcon />
                            </IconButton>
                        </div>
                        <div className={styles.detail_modal_sidebar_bottom}>
                            <IconButton
                                variant={ButtonVariant.Invisible}
                                aria-label="Previous entry"
                                onClick={showPrevious}
                                disabled={modalIndex <= 0}
                            >
                                <ChevronUpIcon />
                            </IconButton>
                            <IconButton
                                variant={ButtonVariant.Invisible}
                                aria-label="Next entry"
                                onClick={showNext}
                                disabled={modalIndex >= entries.length - 1}
                            >
                                <ChevronDownIcon />
                            </IconButton>
                        </div>
                    </div>
                </div>
            </AnchoredOverlay>
        </>
    );
}
