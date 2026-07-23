import * as React from 'react';
import * as styles from './session_storage_overlay.module.css';

import { XIcon, FileDirectoryIcon } from '@primer/octicons-react';

import { AnchorAlignment, AnchorSide } from '../foundations/anchored_position.js';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { ButtonVariant, IconButton } from '../foundations/button.js';
import { OverlaySize } from '../foundations/overlay.js';
import { PlatformType, usePlatformType } from '../../platform/platform_type.js';
import { StorageBackendType } from '../../platform/storage/storage_backend.js';
import { CompositeStorageBackend } from '../../platform/storage/composite_storage_backend.js';
import { displayPath } from '../../platform/storage/session_locator.js';
import { useStorageReader, useStorageWriter } from '../../platform/storage/storage_provider.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { relocateSessionToNative } from '../../platform/storage/storage_migration_flow.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { RENAME_SESSION } from '../../connection/connection_state.js';

/// The shared header for the storage view: title on the left, actions + close button on the right.
function StorageViewHeader(props: {
    onClose: () => void;
    canRelocate?: boolean;
    migrating?: boolean;
    onRelocate?: () => void;
}) {
    return (
        <div className={styles.header_container}>
            <div className={styles.header_left_container}>
                <div className={styles.title}>Session Storage</div>
            </div>
            <div className={styles.header_right_container}>
                {props.canRelocate && (
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="Store locally"
                        disabled={props.migrating}
                        onClick={props.onRelocate}
                    >
                        <FileDirectoryIcon />
                    </IconButton>
                )}
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

/// An editable session-name row. Local draft state edits freely; the commit (blur or Enter)
/// dispatches RENAME_SESSION, which normalises blank input to "no name" (falls back to the path).
function NameRow(props: { name: string | null; onCommit: (name: string) => void }) {
    const [draft, setDraft] = React.useState<string>(props.name ?? '');
    // Re-sync the draft when the persisted name changes (e.g. a rename from elsewhere, or switching
    // sessions while the overlay stays mounted).
    React.useEffect(() => { setDraft(props.name ?? ''); }, [props.name]);

    const commit = React.useCallback(() => props.onCommit(draft), [props.onCommit, draft]);
    const onKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.currentTarget.blur();
        } else if (e.key === 'Escape') {
            // Abandon the edit: restore the persisted value and drop focus.
            setDraft(props.name ?? '');
            e.currentTarget.blur();
        }
    }, [props.name]);

    return (
        <input
            className={styles.name_input}
            type="text"
            value={draft}
            placeholder="Name this session"
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
        />
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

    const [connection, connectionDispatch] = useConnectionState(props.sessionId);
    const onRename = React.useCallback((name: string) => {
        connectionDispatch({ type: RENAME_SESSION, value: name });
    }, [connectionDispatch]);

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

    const backendValue = isNative ? 'Host File System' : 'Origin Private File System (Browser)';
    const schemaValue = props.sessionId && location ? displayPath(props.sessionId, location) : '';

    return (
        <div className={styles.body}>
            <StorageViewHeader
                onClose={props.onClose}
                canRelocate={canRelocate}
                migrating={migrating}
                onRelocate={onRelocate}
            />
            <div className={styles.body_content}>
                {connection && <NameRow name={connection.name} onCommit={onRename} />}
                <ParamRow label="Backend" value={backendValue} />
                <ParamRow label="Location" value={schemaValue} />
                {isNative && location?.nativePath && (
                    <ParamRow label="Folder" value={location.nativePath} />
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
                height: OverlaySize.S,
            }}
        >
            <SessionStorageViewer sessionId={props.sessionId} onClose={props.onClose} />
        </AnchoredOverlay>
    );
}
