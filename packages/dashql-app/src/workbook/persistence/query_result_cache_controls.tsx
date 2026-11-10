import * as React from 'react';
import * as styles from './query_result_cache_controls.module.css';

import { SyncIcon } from '../../ui/foundations/symbol_icon.js';

import { QueryExecutionState, QueryExecutionStatus } from '../../query/query_execution_state.js';
import { useRelativeTime } from '../../utils/time_format.js';
import { ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { Tag } from '../../ui/foundations/tag.js';
import { AnchoredOverlay } from '../../ui/foundations/anchored_overlay.js';
import { AnchorAlignment, AnchorSide } from '../../ui/foundations/anchored_position.js';

interface QueryResultCacheControlsProps {
    query: QueryExecutionState | null;
}

interface CachedResultBeanProps {
    /// The time the cached result was written
    cachedAtMs: number;
}

/// The "Cached" tag of a result card. Clicking it tells since when the result is cached.
export const CachedResultBean: React.FC<CachedResultBeanProps> = ({ cachedAtMs }) => {
    const [open, setOpen] = React.useState(false);
    const relativeTime = useRelativeTime(cachedAtMs);
    return (
        <AnchoredOverlay
            open={open}
            onOpen={() => setOpen(true)}
            onClose={() => setOpen(false)}
            side={AnchorSide.OutsideBottom}
            align={AnchorAlignment.End}
            anchorOffset={4}
            renderAnchor={(p: object) => (
                <button
                    {...(p as React.ButtonHTMLAttributes<HTMLButtonElement>)}
                    type="button"
                    className={styles.cached_result_button}
                    aria-label="Show since when the result is cached"
                    data-testid="cached-result"
                >
                    <Tag className={styles.cached_result_bean}>Cached</Tag>
                </button>
            )}
        >
            <div className={styles.cached_result_detail} role="dialog" aria-label="Cached result" data-testid="cached-result-detail">
                <div className={styles.cached_result_detail_title}>
                    Cached {relativeTime != null ? lowerFirst(relativeTime) : null}
                </div>
                <div className={styles.cached_result_detail_time}>
                    {new Date(cachedAtMs).toLocaleString()}
                </div>
            </div>
        </AnchoredOverlay>
    );
};

/// Lowercase the first letter so "Just now"/"Yesterday" read naturally after a verb
function lowerFirst(text: string): string {
    return text.charAt(0).toLowerCase() + text.slice(1);
}

/// Whether the query has a result to describe (succeeded, not since cache-deleted).
function hasResult(query: QueryExecutionState | null): boolean {
    return query?.status === QueryExecutionStatus.SUCCEEDED && query?.cacheDeleted !== true;
}

/// The timestamp to show as "Executed <relative>": for a cache hit this is the cached entry's write
/// time (the original execution); otherwise it's when this run succeeded (which is "now" right after
/// a cache miss). Falls back to null when neither is available yet.
function executedAtMs(query: QueryExecutionState | null): number | null {
    if (query == null) {
        return null;
    }
    if (query.servedFromCache && query.cachedAt != null) {
        return query.cachedAt.getTime();
    }
    return query.metrics?.querySucceededAt?.getTime() ?? null;
}

/// The execution age label shown in the entry status bar: "Executed <relative time>" (e.g.
/// "Executed 8 minutes ago", "Executed just now"). Shown for any succeeded result regardless of
/// cache hit/miss; a cache hit reports the original execution time, a fresh run reports "now". The
/// relative time refreshes on an interval.
export const QueryResultCacheLabel: React.FC<QueryResultCacheControlsProps> = ({ query }) => {
    const relativeTime = useRelativeTime(executedAtMs(query));
    if (!hasResult(query) || relativeTime == null) {
        return null;
    }
    return (
        <span className={styles.cache_label}>
            Executed {lowerFirst(relativeTime)}
        </span>
    );
};

interface QueryResultRerunButtonProps {
    query: QueryExecutionState | null;
    /// Run the script of this result again without reading cached results
    onRerun?: () => void;
}

/// The Refresh icon shown in the entry status bar. Shown for any succeeded result; clicking it runs the script and
/// the scripts it references again against their backends, without reading cached results.
export const QueryResultRerunButton: React.FC<QueryResultRerunButtonProps> = ({ query, onRerun }) => {
    if (!hasResult(query)) {
        return null;
    }
    return (
        <IconButton
            className={styles.rerun_button}
            variant={ButtonVariant.Invisible}
            onClick={onRerun}
            disabled={onRerun == null}
            aria-label="Refresh"
            description="Refresh"
        >
            <SyncIcon size={16} />
        </IconButton>
    );
};
