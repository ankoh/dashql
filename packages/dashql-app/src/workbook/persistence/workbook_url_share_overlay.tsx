import * as React from 'react';

import * as styles from './workbook_url_share_overlay.module.css';

import { AnchorAlignment } from '../../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../../ui/foundations/anchored_overlay.js';
import { WorkbookExportSettings, WorkbookExportSettingsView } from './workbook_export_settings_view.js';
import { classNames } from '../../utils/classnames.js';
import { exportWorkbookAsUrl, WorkbookLinkTarget } from './workbook_export.js';
import { connectionParamsHaveLoginHint, getConnectionParamsFromStateDetails } from '../../connections/connection_params.js';
import { resolveWorkbookConnections, useConnectionReferences, useConnectionRegistry, useWorkbookConnections } from '../../connections/connection_registry.js';
import { useRouteContext } from '../../app/router/router.js';
import { useWorkbookScripts } from '../scripts/workbook_scripts_registry.js';
import { useStorageReader } from '../../storage/storage_provider.js';
import { ShareURLField } from './share_url_field.js';

interface Props {
    className?: string;
    isOpen: boolean;
    workbookId?: string;
    setIsOpen: (v: boolean) => void;
    anchorRef?: React.RefObject<HTMLButtonElement | null>;
}


export const WorkbookURLShareOverlay: React.FC<Props> = (props: Props) => {
    const route = useRouteContext();
    const anchorRef = React.createRef<HTMLDivElement>();
    const buttonRef = React.createRef<HTMLButtonElement>();

    const [workbookScripts] = useWorkbookScripts(props.workbookId ?? route.workbookId ?? null);
    const connections = useWorkbookConnections(workbookScripts?.workbookId ?? null);
    // The connections are resolved anew on every render, the link follows their ids
    const connectionIds = connections?.map(connection => connection.connectionId).join(',') ?? null;
    const [databaseRegistry] = useConnectionRegistry();
    const references = useConnectionReferences();
    const storage = useStorageReader();
    const [publicURLText, setPublicURLText] = React.useState<string | null>(null);
    const [settings, setSettings] = React.useState<WorkbookExportSettings>({
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
            if (workbookScripts != null && connectionIds != null) {
                const attached = resolveWorkbookConnections(databaseRegistry, references, workbookScripts.workbookId);
                if (attached != null) {
                    const params = new Map();
                    const connectionNames = new Map<string, string>();
                    for (const database of attached) {
                        const connectionParams = database.params;
                        if (connectionParams != null) params.set(database.connectionId, connectionParams);
                        if (database.name != null) connectionNames.set(database.connectionId, database.name);
                    }
                    setupUrl = await exportWorkbookAsUrl(
                        storage.backend,
                        workbookScripts.workbookId,
                        params,
                        WorkbookLinkTarget.WEB,
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
    }, [databaseRegistry, references, settings, workbookScripts, connectionIds, props.isOpen]);

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
                <ShareURLField url={publicURLText} ariaLabel="Workbook share URL" buttonRef={buttonRef} />
                <WorkbookExportSettingsView
                    withCatalog={true}
                    withLoginHint={hasLoginHint}
                    settings={settings}
                    setSettings={setSettings}
                />
            </div>
        </AnchoredOverlay>
    );
};
