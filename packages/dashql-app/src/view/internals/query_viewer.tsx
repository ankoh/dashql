import * as React from 'react';
import * as styles from './query_viewer.module.css';

import { List, useListRef } from 'react-window';
import type { RowComponentProps } from 'react-window';
import { XIcon, ChevronUpIcon, ChevronDownIcon } from '@primer/octicons-react';

import { ButtonVariant, IconButton } from '../foundations/button.js';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { OverlaySize } from '../foundations/overlay.js';
import { AnchorAlignment, AnchorSide } from '../foundations/anchored_position.js';
import { JsonView } from '../json/json_view.js';
import { useConnectionRegistry } from '../../connection/connection_registry.js';
import { QueryExecutionState, QueryExecutionStatus } from '../../connection/query_execution_state.js';
import { observeSize } from '../foundations/size_observer.js';
import { useKeyEvents } from '../../utils/key_events.js';

export const ROW_HEIGHT = 32;

interface QueryEntry {
    connectionId: string;
    connectorName: string;
    queryId: number;
    query: QueryExecutionState;
}

function getStatusLabel(status: QueryExecutionStatus): string {
    switch (status) {
        case QueryExecutionStatus.REQUESTED: return 'requested';
        case QueryExecutionStatus.PREPARING: return 'preparing';
        case QueryExecutionStatus.SENDING: return 'sending';
        case QueryExecutionStatus.QUEUED: return 'queued';
        case QueryExecutionStatus.RUNNING: return 'running';
        case QueryExecutionStatus.RECEIVED_FIRST_BATCH: return 'receiving';
        case QueryExecutionStatus.RECEIVED_ALL_BATCHES: return 'received';
        case QueryExecutionStatus.PROCESSING_RESULTS: return 'processing';
        case QueryExecutionStatus.PROCESSED_RESULTS: return 'processed';
        case QueryExecutionStatus.SUCCEEDED: return 'succeeded';
        case QueryExecutionStatus.FAILED: return 'failed';
        case QueryExecutionStatus.CANCELLED: return 'cancelled';
        default: return 'unknown';
    }
}

function entryToObject(entry: QueryEntry): object {
    const q = entry.query;
    const m = q.metrics;
    return {
        queryId: q.queryId,
        traceId: q.traceId,
        status: QueryExecutionStatus[q.status],
        connector: entry.connectorName,
        queryText: q.queryText,
        metadata: q.queryMetadata,
        metrics: {
            queryRequestedAt: m.queryRequestedAt?.toISOString() ?? null,
            queryPreparingStartedAt: m.queryPreparingStartedAt?.toISOString() ?? null,
            querySendingStartedAt: m.querySendingStartedAt?.toISOString() ?? null,
            queryQueuedStartedAt: m.queryQueuedStartedAt?.toISOString() ?? null,
            queryRunningStartedAt: m.queryRunningStartedAt?.toISOString() ?? null,
            receivedFirstBatchAt: m.receivedFirstBatchAt?.toISOString() ?? null,
            receivedLastBatchAt: m.receivedLastBatchAt?.toISOString() ?? null,
            receivedAllBatchesAt: m.receivedAllBatchesAt?.toISOString() ?? null,
            processingResultsStartedAt: m.processingResultsStartedAt?.toISOString() ?? null,
            processedResultsAt: m.processedResultsAt?.toISOString() ?? null,
            querySucceededAt: m.querySucceededAt?.toISOString() ?? null,
            queryFailedAt: m.queryFailedAt?.toISOString() ?? null,
            queryCancelledAt: m.queryCancelledAt?.toISOString() ?? null,
            durationMs: m.queryDurationMs,
            progressUpdatesReceived: m.progressUpdatesReceived,
        },
        error: q.error?.message ?? null,
    };
}

interface QueryRowProps {
    entries: QueryEntry[];
    showDetail: (index: number) => void;
    selectedIndex: number;
}

export const QueryRow = (props: RowComponentProps<QueryRowProps>) => {
    const { entries, showDetail, selectedIndex } = props;
    const rowIndex = props.index;
    const entry = entries[rowIndex];

    if (!entry) {
        return <div style={props.style} />;
    }

    const isSelected = rowIndex === selectedIndex;
    const lastUpdatedAt = entry.query.metrics.lastUpdatedAt;
    const time = lastUpdatedAt ? lastUpdatedAt.toLocaleTimeString('en-GB', { hour12: false }) : '—';

    return (
        <div
            className={`${styles.query_row} ${isSelected ? styles.query_row_selected : ''}`}
            style={props.style}
            onClick={() => showDetail(rowIndex)}
        >
            <div className={styles.query_row_main}>
                <div className={styles.query_cell_time}>{time}</div>
                <div className={styles.query_cell_connector}>{entry.connectorName}</div>
                <div className={styles.query_cell_status}>{getStatusLabel(entry.query.status)}</div>
                <div className={styles.query_cell_title} title={entry.query.queryMetadata.title ?? ''}>
                    {entry.query.queryMetadata.title ?? '—'}
                </div>
            </div>
        </div>
    );
};

