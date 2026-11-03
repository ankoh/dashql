import * as React from 'react';

import * as styles from './session_url_share_overlay.module.css';

import { AnchorAlignment } from '../../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../../ui/foundations/anchored_overlay.js';
import { SessionExportSettings, SessionExportSettingsView } from './session_export_settings_view.js';
import { classNames } from '../../utils/classnames.js';
import { exportSessionAsUrl, SessionLinkTarget } from './session_export.js';
import { connectionParamsHaveLoginHint, getConnectionParamsFromStateDetails } from '../../connections/connection_params.js';
import { resolveSessionConnections, useConnectionReferences, useConnectionRegistry, useSessionConnections } from '../../connections/connection_registry.js';
import { useRouteContext } from '../../app/router/router.js';
import { useSessionScripts } from '../scripts/session_scripts_registry.js';
import { useStorageReader } from '../../storage/storage_provider.js';
import { ShareURLField } from './share_url_field.js';

interface Props {
    className?: string;
    isOpen: boolean;
    sessionId?: string;
    setIsOpen: (v: boolean) => void;
    anchorRef?: React.RefObject<HTMLButtonElement | null>;
}


export const SessionURLShareOverlay: React.FC<Props> = (props: Props) => {
    const route = useRouteContext();
    const anchorRef = React.createRef<HTMLDivElement>();
    const buttonRef = React.createRef<HTMLButtonElement>();

    const [sessionScripts] = useSessionScripts(props.sessionId ?? route.sessionId ?? null);
    const connections = useSessionConnections(sessionScripts?.sessionId ?? null);
    // The connections are resolved anew on every render, the link follows their ids
    const connectionIds = connections?.map(connection => connection.connectionId).join(',') ?? null;
    const [databaseRegistry] = useConnectionRegistry();
    const references = useConnectionReferences();
    const storage = useStorageReader();
    const [publicURLText, setPublicURLText] = React.useState<string | null>(null);
    const [settings, setSettings] = React.useState<SessionExportSettings>({
        withCatalog: false,
        withLoginHint: true,
        preserveUUIDs: false,
    });

    React.useEffect(() => {
        if (!props.isOpen) {
            return;
        }

        let cancelled = false;
        setPublicURLText(null);

        async function generateURL() {
            let setupUrl: URL | null = null;
            if (sessionScripts != null && connectionIds != null) {
                const attached = resolveSessionConnections(databaseRegistry, references, sessionScripts.sessionId);
                if (attached != null) {
                    const params = new Map();
                    const connectionNames = new Map<string, string>();
                    for (const database of attached) {
                        const connectionParams = database.params;
                        if (connectionParams != null) params.set(database.connectionId, connectionParams);
                        if (database.name != null) connectionNames.set(database.connectionId, database.name);
                    }
                    setupUrl = await exportSessionAsUrl(
                        storage.backend,
                        sessionScripts.sessionId,
                        params,
                        SessionLinkTarget.WEB,
                        { ...settings, connectionNames },
                    );
                }
            }

            if (!cancelled) setPublicURLText(setupUrl?.toString() ?? null);
        }

        generateURL().catch(() => {
            if (!cancelled) setPublicURLText(null);
        });

        return () => {
            cancelled = true;
        };
    }, [databaseRegistry, references, settings, sessionScripts, connectionIds, props.isOpen]);

    const hasLoginHint = React.useMemo(
        () => (connections ?? []).some(connection => connectionParamsHaveLoginHint(getConnectionParamsFromStateDetails(connection.details))),
        [connections],
    );

    return (
        <AnchoredOverlay
            renderAnchor={props.anchorRef ? null : () => <div ref={anchorRef} />}
            open={props.isOpen}
            onClose={() => props.setIsOpen(false)}
            anchorRef={props.anchorRef ?? anchorRef}
            returnFocusRef={props.anchorRef}
            align={AnchorAlignment.End}
            overlayProps={{
                initialFocusRef: buttonRef,
            }}
        >
            <div className={classNames(styles.sharing_overlay, props.className)}>
                <ShareURLField url={publicURLText} ariaLabel="Session share URL" buttonRef={buttonRef} />
                <SessionExportSettingsView
                    withCatalog={true}
                    withLoginHint={hasLoginHint}
                    settings={settings}
                    setSettings={setSettings}
                />
            </div>
        </AnchoredOverlay>
    );
};
