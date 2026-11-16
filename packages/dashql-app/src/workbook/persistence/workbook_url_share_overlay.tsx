import * as React from 'react';

import * as styles from './workbook_url_share_overlay.module.css';

import { AnchorAlignment } from '../../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../../ui/foundations/anchored_overlay.js';
import { WorkbookExportSettings, WorkbookExportSettingsView } from './workbook_export_settings_view.js';
import { classNames } from '../../utils/classnames.js';
import { connectionParamsHaveLoginHint, getConnectionSetupParams } from '@ankoh/dashql-runtime/connections/connection_params';
import { useRouteContext } from '../../app/router/router.js';
import { ShareURLField } from './share_url_field.js';
import { useRuntime, useWorkbook, useConnectionViews } from '../../runtime/runtime_hooks.js';

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

    const workbookScripts = useWorkbook(props.workbookId ?? route.workbookId ?? null);
    const connections = useConnectionViews(workbookScripts?.connectionIds);
    // The connections are resolved anew on every render, the link follows their ids
    const connectionIds = connections?.map(connection => connection.connectionId).join(',') ?? null;
    const runtime = useRuntime();
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

        // The runtime reads the workbook from the storage and the live params and names of its connections
        async function generateURL() {
            let link: string | null = null;
            if (workbookScripts != null && connectionIds != null) {
                link = await runtime.exportLink(workbookScripts.workbookId, process.env.DASHQL_APP_URL!, {
                    withCatalog: settings.withCatalog,
                    withLoginHint: settings.withLoginHint,
                    preserveUuids: settings.preserveUUIDs,
                });
            }
            if (!cancelled) setPublicURLText(link);
        }

        generateURL().catch(() => {
            if (!cancelled) setPublicURLText(null);
        });

        return () => {
            cancelled = true;
        };
    }, [runtime, settings, workbookScripts, connectionIds, props.isOpen]);

    const hasLoginHint = React.useMemo(
        () => (connections ?? []).some(connection => connectionParamsHaveLoginHint(getConnectionSetupParams(connection))),
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
