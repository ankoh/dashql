import * as React from 'react';
import * as styles from './http_request_viewer.module.css';

import { List, useListCallbackRef } from 'react-window';
import type { ListImperativeAPI, RowComponentProps } from 'react-window';

import { CheckIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon, TrashIcon, XIcon } from '../foundations/symbol_icon.js';
import { ButtonSize, ButtonVariant, IconButton } from '../foundations/button.js';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { OverlaySize } from '../foundations/overlay.js';
import { AnchorAlignment, AnchorSide } from '../foundations/anchored_position.js';
import { JsonView } from '../json/json_view.js';
import { observeSize } from '../foundations/size_observer.js';
import { VerticalScrollShadows } from '../foundations/vertical_scroll_shadows.js';
import { useKeyEvents } from '../../utils/key_events.js';
import { useHttpRequestLog } from '../../platform/http/http_client_provider.js';
import {
    formatCurlCommand,
    type HttpBodyRecord,
    type HttpRequestEntry,
    type HttpRequestLog,
    maskHeaders,
} from '../../platform/http/http_request_log.js';

export const ROW_HEIGHT = 32;

/// The status of a request
export function getRequestStatusLabel(entry: HttpRequestEntry): string {
    if (entry.status != null) return entry.status.toString();
    if (entry.error != null) return 'failed';
    return 'pending';
}

/// The milliseconds until the response headers arrived
function getRequestDurationMs(entry: HttpRequestEntry): number | null {
    const end = entry.respondedAt ?? entry.failedAt;
    return end == null ? null : end.getTime() - entry.sentAt.getTime();
}

/// A body in the detail view, a whole JSON text is shown parsed
function bodyToObject(body: HttpBodyRecord | null): unknown {
    if (body == null) return null;
    if (body.kind != 'text') return body;
    if (!body.truncated) {
        try {
            const parsed: unknown = JSON.parse(body.text);
            if (parsed != null && typeof parsed == 'object') return { ...body, text: undefined, json: parsed };
        } catch {
            // Not JSON, show the text
        }
    }
    return body;
}

function entryToObject(entry: HttpRequestEntry): object {
    return {
        requestId: entry.requestId,
        method: entry.method,
        url: entry.url,
        status: entry.status,
        statusText: entry.statusText,
        error: entry.error,
        timing: {
            sentAt: entry.sentAt.toISOString(),
            respondedAt: entry.respondedAt?.toISOString() ?? null,
            bodyReceivedAt: entry.bodyReceivedAt?.toISOString() ?? null,
            failedAt: entry.failedAt?.toISOString() ?? null,
            durationMs: getRequestDurationMs(entry),
        },
        request: {
            headers: Object.fromEntries(maskHeaders(entry.requestHeaders)),
            body: bodyToObject(entry.requestBody),
        },
        response: {
            headers: entry.responseHeaders != null ? Object.fromEntries(maskHeaders(entry.responseHeaders)) : null,
            body: bodyToObject(entry.responseBody),
        },
    };
}

/// Copy the request as curl command, the command includes credentials
export function CopyCurlButton(props: { entry: HttpRequestEntry; size?: ButtonSize }) {
    const [copied, setCopied] = React.useState(false);
    React.useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), 2000);
        return () => clearTimeout(timer);
    }, [copied]);
    const copy = React.useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(formatCurlCommand(props.entry)).then(
            () => setCopied(true),
            () => { /* The clipboard is not available */ },
        );
    }, [props.entry]);
    return (
        <IconButton
            variant={ButtonVariant.Invisible}
            size={props.size}
            aria-label="Copy as curl"
            description="Copy as curl, includes credentials"
            onClick={copy}
            data-testid="http-request-copy-curl"
        >
            {copied ? <CheckIcon /> : <CopyIcon />}
        </IconButton>
    );
}

interface RequestRowProps {
    entries: readonly HttpRequestEntry[];
    showDetail: (index: number) => void;
    selectedIndex: number;
}

const RequestRow = (props: RowComponentProps<RequestRowProps>) => {
    const { entries, showDetail, selectedIndex } = props;
    const entry = entries[props.index];
    if (!entry) {
        return <div style={props.style} />;
    }
    const durationMs = getRequestDurationMs(entry);
    const failed = entry.error != null || (entry.status != null && entry.status >= 400);
    return (
        <div
            className={`${styles.request_row} ${props.index === selectedIndex ? styles.request_row_selected : ''}`}
            style={props.style}
            onClick={() => showDetail(props.index)}
            data-testid="http-request-row"
        >
            <div className={styles.request_row_main}>
                <div className={styles.cell}>{entry.sentAt.toLocaleTimeString('en-GB', { hour12: false })}</div>
                <div className={styles.cell}>{entry.method}</div>
                <div className={`${styles.cell} ${styles.cell_status} ${failed ? styles.cell_status_failed : ''}`}>
                    {getRequestStatusLabel(entry)}
                </div>
                <div className={`${styles.cell} ${styles.cell_duration}`}>{durationMs != null ? `${durationMs} ms` : '—'}</div>
                <div className={styles.cell} title={entry.url}>{entry.url}</div>
                <div className={styles.cell_action}>
                    <CopyCurlButton entry={entry} size={ButtonSize.Small} />
                </div>
            </div>
        </div>
    );
};

export interface HttpRequestViewerDependencies {
    List: React.ComponentType<any>;
    useListCallbackRef(initialValue: ListImperativeAPI | null): [ListImperativeAPI | null, React.Dispatch<React.SetStateAction<ListImperativeAPI | null>>];
}

