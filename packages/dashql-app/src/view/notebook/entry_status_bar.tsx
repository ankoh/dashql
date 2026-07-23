import * as React from 'react';
import * as styles from './entry_status_bar.module.css';

import { EntryStatus, EntryStatusKind } from './entry_status_model.js';
import { StatusIndicator } from '../foundations/status_indicator.js';

interface EntryStatusBarProps {
    /// The derived status to show. When null the caller shouldn't render the bar at all.
    status: EntryStatus;
    /// Reveal the underlying trace log (footer / status panel). Omitted for the PendingDiff prompt,
    /// which has no trace. When set, the bar becomes a clickable strip.
    onClick?: () => void;
    /// Right-aligned controls (e.g. the staged-rewrite Accept/Reject group).
    actions?: React.ReactNode;
}

/// The status bar shown between an entry's action bar and its body. A single strip that generalizes
/// the former "AI bar": it renders a spinner (or check/cross) plus a one-line message for whatever
/// work is in flight — an agent run or a query execution — and, when a rewrite is staged, the
/// Accept/Reject prompt. Purely presentational; contents come from `deriveEntryStatus`.
export const EntryStatusBar: React.FC<EntryStatusBarProps> = ({ status, onClick, actions }) => {
    const message = (
        <span className={styles.status_bar_message}>{status.message}</span>
    );
    // Only the running/failed indicators get an icon; the PendingDiff prompt is icon-less (its
    // Accept/Reject buttons carry the meaning).
    const indicator = status.kind === EntryStatusKind.PendingDiff ? null : (
        <StatusIndicator
            className={styles.status_bar_spinner}
            status={status.indicator}
            width="14px"
            height="14px"
            fill="currentColor"
        />
    );

    // Clickable strip (reveals the trace log) vs. a static row with trailing actions.
    if (onClick != null) {
        return (
            <button
                type="button"
                className={styles.status_bar_clickable}
                onClick={onClick}
                aria-label="Show log"
            >
                {indicator}
                {message}
                {actions != null && <div className={styles.status_bar_actions}>{actions}</div>}
            </button>
        );
    }
    return (
        <div className={styles.status_bar}>
            {indicator}
            {message}
            {actions != null && <div className={styles.status_bar_actions}>{actions}</div>}
        </div>
    );
};
