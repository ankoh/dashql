import * as React from 'react';
import * as styles from './entry_status_bar.module.css';

import { EntryStatus } from './entry_status_model.js';
import { StatusIndicator } from '../foundations/status_indicator.js';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { AnchorAlignment, AnchorSide } from '../foundations/anchored_position.js';

interface EntryStatusBarProps {
    /// The derived status to show. When null the caller shouldn't render the bar at all.
    status: EntryStatus;
    /// Reveal the underlying trace log (footer / status panel). When set, the bar becomes a
    /// clickable strip.
    onClick?: () => void;
}

/// The white-card contents of the error-detail overlay: the full error message plus a key/value
/// grid for the structured detail (SQLSTATE, hint, position, …). Mirrors the shared
/// ErrorDetailsViewer look so error surfaces stay consistent across the app.
const ErrorDetailCard: React.FC<{
    message: string;
    detail: Record<string, string | null | undefined>;
}> = ({ message, detail }) => {
    const entries = Object.entries(detail);
    return (
        <div className={styles.error_detail_card}>
            <span className={styles.error_detail_message_label}>Message</span>
            <span className={styles.error_detail_message_text}>{message}</span>
            {entries.length > 0 && (
                <>
                    <span className={styles.error_detail_label}>Details</span>
                    <div className={styles.error_detail_grid}>
                        {entries.map(([k, v], i) => (
                            <React.Fragment key={i}>
                                <span className={styles.error_detail_key}>{k}</span>
                                <span className={styles.error_detail_value}>{v ?? ''}</span>
                            </React.Fragment>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

/// The status bar shown between an entry's action bar and its body. A single strip that generalizes
/// the former "AI bar": it renders a spinner (or check/cross) plus a one-line message for whatever
/// work is in flight — an agent run or a query execution. Purely presentational; contents come from
/// `deriveEntryStatus`. A failed query's key-values are revealed on hover over the message (see
/// ErrorDetailOverlay).
export const EntryStatusBar: React.FC<EntryStatusBarProps> = ({ status, onClick }) => {
    const [showDetail, setShowDetail] = React.useState(false);
    const hasErrorDetail = status.errorDetail != null;

    // For a failed query the message becomes a click anchor that opens a white-card overlay with the
    // full error text and its key-values, matching the app's other anchored overlays. Clicking the
    // message must not also trigger the strip's onClick (which reveals the trace log), so we stop
    // propagation on the anchor.
    const message = hasErrorDetail ? (
        <AnchoredOverlay
            open={showDetail}
            onOpen={() => setShowDetail(true)}
            onClose={() => setShowDetail(false)}
            side={AnchorSide.OutsideBottom}
            align={AnchorAlignment.Start}
            anchorOffset={4}
            renderAnchor={(p: object) => {
                const anchorProps = p as React.HTMLAttributes<HTMLSpanElement>;
                return (
                    <span
                        {...anchorProps}
                        className={styles.status_bar_message_clickable}
                        onClick={(e: React.MouseEvent<HTMLSpanElement>) => {
                            // Don't let the click also reach the strip's onClick (which reveals the trace log).
                            e.stopPropagation();
                            anchorProps.onClick?.(e);
                        }}
                    >
                        {status.message}
                    </span>
                );
            }}
        >
            <ErrorDetailCard message={status.message} detail={status.errorDetail!} />
        </AnchoredOverlay>
    ) : (
        <span className={styles.status_bar_message}>
            {status.message}
        </span>
    );
    const indicator = (
        <StatusIndicator
            className={styles.status_bar_spinner}
            status={status.indicator}
            width="14px"
            height="14px"
            fill="currentColor"
        />
    );

    // Clickable strip (reveals the trace log) vs. a static row.
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
            </button>
        );
    }
    return (
        <div className={styles.status_bar}>
            {indicator}
            {message}
        </div>
    );
};