const DEFAULT_DEPENDENCIES: HttpRequestViewerDependencies = {
    List,
    useListCallbackRef,
};

const EMPTY_SNAPSHOT: readonly HttpRequestEntry[] = [];
const subscribeNothing = () => () => { };
const getEmptySnapshot = () => EMPTY_SNAPSHOT;

/// The outgoing http requests of the app
export function HttpRequestViewer(props: {
    onClose: () => void;
    log?: HttpRequestLog | null;
    dependencies?: HttpRequestViewerDependencies;
}) {
    const providedLog = useHttpRequestLog();
    const log = props.log ?? providedLog;
    const entries = React.useSyncExternalStore(log?.subscribe ?? subscribeNothing, log?.getSnapshot ?? getEmptySnapshot);
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const ListComponent = dependencies.List;

    const containerRef = React.useRef<HTMLDivElement>(null);
    const containerSize = observeSize(containerRef);
    const containerWidth = containerSize?.width ?? 200;
    const containerHeight = containerSize?.height ?? 100;

    // The request in the detail view, by id since the entries are replaced when requests progress
    const [selectedId, setSelectedId] = React.useState<number | null>(null);
    const selectedIndex = selectedId == null ? -1 : entries.findIndex(e => e.requestId === selectedId);
    const selectedEntry = selectedIndex >= 0 ? entries[selectedIndex] : null;

    const closeRef = React.useRef<HTMLButtonElement>(null);
    const closeDetail = React.useCallback(() => setSelectedId(null), []);
    const showDetail = React.useCallback((index: number) => {
        const entry = entries[index];
        if (entry) setSelectedId(entry.requestId);
    }, [entries]);
    const showPrevious = React.useCallback(() => {
        if (selectedIndex > 0) showDetail(selectedIndex - 1);
    }, [selectedIndex, showDetail]);
    const showNext = React.useCallback(() => {
        if (selectedIndex >= 0 && selectedIndex < entries.length - 1) showDetail(selectedIndex + 1);
    }, [selectedIndex, entries.length, showDetail]);

    useKeyEvents(
        selectedEntry
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

    // Follow new requests, keep the selected request in view
    const [listApi, setListApi] = dependencies.useListCallbackRef(null);
    const getScrollElement = React.useCallback(() => listApi?.element ?? null, [listApi]);
    React.useEffect(() => {
        if (selectedIndex >= 0 && listApi) {
            listApi.scrollToRow({ index: selectedIndex, align: 'center' });
        } else if (listApi && entries.length > 0) {
            listApi.scrollToRow({ index: entries.length - 1, align: 'end' });
        }
    }, [entries.length, selectedIndex, listApi]);

    const rowProps = React.useMemo<RequestRowProps>(() => ({
        entries,
        showDetail,
        selectedIndex,
    }), [entries, showDetail, selectedIndex]);

    const detailObject = React.useMemo<object | null>(
        () => selectedEntry ? entryToObject(selectedEntry) : null,
        [selectedEntry]
    );

    return (
        <>
            <div className={styles.overlay}>
                <div className={styles.header_container}>
                    <div className={styles.header_left_container}>
                        <div className={styles.title}>Requests</div>
                    </div>
                    <div className={styles.header_right_container}>
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            aria-label="Clear requests"
                            onClick={() => { setSelectedId(null); log?.clear(); }}
                            disabled={entries.length === 0}
                        >
                            <TrashIcon />
                        </IconButton>
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
                <div className={styles.request_header_row}>
                    <div className={styles.request_row_main}>
                        <div className={styles.cell}>Time</div>
                        <div className={styles.cell}>Method</div>
                        <div className={styles.cell}>Status</div>
                        <div className={`${styles.cell} ${styles.cell_duration}`}>Duration</div>
                        <div className={styles.cell}>URL</div>
                    </div>
                </div>
                <div className={styles.request_grid_container} ref={containerRef}>
                    {entries.length === 0 ? (
                        <div className={styles.empty_state}>Nothing to see here</div>
                    ) : (
                        <ListComponent
                            listRef={setListApi}
                            style={{ width: containerWidth, height: containerHeight }}
                            rowCount={entries.length}
                            rowHeight={ROW_HEIGHT}
                            rowComponent={RequestRow}
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
                open={selectedEntry !== null}
                onClose={closeDetail}
                width={OverlaySize.L}
                align={AnchorAlignment.Start}
                side={AnchorSide.OutsideLeft}
            >
                <div className={styles.detail_modal}>
                    <div className={styles.detail_modal_main}>
                        <div className={styles.detail_modal_content}>
                            {detailObject && <JsonView value={detailObject} />}
                        </div>
                    </div>
                    <div className={styles.detail_modal_sidebar}>
                        <div className={styles.detail_modal_sidebar_top}>
                            <IconButton
                                variant={ButtonVariant.Invisible}
                                aria-label="Close"
                                onClick={closeDetail}
                            >
                                <XIcon />
                            </IconButton>
                            {selectedEntry && <CopyCurlButton entry={selectedEntry} />}
                        </div>
                        <div className={styles.detail_modal_sidebar_bottom}>
                            <IconButton
                                variant={ButtonVariant.Invisible}
                                aria-label="Previous entry"
                                onClick={showPrevious}
                                disabled={selectedIndex <= 0}
                            >
                                <ChevronUpIcon />
                            </IconButton>
                            <IconButton
                                variant={ButtonVariant.Invisible}
                                aria-label="Next entry"
                                onClick={showNext}
                                disabled={selectedIndex >= entries.length - 1}
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
