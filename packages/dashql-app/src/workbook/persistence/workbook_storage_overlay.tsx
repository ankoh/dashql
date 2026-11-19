import * as React from 'react';
import * as styles from './workbook_storage_overlay.module.css';
import { InspectorHeader } from '@akohn/dashql-react/components/inspector_overlay';

import { XIcon, FileDirectoryIcon } from '@akohn/dashql-react/components/symbol_icon';

import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import { ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { OverlaySize } from '@akohn/dashql-react/components/overlay';
import { PlatformType, usePlatformType } from '../../platform/platform_type.js';
import { StorageBackendType } from '@akohn/dashql/platform/storage/storage_backend';
import { displayPath } from '../../storage/workbook_locator.js';
import { useStorageReader } from '../../storage/storage_provider.js';
import { useRuntime } from '@akohn/dashql-react/hooks';
import { useLogger } from '../../platform/logger_provider.js';
import { relocateWorkbookToNative } from './workbook_relocation.js';

/// The shared header for the storage view: title on the left, actions + close button on the right.
function StorageViewHeader(props: {
    onClose: () => void;
    canRelocate?: boolean;
    migrating?: boolean;
    onRelocate?: () => void;
}) {
    return (
        <InspectorHeader
            title="Workbook Storage"
            titleClassName={styles.title}
            actions={(
                <>
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
                </>
            )}
        />
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

interface WorkbookStorageViewerProps {
    workbookId: string | null;
    onClose: () => void;
}

export const WorkbookStorageViewer: React.FC<WorkbookStorageViewerProps> = (props) => {
    const reader = useStorageReader();
    const writer = useRuntime().storage;
    const logger = useLogger();
    const platform = usePlatformType();

    const [migrating, setMigrating] = React.useState(false);

    const location = props.workbookId ? reader.getWorkbookLocation(props.workbookId) : null;
    const isNative = location?.type === StorageBackendType.Native;
    const canRelocate =
        platform === PlatformType.DESKTOP &&
        !isNative &&
        props.workbookId != null &&
        reader.workbookFolders != null;

    const onRelocate = React.useCallback(async () => {
        const workbookFolders = reader.workbookFolders;
        if (props.workbookId == null || workbookFolders == null) return;
        setMigrating(true);
        try {
            await relocateWorkbookToNative(props.workbookId, workbookFolders, writer, logger);
        } catch {
            setMigrating(false);
        }
    }, [props.workbookId, reader.workbookFolders, writer, logger]);

    const backendValue = isNative ? 'Host File System' : 'Origin Private File System (Browser)';
    const schemaValue = props.workbookId && location ? displayPath(props.workbookId, location) : '';

    return (
        <div className={styles.body}>
            <StorageViewHeader
                onClose={props.onClose}
                canRelocate={canRelocate}
                migrating={migrating}
                onRelocate={onRelocate}
            />
            <div className={styles.body_content}>
                <ParamRow label="Backend" value={backendValue} />
                <ParamRow label="Location" value={schemaValue} />
                {isNative && location?.nativePath && (
                    <ParamRow label="Folder" value={location.nativePath} />
                )}
            </div>
        </div>
    );
};

type WorkbookStorageOverlayProps = {
    workbookId: string | null;
    isOpen: boolean;
    onOpen?: () => void;
    onClose: () => void;
    renderAnchor: (p: object) => React.ReactElement;
    side?: AnchorSide;
    align?: AnchorAlignment;
    anchorOffset?: number;
};

export function WorkbookStorageOverlay(props: WorkbookStorageOverlayProps) {
    return (
        <AnchoredOverlay
            open={props.isOpen}
            onOpen={props.onOpen}
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
            <WorkbookStorageViewer workbookId={props.workbookId} onClose={props.onClose} />
        </AnchoredOverlay>
    );
}
