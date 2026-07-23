import * as React from 'react';
import * as styles from './error_details.module.css';

import { XIcon } from '@primer/octicons-react';

import { AnchoredOverlay } from './foundations/anchored_overlay.js';
import { DetailedError } from '../utils/error.js';
import { Button, ButtonSize, ButtonVariant, IconButton } from './foundations/button.js';
import { OverlaySize } from './foundations/overlay.js';

interface ErrorDetailsViewerProps {
    onClose: () => void;
    error: DetailedError
}

/// Build the ordered key/value detail rows for the error.
/// Prefers the structured Hyper rich error model when present, otherwise falls
/// back to the free-form `data` map.
function buildDetailRows(error: DetailedError): [string, string][] {
    const info = error.hyperErrorInfo;
    if (info) {
        const rows: [string, string][] = [];
        if (info.sqlstate) rows.push(["SQLSTATE", info.sqlstate]);
        if (info.errorSource !== "Unknown") rows.push(["Source", info.errorSource]);
        if (info.customerHint) rows.push(["Hint", info.customerHint]);
        if (info.customerDetail) rows.push(["Detail", info.customerDetail]);
        if (info.systemDetail) rows.push(["System detail", info.systemDetail]);
        if (info.position) {
            rows.push(["Position", `${info.position.beginCharacterOffset}..${info.position.endCharacterOffset}`]);
        }
        if (info.grpcStatusCode != null) rows.push(["gRPC status", info.grpcStatusCode.toString()]);
        return rows;
    }
    return Object.entries(error.data ?? {});
}

export const ErrorDetailsViewer: React.FC<ErrorDetailsViewerProps> = (props: ErrorDetailsViewerProps) => {

    const detailRows = buildDetailRows(props.error);
    const detailEntries = [];
    for (let i = 0; i < detailRows.length; ++i) {
        const [k, v] = detailRows[i];
        detailEntries.push(
            <span key={i * 2 + 0} className={styles.error_details_entry_key}>
                {k}
            </span>
        );
        detailEntries.push(
            <span key={i * 2 + 1} className={styles.error_details_entry_value}>
                {v}
            </span>
        );
    }

    // Prefer the Hyper primary message when present.
    const message = props.error.hyperErrorInfo?.primaryMessage ?? props.error.message;

    return (
        <div className={styles.overlay}>
            <div className={styles.header_container}>
                <div className={styles.header_left_container}>
                    <div className={styles.title}>Error</div>
                </div>
                <div className={styles.header_right_container}>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="Close Overlay"
                        onClick={props.onClose}
                    >
                        <XIcon />
                    </IconButton>
                </div>
            </div>
            <div className={styles.error_container}>
                <span className={styles.error_message_label}>
                    Message
                </span>
                <span className={styles.error_message_text}>
                    {message}
                </span>
                {detailEntries.length > 0 && (
                    <>
                        <span className={styles.error_details_label}>
                            Details
                        </span>
                        <div className={styles.error_details_entries}>
                            {detailEntries}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export type ErrorDetailsButtonProps = {
    className?: string;
    error: DetailedError;
}
export function ErrorDetailsButton(props: ErrorDetailsButtonProps) {
    const [isOpen, setIsOpen] = React.useState<boolean>(false);
    const close = React.useCallback(() => setIsOpen(false), []);
    const button = React.useMemo(() => (
        <Button
            className={props.className}
            onClick={() => setIsOpen(true)}
            variant={ButtonVariant.Invisible}
            size={ButtonSize.Small}
        >
            Error
        </Button>
    ), [props.className]);
    return (
        <AnchoredOverlay
            open={isOpen}
            onClose={close}
            renderAnchor={(p: object) => <div {...p}>{button}</div>}
            width={OverlaySize.M}
        >
            <ErrorDetailsViewer onClose={close} error={props.error} />
        </AnchoredOverlay>
    );
}
