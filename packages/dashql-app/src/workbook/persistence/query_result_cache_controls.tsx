import * as React from 'react';
import * as styles from './query_result_cache_controls.module.css';

import { SyncIcon } from '@akohn/dashql-react/components/symbol_icon';

import { QueryExecutionState, QueryExecutionStatus } from '@akohn/dashql/platform/query/query_execution_state';
import { useRelativeTime } from '@akohn/dashql-react/format/time_format';
import { ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { Tag } from '@akohn/dashql-react/components/tag';
import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';

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
