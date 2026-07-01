import * as React from 'react';
import * as styles from './session_storage_overlay.module.css';

import { XIcon } from '@primer/octicons-react';

import { AnchorAlignment, AnchorSide } from '../foundations/anchored_position.js';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { Button, ButtonVariant, IconButton } from '../foundations/button.js';
import { OverlaySize } from '../foundations/overlay.js';
import { PlatformType, usePlatformType } from '../../platform/platform_type.js';
import { StorageBackendType } from '../../platform/storage/storage_backend.js';
import { CompositeStorageBackend } from '../../platform/storage/composite_storage_backend.js';
import { displayPath } from '../../platform/storage/session_locator.js';
import { useStorageReader, useStorageWriter } from '../../platform/storage/storage_provider.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { relocateSessionToNative } from '../../platform/storage/storage_migration_flow.js';

/// The shared header for the storage view: title on the left, close button on the right.
function StorageViewHeader(props: { title: string; onClose: () => void }) {
    return (
        <div className={styles.header_container}>
            <div className={styles.header_left_container}>
                <div className={styles.title}>{props.title}</div>
            </div>
            <div className={styles.header_right_container}>
                <IconButton
                    variant={ButtonVariant.Invisible}
                    aria-label="close-overlay"
                    onClick={props.onClose}
                >
                    <XIcon />
                </IconButton>
            </div>
        </div>
    );
}

/// A single parameter row (label + monospace value).
function ParamRow(props: { label: string; value: string }) {
    return (
        <div className={styles.param_row}>
            <div className={styles.param_label}>{props.label}</div>
            <div className={styles.param_value} title={props.value}>{props.value}</div>
        </div>
    );
}

interface SessionStorageViewerProps {
    sessionId: string | null;
    onClose: () => void;
}

export const SessionStorageViewer: React.FC<SessionStorageViewerProps> = (props) => {
    const reader = useStorageReader();
    const writer = useStorageWriter();
    const logger = useLogger();
    const platform = usePlatformType();

    const [migrating, setMigrating] = React.useState(false);

    const location = props.sessionId ? reader.getSessionLocation(props.sessionId) : null;
    const isNative = location?.type === StorageBackendType.Native;
    // Relocation requires a per-session-routing composite backend and the native platform.
    const canRelocate =
        platform === PlatformType.MACOS &&
        !isNative &&
        props.sessionId != null &&
        reader.backend instanceof CompositeStorageBackend;

    const onRelocate = React.useCallback(async () => {
        if (props.sessionId == null || !(reader.backend instanceof CompositeStorageBackend)) {
            return;
        }
        setMigrating(true);
        try {
            await relocateSessionToNative(props.sessionId, reader.backend, writer, logger);
            // On success the flow triggers a full reload, so we never reach steady state here.
        } catch {
            // Errors are logged (and surfaced via the toast) inside the flow; keep the button usable.
            setMigrating(false);
        }
    }, [props.sessionId, reader.backend, writer, logger]);

    const title = isNative ? 'Native File System' : 'Origin Private File System';
    const backendValue = isNative ? 'Native storage (on disk)' : 'Browser storage (OPFS)';
    const schemaValue = props.sessionId && location ? displayPath(props.sessionId, location) : '';

    return (
        <div className={styles.body}>
            <StorageViewHeader title={title} onClose={props.onClose} />
            <div className={styles.body_content}>
                <ParamRow label="Backend" value={backendValue} />
                <ParamRow label="Location" value={schemaValue} />
                {isNative && location?.nativePath && (
                    <ParamRow label="Folder" value={location.nativePath} />
                )}
                {canRelocate && (
                    <div className={styles.action_row}>
                        <Button
                            variant={ButtonVariant.Default}
                            disabled={migrating}
                            onClick={onRelocate}
                        >
                            {migrating ? 'Migrating…' : 'Migrate to native storage'}
                        </Button>
                        <div className={styles.action_hint}>
                            Copies this session into a folder on disk and stores it there.
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

type SessionStorageOverlayProps = {
    sessionId: string | null;
    isOpen: boolean;
    onClose: () => void;
    renderAnchor: (p: object) => React.ReactElement;
    side?: AnchorSide;
    align?: AnchorAlignment;
    anchorOffset?: number;
};

export function SessionStorageOverlay(props: SessionStorageOverlayProps) {
    return (
        <AnchoredOverlay
            open={props.isOpen}
            onClose={props.onClose}
            renderAnchor={props.renderAnchor}
            side={props.side}
            align={props.align}
            anchorOffset={props.anchorOffset}
            overlayProps={{
                width: OverlaySize.L,
                height: OverlaySize.XS,
            }}
        >
            <SessionStorageViewer sessionId={props.sessionId} onClose={props.onClose} />
        </AnchoredOverlay>
    );
}
