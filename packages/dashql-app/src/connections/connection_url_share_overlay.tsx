import * as React from 'react';

import * as styles from '../session/persistence/session_url_share_overlay.module.css';

import { AnchorAlignment } from '../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../ui/foundations/anchored_overlay.js';
import { SessionExportSettings, SessionExportSettingsView } from '../session/persistence/session_export_settings_view.js';
import { ShareURLField } from '../session/persistence/share_url_field.js';
import { exportConnectionAsUrl, SessionLinkTarget } from '../session/persistence/session_export.js';
import { connectionParamsHaveLoginHint, getConnectionParamsFromStateDetails } from './connection_params.js';
import type { ConnectionState } from './connection_state.js';

interface Props {
    /// The connection to share
    database: ConnectionState;
    isOpen: boolean;
    setIsOpen: (v: boolean) => void;
}

/// Share a connection as a link. The link opens an empty session on the connection.
export const ConnectionURLShareOverlay: React.FC<Props> = ({ database, isOpen, setIsOpen }) => {
    const anchorRef = React.useRef<HTMLDivElement>(null);
    const buttonRef = React.useRef<HTMLButtonElement>(null);
    const [url, setURL] = React.useState<string | null>(null);
    const [settings, setSettings] = React.useState<SessionExportSettings>({
        withCatalog: false,
        withLoginHint: true,
        preserveUUIDs: false,
    });
    const params = database.params;
    const name = database.name ?? null;

    React.useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setURL(null);
        exportConnectionAsUrl(params, name, SessionLinkTarget.WEB, { withLoginHint: settings.withLoginHint })
            .then(link => { if (!cancelled) setURL(link.toString()); })
            .catch(() => { if (!cancelled) setURL(null); });
        return () => {
            cancelled = true;
        };
    }, [params, name, settings.withLoginHint, isOpen]);

    const hasLoginHint = React.useMemo(
        () => isOpen && connectionParamsHaveLoginHint(getConnectionParamsFromStateDetails(database.details)),
        [database.details, isOpen],
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
                <SessionExportSettingsView
                    withCatalog={false}
                    withLoginHint={hasLoginHint}
                    withSessionParts={false}
                    settings={settings}
                    setSettings={setSettings}
                />
            </div>
        </AnchoredOverlay>
    );
};
