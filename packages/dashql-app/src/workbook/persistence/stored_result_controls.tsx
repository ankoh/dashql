import * as React from 'react';
import * as styles from './stored_result_controls.module.css';

import { SyncIcon } from '@akohn/dashql-react/components/symbol_icon';

import { QueryExecutionState, QueryExecutionStatus } from '@akohn/dashql/platform/query/query_execution_state';
import { useRelativeTime } from '@akohn/dashql-react/format/time_format';
import { ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { Tag } from '@akohn/dashql-react/components/tag';
import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';

interface StoredResultBeanProps {
    /// When the stored result was written
    writtenAtMs: number;
    /// Is it a result of the script as it is now? A result of an earlier text or connection is outdated.
    current: boolean;
}

/// The "Stored" tag of a result card, "Outdated" for a result of an earlier text or connection. Clicking it tells since
/// when the result is stored (docs/design/workbook_results.md).
export const StoredResultBean: React.FC<StoredResultBeanProps> = ({ writtenAtMs, current }) => {
    const [open, setOpen] = React.useState(false);
    const label = current ? 'Stored' : 'Outdated';
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
                    className={styles.stored_result_button}
                    aria-label="Show since when the result is stored"
                    data-testid="stored-result"
                >
                    <Tag className={styles.stored_result_bean}>{label}</Tag>
                </button>
            )}
        >
            <StoredResultDetail writtenAtMs={writtenAtMs} current={current} />
        </AnchoredOverlay>
    );
};

/// Since when the result is stored. Only the open overlay renders it, so a closed tag keeps no clock of its relative
/// time running.
function StoredResultDetail({ writtenAtMs, current }: StoredResultBeanProps): React.ReactElement {
    const relativeTime = useRelativeTime(writtenAtMs);
    return (
        <div className={styles.stored_result_detail} role="dialog" aria-label="Stored result" data-testid="stored-result-detail">
            <div className={styles.stored_result_detail_title}>
                Stored {relativeTime != null ? lowerFirst(relativeTime) : null}
            </div>
            <div className={styles.stored_result_detail_time}>
                {new Date(writtenAtMs).toLocaleString()}
            </div>
            {!current && (
                <div className={styles.stored_result_detail_hint}>
                    The script or its connection changed since, a run computes the result anew.
                </div>
            )}
        </div>
    );
}

/// Lowercase the first letter so "Just now"/"Yesterday" read naturally after a verb
function lowerFirst(text: string): string {
    return text.charAt(0).toLowerCase() + text.slice(1);
}

/// Whether the query has a result to describe
function hasResult(query: QueryExecutionState | null): boolean {
    return query?.status === QueryExecutionStatus.SUCCEEDED;
}

interface QueryResultRerunButtonProps {
    query: QueryExecutionState | null;
    /// Run the script of this result again without reusing stored results
    onRerun?: () => void;
}

/// The Refresh icon shown in the entry status bar. Shown for any succeeded result; clicking it runs the script and
/// the scripts it references again against their backends, without reusing stored results.
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