export function QueryViewer(props: { onClose: () => void }) {
    const [connReg] = useConnectionRegistry();

    // Snapshot-based change detection (same pattern as QueryInfoListView)
    const snapshots = React.useRef<Uint32Array>(new Uint32Array());
    const [entries, setEntries] = React.useState<QueryEntry[]>([]);

    React.useEffect(() => {
        const snaps = new Uint32Array(connReg.connectionMap.size);
        let i = 0;
        for (const [, conn] of connReg.connectionMap) {
            snaps[i++] = conn.snapshotQueriesActiveFinished;
        }

        let changed = snaps.length !== snapshots.current.length;
        if (!changed) {
            for (let j = 0; j < snaps.length; j++) {
                if (snaps[j] !== snapshots.current[j]) { changed = true; break; }
            }
        }
        if (!changed) return;
        snapshots.current = snaps;

        // Build flat entry list, oldest-first so newest is at the bottom
        // finished queries are older, active are newer — iterate both oldest-first (forward)
        const next: QueryEntry[] = [];
        for (const [cid, conn] of connReg.connectionMap) {
            const name = conn.connectorInfo.names.displayShort;
            for (const qs of [conn.queriesFinishedOrdered, conn.queriesActiveOrdered]) {
                for (let k = 0; k < qs.length; k++) {
                    const qid = qs[k];
                    const query = conn.queriesActive.get(qid) ?? conn.queriesFinished.get(qid);
                    if (query) {
                        next.push({ connectionId: cid, connectorName: name, queryId: qid, query });
                    }
                }
            }
        }
        setEntries(next);
    });

    // Container dimensions
    const containerRef = React.useRef<HTMLDivElement>(null);
    const containerSize = observeSize(containerRef);
    const containerWidth = containerSize?.width ?? 200;
    const containerHeight = containerSize?.height ?? 100;

    // Detail modal state: [entry | null, index]
    const [modalState, setModalState] = React.useState<[QueryEntry | null, number]>([null, -1]);
    const [modalEntry, modalIndex] = modalState;

    const closeRef = React.useRef<HTMLButtonElement>(null);
    const closeModal = React.useCallback(() => setModalState([null, -1]), []);

    const showDetail = React.useCallback((index: number) => {
        const entry = entries[index] ?? null;
        if (entry) setModalState([entry, index]);
    }, [entries]);

    const showPrevious = React.useCallback(() => {
        if (modalIndex <= 0) return;
        showDetail(modalIndex - 1);
    }, [modalIndex, showDetail]);

    const showNext = React.useCallback(() => {
        if (modalIndex >= entries.length - 1) return;
        showDetail(modalIndex + 1);
    }, [modalIndex, entries.length, showDetail]);

    useKeyEvents(
        modalEntry
            ? [
                {
                    key: 'ArrowUp',
                    callback: (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); showPrevious(); },
                    capture: true,
                },
                {
                    key: 'ArrowDown',
                    callback: (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); showNext(); },
                    capture: true,
                },
            ]
            : []
    );

    // Auto-scroll to bottom when entries change; scroll to selected row when modal opens
    const listRef = useListRef(null);
    React.useEffect(() => {
        if (modalIndex >= 0 && listRef.current) {
            listRef.current.scrollToRow({ index: modalIndex, align: 'center' });
        } else if (listRef.current && entries.length > 0) {
            listRef.current.scrollToRow({ index: entries.length - 1, align: 'end' });
        }
    }, [entries, modalIndex]);

    const rowProps = React.useMemo<QueryRowProps>(() => ({
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
                        <div className={styles.title}>Queries</div>
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
                <div className={styles.query_header_row}>
                    <div className={styles.query_header_main}>
                        <div className={styles.query_header_time}>Time</div>
                        <div className={styles.query_header_connector}>Connector</div>
                        <div className={styles.query_header_status}>Status</div>
                        <div className={styles.query_header_title}>Title</div>
                    </div>
                </div>
                <div className={styles.query_grid_container} ref={containerRef}>
                    {entries.length === 0 ? (
                        <div className={styles.empty_state}>No Logs</div>
                    ) : (
                        <List
                            listRef={listRef}
                            style={{ width: containerWidth, height: containerHeight }}
                            rowCount={entries.length}
                            rowHeight={() => ROW_HEIGHT}
                            rowComponent={QueryRow}
                            rowProps={rowProps}
                        />
                    )}
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
