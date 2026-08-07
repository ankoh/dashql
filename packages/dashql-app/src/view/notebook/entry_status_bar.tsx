import * as React from 'react';
import * as styles from './entry_status_bar.module.css';

import { EntryStatus } from './entry_status_model.js';
import { StatusIndicator } from '../foundations/status_indicator.js';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { AnchorAlignment, AnchorSide } from '../foundations/anchored_position.js';
import { ButtonVariant, IconButton } from '../foundations/button.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';

interface EntryStatusBarProps {
    /// The derived status to show. When null the caller shouldn't render the bar at all.
    status: EntryStatus;
    /// Reveal the underlying trace log (footer / status panel). When set, the bar becomes a
    /// clickable strip.
    onClick?: () => void;
    /// Cancel the in-flight work represented by this status. When set, a visible Cancel button is
    /// rendered at the right edge without making the whole bar a nested button.
    onCancel?: () => void;
    cancelLabel?: string;
    /// Result-level actions such as execution age and Refresh. Kept outside the clickable log strip
    /// so the bar never nests interactive controls.
    actions?: React.ReactNode;
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
export const EntryStatusBar: React.FC<EntryStatusBarProps> = ({ status, onClick, onCancel, cancelLabel = 'Cancel operation', actions }) => {
    const [showDetail, setShowDetail] = React.useState(false);
    const hasErrorDetail = status.errorDetail != null;
    const CancelIcon = SymbolIcon('x_16');
    const InfoIcon = SymbolIcon('info_circle_16');

    const message = (
        <span className={styles.status_bar_message}>
            {status.message}
        </span>
    );
    // Keep error details separate from the log button. Nesting the overlay's focusable anchor inside
    // that button would create two interactive controls in one another.
    const errorDetail = hasErrorDetail ? (
        <AnchoredOverlay
            open={showDetail}
            onOpen={() => setShowDetail(true)}
            onClose={() => setShowDetail(false)}
            side={AnchorSide.OutsideBottom}
            align={AnchorAlignment.Start}
            anchorOffset={4}
            renderAnchor={(p: object) => {
                const anchorProps = p as React.ButtonHTMLAttributes<HTMLButtonElement>;
                return (
                    <IconButton
                        {...anchorProps}
                        variant={ButtonVariant.Invisible}
                        className={styles.error_detail_trigger}
                        aria-label="Show error details"
                    >
                        <InfoIcon size={16} />
                    </IconButton>
                );
            }}
        >
            <ErrorDetailCard message={status.message} detail={status.errorDetail!} />
        </AnchoredOverlay>
    ) : null;
    const indicator = (
        <StatusIndicator
            className={styles.status_bar_spinner}
            status={status.indicator}
            width="14px"
            height="14px"
            fill="currentColor"
        />
    );

    return (
        <div className={styles.status_bar}>
            {onClick != null ? (
            <button
                type="button"
                className={styles.status_bar_log_button}
                onClick={onClick}
                aria-label={`Show log: ${status.message}`}
            >
                {indicator}
                {message}
            </button>
            ) : (
                <div className={styles.status_bar_content}>
                    {indicator}
                    {message}
                </div>
            )}
            {onCancel != null && (
                <IconButton
                    variant={ButtonVariant.Invisible}
                    className={styles.status_bar_cancel}
                    onClick={onCancel}
                    aria-label={cancelLabel}
                >
                    <CancelIcon size={16} />
                </IconButton>
            )}
            {errorDetail}
            {actions != null && (
                <div className={styles.status_bar_actions}>{actions}</div>
            )}
        </div>
    );
};
