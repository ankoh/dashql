import * as React from 'react';

import * as styles from '../workbook/persistence/workbook_url_share_overlay.module.css';

import { AnchorAlignment } from '../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../ui/foundations/anchored_overlay.js';
import { WorkbookExportSettings, WorkbookExportSettingsView } from '../workbook/persistence/workbook_export_settings_view.js';
import { ShareURLField } from '../workbook/persistence/share_url_field.js';
import { connectionParamsHaveLoginHint, getConnectionSetupParams } from '@ankoh/dashql-runtime/connections/connection_params';
import type { ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { useOptionalCoreRuntime } from '../runtime/runtime_hooks.js';

interface Props {
    /// The connection to share
    database: ConnectionState;
    isOpen: boolean;
    setIsOpen: (v: boolean) => void;
}

/// Share a connection as a link. The link opens an empty workbook on the connection.
export const ConnectionURLShareOverlay: React.FC<Props> = ({ database, isOpen, setIsOpen }) => {
    const anchorRef = React.useRef<HTMLDivElement>(null);
    const buttonRef = React.useRef<HTMLButtonElement>(null);
    const [url, setURL] = React.useState<string | null>(null);
    const [settings, setSettings] = React.useState<WorkbookExportSettings>({
        withCatalog: false,
        withLoginHint: true,
        preserveUUIDs: false,
    });
    // The link follows the params and the name of the connection
    const { connectionId, params, name } = database;
    // The row menus render the overlay closed, also in tests without a runtime
    const runtime = useOptionalCoreRuntime();

    React.useEffect(() => {
        if (!isOpen || runtime == null) return;
        let cancelled = false;
        setURL(null);
        runtime.exportConnectionLink(connectionId, process.env.DASHQL_APP_URL!, settings.withLoginHint)
            .then(link => { if (!cancelled) setURL(link); })
            .catch(() => { if (!cancelled) setURL(null); });
        return () => {
            cancelled = true;
        };
    }, [runtime, connectionId, params, name, settings.withLoginHint, isOpen]);

    const hasLoginHint = React.useMemo(
        () => isOpen && connectionParamsHaveLoginHint(getConnectionSetupParams(database)),
        [database, isOpen],
    );

    return (
        <AnchoredOverlay
            renderAnchor={() => <div ref={anchorRef} />}
            open={isOpen}
            onClose={() => setIsOpen(false)}
            anchorRef={anchorRef}
            align={AnchorAlignment.End}
            overlayProps={{
                initialFocusRef: buttonRef,
            }}
        >
            <div className={styles.sharing_overlay} data-testid="connection-share-overlay">
                <ShareURLField url={url} ariaLabel="Connection share URL" buttonRef={buttonRef} />
                <WorkbookExportSettingsView
                    withCatalog={false}
                    withLoginHint={hasLoginHint}
                    withWorkbookParts={false}
                    settings={settings}
                    setSettings={setSettings}
                />
            </div>
        </AnchoredOverlay>
    );
};
