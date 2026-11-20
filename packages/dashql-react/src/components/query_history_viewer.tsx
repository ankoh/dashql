import * as React from 'react';
import * as styles from './query_history_viewer.module.css';

import { List, useListCallbackRef } from 'react-window';
import type { ListImperativeAPI, RowComponentProps } from 'react-window';
import { XIcon, ChevronUpIcon, ChevronDownIcon } from './symbol_icon.js';

import { ButtonVariant, IconButton } from './button.js';
import { AnchoredOverlay } from './anchored_overlay.js';
import { OverlaySize } from './overlay.js';
import { AnchorAlignment, AnchorSide } from '../dom/anchored_position.js';
import { JsonView } from './json/json_view.js';
import { QueryExecutionState, QueryExecutionStatus } from '@akohn/dashql/platform/query/query_execution_state';
import { useObservedSize } from './size_observer.js';
import { useKeyEvents } from '../dom/key_events.js';
import { VerticalScrollShadows } from './vertical_scroll_shadows.js';
import { InspectorDetail, InspectorEmpty, InspectorOverlay, inspectorRowClassName } from './inspector_overlay.js';

export const ROW_HEIGHT = 32;

export enum QueryTarget {
    CONNECTION = 'Attached',
    MEMORY = 'Memory',
}

export function getQueryTarget(query: QueryExecutionState): QueryTarget {
    return query.queryMetadata.userProvided ? QueryTarget.CONNECTION : QueryTarget.MEMORY;
}

export interface QueryEntry {
    connectionId: string;
    sourceName: string;
    target: QueryTarget;
    queryId: number;
    query: QueryExecutionState;
}

function getStatusLabel(status: QueryExecutionStatus): string {
    switch (status) {
        case QueryExecutionStatus.REQUESTED: return 'requested';
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

/// A point in time in milliseconds since epoch in ISO 8601, null for none
const iso = (ms: number | null) => ms == null ? null : new Date(ms).toISOString();

function entryToObject(entry: QueryEntry): object {
    const q = entry.query;
    const m = q.metrics;
    return {
        queryId: q.queryId,
        traceId: q.traceId,
        status: QueryExecutionStatus[q.status],
        source: entry.sourceName,
        target: entry.target,
        queryText: q.queryText,
        metadata: q.queryMetadata,
        metrics: {
            queryRequestedAt: iso(m.queryRequestedAt),
            querySendingStartedAt: iso(m.querySendingStartedAt),
            queryQueuedStartedAt: iso(m.queryQueuedStartedAt),
            queryRunningStartedAt: iso(m.queryRunningStartedAt),
            receivedFirstBatchAt: iso(m.receivedFirstBatchAt),
            receivedLastBatchAt: iso(m.receivedLastBatchAt),
            receivedAllBatchesAt: iso(m.receivedAllBatchesAt),
            processingResultsStartedAt: iso(m.processingResultsStartedAt),
            processedResultsAt: iso(m.processedResultsAt),
            querySucceededAt: iso(m.querySucceededAt),
            queryFailedAt: iso(m.queryFailedAt),
            queryCancelledAt: iso(m.queryCancelledAt),
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
    const time = lastUpdatedAt != null ? new Date(lastUpdatedAt).toLocaleTimeString('en-GB', { hour12: false }) : '—';

    return (
        <div
            className={inspectorRowClassName(isSelected)}
            style={props.style}
            onClick={() => showDetail(rowIndex)}
            data-testid="query-history-row"
        >
            <div className={styles.query_row_main}>
                <div className={styles.query_cell}>{time}</div>
                <div className={styles.query_cell}>{entry.sourceName}</div>
                <div className={styles.query_cell}>{entry.target}</div>
                <div className={styles.query_cell_status}>{getStatusLabel(entry.query.status)}</div>
                <div className={styles.query_cell_title} title={entry.query.queryMetadata.title ?? ''}>
                    {entry.query.queryMetadata.title ?? '—'}
                </div>
            </div>
        </div>
    );
};

export interface QueryHistoryViewerDependencies {
    List: React.ComponentType<any>;
    useListCallbackRef(initialValue: ListImperativeAPI | null): [ListImperativeAPI | null, React.Dispatch<React.SetStateAction<ListImperativeAPI | null>>];
}

const DEFAULT_DEPENDENCIES: QueryHistoryViewerDependencies = {
    List,
    useListCallbackRef,
};

export function QueryHistoryViewer(props: {
    entries: QueryEntry[];
    onClose: () => void;
    dependencies?: QueryHistoryViewerDependencies;
}) {
    const { entries } = props;
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const ListComponent = dependencies.List;
    // Container dimensions
    const containerRef = React.useRef<HTMLDivElement>(null);
    const containerSize = useObservedSize(containerRef);
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
    const [listApi, setListApi] = dependencies.useListCallbackRef(null);
    const getScrollElement = React.useCallback(() => listApi?.element ?? null, [listApi]);
    React.useEffect(() => {
        if (modalIndex >= 0 && listApi) {
            listApi.scrollToRow({ index: modalIndex, align: 'center' });
        } else if (listApi && entries.length > 0) {
            listApi.scrollToRow({ index: entries.length - 1, align: 'end' });
        }
    }, [entries, modalIndex, listApi]);

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
            <InspectorOverlay
                title="Queries"
                actions={(
                    <IconButton
                        ref={closeRef}
                        variant={ButtonVariant.Invisible}
                        aria-label="close-overlay"
                        onClick={props.onClose}
                    >
                        <XIcon />
                    </IconButton>
                )}
                columns={(
                    <div className={styles.query_header_main}>
                        <div className={styles.query_cell}>Time</div>
                        <div className={styles.query_cell}>Source</div>
                        <div className={styles.query_cell}>Target</div>
                        <div className={styles.query_cell}>Status</div>
                        <div className={styles.query_cell}>Title</div>
                    </div>
                )}
                columnsClassName={styles.query_list}
                bodyClassName={styles.query_list}
                bodyRef={containerRef}
            >
                    {entries.length === 0 ? (
                        <InspectorEmpty>Nothing to see here</InspectorEmpty>
                    ) : (
                        <ListComponent
                            listRef={setListApi}
                            style={{ width: containerWidth, height: containerHeight }}
                            rowCount={entries.length}
                            rowHeight={ROW_HEIGHT}
                            rowComponent={QueryRow}
                            rowProps={rowProps}
                        />
                    )}
                    <VerticalScrollShadows
                        getScrollElement={getScrollElement}
                        refreshKey={entries.length}
                    />
            </InspectorOverlay>
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
                <InspectorDetail
                    sidebarTop={(
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            aria-label="Close"
                            onClick={closeModal}
                        >
                            <XIcon />
                        </IconButton>
                    )}
                    sidebarBottom={(
                        <>
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
                        </>
                    )}
                >
                    {modalObject && <JsonView value={modalObject} />}
                </InspectorDetail>
            </AnchoredOverlay>
        </>
    );
}
