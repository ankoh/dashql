import * as React from 'react';
import * as styles from './query_cache_view.module.css';

import { List, useListCallbackRef } from 'react-window';
import type { RowComponentProps } from 'react-window';
import { XIcon, TrashIcon, SyncIcon } from '../../ui/foundations/symbol_icon.js';

import { ButtonVariant, ButtonSize, IconButton } from '../../ui/foundations/button.js';
import type { QueryResultCacheEntry } from '../../query/query_result_cache.js';
import { markDeletedQueryResults } from './query_result_cache_clear.js';
import { useDynamicConnectionDispatch } from '../../connections/connection_registry.js';
import { formatBytes } from '../../utils/format.js';
import { formatRelativeTime } from '../../utils/time_format.js';
import { observeSize } from '../../ui/foundations/size_observer.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useQueryResultCache } from '../../storage/query_result_cache_provider.js';
import { VerticalScrollShadows } from '../../ui/foundations/vertical_scroll_shadows.js';

const LOG_CTX = 'query_cache_view';

export const ROW_HEIGHT = 32;

/// The rows show the cached results of the app by their cache keys
export interface QueryCacheRowProps {
    entries: QueryResultCacheEntry[];
    deleteEntry: (key: string) => void;
}

export const QueryCacheRow = (props: RowComponentProps<QueryCacheRowProps>) => {
    const { entries, deleteEntry } = props;
    const entry = entries[props.index];

    if (!entry) {
        return <div style={props.style} />;
    }

    const hash = entry.key;
    return (
        <div className={styles.stat_row} style={props.style}>
            <div className={styles.stat_row_main}>
                <div className={styles.stat_cell_hash} title={hash}>
                    {hash}
                </div>
                <div className={styles.stat_cell_size}>
                    {formatBytes(entry.size)}
                </div>
                <div className={styles.stat_cell_cached} title={new Date(entry.cachedAtMs).toISOString()}>
                    {formatRelativeTime(new Date(entry.cachedAtMs))}
                </div>
                <div className={styles.stat_cell_accessed} title={new Date(entry.lastAccessMs).toISOString()}>
                    {formatRelativeTime(new Date(entry.lastAccessMs))}
                </div>
                <div className={styles.stat_cell_actions}>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label="Delete cache entry"
                        onClick={() => deleteEntry(entry.key)}
                    >
                        <TrashIcon />
                    </IconButton>
                </div>
            </div>
        </div>
    );
};

/// Sort by cached (write) time descending — most recent entries first.
function sortEntries(entries: QueryResultCacheEntry[]): QueryResultCacheEntry[] {
    return [...entries].sort((a, b) => b.cachedAtMs - a.cachedAtMs);
}

export function QueryCacheView(props: { onClose: () => void; }) {
    const logger = useLogger();
    const cache = useQueryResultCache();
    // The finished queries learn about deleted results, the registry is read after the delete
    const [databaseRegistry, databaseDispatch] = useDynamicConnectionDispatch();
    const databaseRegistryRef = React.useRef(databaseRegistry);
    databaseRegistryRef.current = databaseRegistry;


    const [entries, setEntries] = React.useState<QueryResultCacheEntry[]>([]);

    // Load (and reload) the cache listing of the app. Best-effort: a failure leaves the list empty and is logged,
    // mirroring how the cache itself treats every access as best-effort.
    const refresh = React.useCallback(async () => {
        if (cache == null) {
            setEntries([]);
            return;
        }
        try {
            setEntries(sortEntries(await cache.list()));
        } catch (e: any) {
            logger.warn('failed to list query result cache', { error: String(e?.message ?? e) }, LOG_CTX);
            setEntries([]);
        }
    }, [cache, logger]);

    React.useEffect(() => {
        void refresh();
    }, [refresh]);

    const deleteEntry = React.useCallback(async (key: string) => {
        if (cache == null) {
            return;
        }
        try {
            // A file that is read right now stays, the key is still cached
            if (await cache.delete(key)) markDeletedQueryResults(databaseRegistryRef.current, databaseDispatch, [key]);
        } catch (e: any) {
            logger.warn('failed to delete query result cache entry', { error: String(e?.message ?? e) }, LOG_CTX);
        }
        await refresh();
    }, [cache, logger, refresh, databaseDispatch]);

    const clearAll = React.useCallback(async () => {
        if (cache == null) {
            return;
        }
        try {
            const keys = await cache.clear();
            const queries = markDeletedQueryResults(databaseRegistryRef.current, databaseDispatch, keys);
            logger.info('cleared the query result cache', {
                entries: String(keys.length),
                queries: String(queries),
            }, LOG_CTX);
        } catch (e: any) {
            logger.warn('failed to clear the query result cache', { error: String(e?.message ?? e) }, LOG_CTX);
        }
        await refresh();
    }, [cache, logger, refresh, databaseDispatch]);

    // Aggregate totals for the header summary.
    const totalBytes = React.useMemo(() => entries.reduce((sum, e) => sum + e.size, 0), [entries]);

    // Container size for the virtual list
    const containerRef = React.useRef<HTMLDivElement>(null);
    const containerSize = observeSize(containerRef);
    const containerWidth = containerSize?.width ?? 200;
    const containerHeight = containerSize?.height ?? 100;

    const [listApi, setListApi] = useListCallbackRef(null);
    const getScrollElement = React.useCallback(() => listApi?.element ?? null, [listApi]);
    const rowProps = React.useMemo<QueryCacheRowProps>(() => ({
        entries,
        deleteEntry,
    }), [entries, deleteEntry]);

    return (
        <div className={styles.overlay}>
            <div className={styles.header_container}>
                <div className={styles.header_left_container}>
                    <div className={styles.title}>Cache</div>
                    {entries.length > 0 && (
                        <div className={styles.summary}>
                            {entries.length} {entries.length === 1 ? 'entry' : 'entries'} · {formatBytes(totalBytes)}
                        </div>
                    )}
                </div>
                <div className={styles.header_right_container}>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="Refresh cache listing"
                        onClick={() => void refresh()}
                    >
                        <SyncIcon />
                    </IconButton>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="Clear the query cache"
                        disabled={entries.length === 0}
                        onClick={() => void clearAll()}
                    >
                        <TrashIcon />
                    </IconButton>
                    <IconButton
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
                    <div className={styles.stat_cell_hash}>Key</div>
                    <div className={styles.stat_cell_size}>Size</div>
                    <div className={styles.stat_cell_cached}>Cached</div>
                    <div className={styles.stat_cell_accessed}>Accessed</div>
                    <div className={styles.stat_cell_actions} />
                </div>
            </div>
            <div className={styles.stat_grid_container} ref={containerRef}>
                {entries.length === 0 ? (
                    <div className={styles.empty_state}>
                        Nothing to see here
                    </div>
                ) : (
                    <List
                        listRef={setListApi}
                        style={{ width: containerWidth, height: containerHeight }}
                        rowCount={entries.length}
                        rowHeight={ROW_HEIGHT}
                        rowComponent={QueryCacheRow}
                        rowProps={rowProps}
                    />
                )}
                <VerticalScrollShadows
                    getScrollElement={getScrollElement}
                    refreshKey={entries.length}
                />
            </div>
        </div>
    );
}
