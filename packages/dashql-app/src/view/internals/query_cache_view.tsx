import * as React from 'react';
import * as styles from './query_cache_view.module.css';

import { List, useListRef } from 'react-window';
import type { RowComponentProps } from 'react-window';
import { XIcon, TrashIcon, SyncIcon } from '@primer/octicons-react';

import { ButtonVariant, ButtonSize, IconButton } from '../../view/foundations/button.js';
import { CacheFileStat } from '../../platform/storage/query_result_cache_eviction.js';
import { STORAGE_CACHE_EXTENSION } from '../../platform/storage/storage_backend.js';
import { formatBytes } from '../../utils/format.js';
import { formatRelativeTime } from '../../utils/time_format.js';
import { observeSize } from '../foundations/size_observer.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useStorageReader } from '../../platform/storage/storage_provider.js';

const LOG_CTX = 'query_cache_view';

export const ROW_HEIGHT = 32;

/// Strip the `.arrow` extension so the row shows the bare content hash (the cache key).
function hashOf(name: string): string {
    return name.endsWith(STORAGE_CACHE_EXTENSION) ? name.slice(0, -STORAGE_CACHE_EXTENSION.length) : name;
}

export interface QueryCacheRowProps {
    entries: CacheFileStat[];
    deleteEntry: (name: string) => void;
}

export const QueryCacheRow = (props: RowComponentProps<QueryCacheRowProps>) => {
    const { entries, deleteEntry } = props;
    const entry = entries[props.index];

    if (!entry) {
        return <div style={props.style} />;
    }

    const hash = hashOf(entry.name);
    return (
        <div className={styles.stat_row} style={props.style}>
            <div className={styles.stat_row_main}>
                <div className={styles.stat_cell_hash} title={hash}>
                    {hash}
                </div>
                <div className={styles.stat_cell_size}>
                    {formatBytes(entry.size)}
                </div>
                <div className={styles.stat_cell_cached} title={new Date(entry.mtimeMs).toISOString()}>
                    {formatRelativeTime(new Date(entry.mtimeMs))}
                </div>
                <div className={styles.stat_cell_accessed} title={new Date(entry.lastAccessMs).toISOString()}>
                    {formatRelativeTime(new Date(entry.lastAccessMs))}
                </div>
                <div className={styles.stat_cell_actions}>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label="Delete cache entry"
                        onClick={() => deleteEntry(entry.name)}
                    >
                        <TrashIcon />
                    </IconButton>
                </div>
            </div>
        </div>
    );
};

/// Sort by cached (write) time descending — most recent entries first.
function sortEntries(entries: CacheFileStat[]): CacheFileStat[] {
    return [...entries].sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function QueryCacheView(props: { sessionId: string | null; onClose: () => void; }) {
    const logger = useLogger();
    const storageReader = useStorageReader();
    const { sessionId } = props;

    const [entries, setEntries] = React.useState<CacheFileStat[]>([]);

    // Load (and reload) the session's cache listing. Best-effort: a failure leaves the list empty and
    // is logged, mirroring how the cache itself treats every access as best-effort.
    const refresh = React.useCallback(async () => {
        if (sessionId == null) {
            setEntries([]);
            return;
        }
        try {
            const files = await storageReader.backend.listQueryResultCache(sessionId);
            setEntries(sortEntries(files));
        } catch (e: any) {
            logger.error('failed to list query result cache', { error: String(e?.message ?? e) }, LOG_CTX);
            setEntries([]);
        }
    }, [sessionId, storageReader, logger]);

    React.useEffect(() => {
        void refresh();
    }, [refresh]);

    const deleteEntry = React.useCallback(async (name: string) => {
        if (sessionId == null) {
            return;
        }
        try {
            await storageReader.backend.deleteQueryResultCache(sessionId, hashOf(name));
        } catch (e: any) {
            logger.error('failed to delete query result cache entry', { error: String(e?.message ?? e) }, LOG_CTX);
        }
        await refresh();
    }, [sessionId, storageReader, logger, refresh]);

    // Aggregate totals for the header summary.
    const totalBytes = React.useMemo(() => entries.reduce((sum, e) => sum + e.size, 0), [entries]);

    // Container size for the virtual list
    const containerRef = React.useRef<HTMLDivElement>(null);
    const containerSize = observeSize(containerRef);
    const containerWidth = containerSize?.width ?? 200;
    const containerHeight = containerSize?.height ?? 100;

    const listRef = useListRef(null);
    const rowProps = React.useMemo<QueryCacheRowProps>(() => ({
        entries,
        deleteEntry,
    }), [entries, deleteEntry]);

    return (
        <div className={styles.overlay}>
            <div className={styles.header_container}>
                <div className={styles.header_left_container}>
                    <div className={styles.title}>Query Cache</div>
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
                        {sessionId == null ? 'Select a session to see its cached results' : 'Nothing to see here'}
                    </div>
                ) : (
                    <List
                        listRef={listRef}
                        style={{ width: containerWidth, height: containerHeight }}
                        rowCount={entries.length}
                        rowHeight={() => ROW_HEIGHT}
                        rowComponent={QueryCacheRow}
                        rowProps={rowProps}
                    />
                )}
            </div>
        </div>
    );
}
