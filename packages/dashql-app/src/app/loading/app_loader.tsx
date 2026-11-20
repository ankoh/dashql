import * as React from 'react';

import { SELECT_WORKBOOK, useRouteContext, useRouterNavigate } from '../router.js';
import { AppLoadingPage } from '../app_loading_page.js';
import { canShowWorkbook } from './app_loading_logic.js';
import { useAppConfig, useAppReconfigure } from '../../config/app_config.js';
import { useAppSettingsReady } from '../../config/app_settings_sync.js';
import { useOptionalRuntime, useWorkbook } from '@akohn/dashql-react/hooks';
import { useHyperLinkTabState } from '../../connections/hyper/hyper_link_tab.js';
import { WorkbookSetupStatus } from './workbook_setup_status.js';
import { NarrowScreenWarning, useNarrowScreenWarning } from '../narrow_screen_warning.js';
import { useAppSetup } from './app_setup.js';
import { useSharedWorkbookImport } from './shared_workbook_import.js';
import { isCloudLink, useCloudSetupGate } from './cloud_setup_gate.js';
import { useHyperLinks } from '../hyper_links.js';

export const AppLoader: React.FC<React.PropsWithChildren> = (props: React.PropsWithChildren) => {
    const config = useAppConfig();
    const appSettingsReady = useAppSettingsReady();
    const reconfigure = useAppReconfigure();
    const showNarrowScreenWarning = useNarrowScreenWarning(appSettingsReady, config?.settings?.narrowScreenLayout ?? false);
    const navigate = useRouterNavigate();
    const routeContext = useRouteContext();
    const runtime = useOptionalRuntime();
    // The runtime sets up the connections of the opened workbook that need nothing of the user: the embedded Hyper, and
    // the Hyper of a link once the tab holds its token. It considers every connection once (`open_setup` of the runtime
    // crate). The Hyper connector of the config enables it.
    const hyperEnabled = config?.connectors?.hyper != null;
    const openedWorkbook = useWorkbook(routeContext.workbookId ?? null);
    const openedConnections = openedWorkbook?.connectionIds.join(' ') ?? null;
    const hyperLinks = useHyperLinkTabState();
    React.useEffect(() => {
        if (runtime == null || !hyperEnabled || openedWorkbook == null) return;
        runtime.setUpOpenedWorkbook(openedWorkbook.workbookId);
    }, [runtime, hyperEnabled, openedWorkbook?.workbookId, openedConnections, hyperLinks]);

    // The import of a workbook that the app was started with, the setup then doesn't open another one
    const initialImport = React.useRef<Promise<boolean> | null>(null);
    const setup = useAppSetup(initialImport);
    const sharedWorkbookCard = useSharedWorkbookImport(setup.done, initialImport);
    // The document query, HashRouter keeps it out of its location
    const [cloudLink] = React.useState(() => isCloudLink(globalThis.location.search));
    const cloudSetupPage = useCloudSetupGate(setup.done, cloudLink);
    useHyperLinks(setup.opened);

    React.useEffect(() => {
        if (routeContext.workbookSetupStatus === WorkbookSetupStatus.OPENING && routeContext.workbookId != null) {
            navigate({ type: SELECT_WORKBOOK, value: routeContext.workbookId });
        }
    }, [navigate, routeContext.workbookId, routeContext.workbookSetupStatus]);

    if (showNarrowScreenWarning) {
        return <NarrowScreenWarning onEnable={() => reconfigure(value => value == null ? null : {
            ...value,
            settings: { ...value.settings, narrowScreenLayout: true },
        })} />;
    }
    if (sharedWorkbookCard != null) {
        return sharedWorkbookCard;
    }

    // Setup done and workbook selected? Show main interface
    const pauseAfterSetup = config?.settings?.pauseAfterAppSetup ?? false;
    if (canShowWorkbook(routeContext, pauseAfterSetup)) {
        // The cloud setup shows before the workbench, at the start of the app with a cloud link and when the app asks for it
        return cloudSetupPage ?? props.children;
    } else {
        // Otherwise show the app loading page
        return <AppLoadingPage
            pauseAfterSetup={pauseAfterSetup}
            progress={setup.progress}
            embeddedDatabaseStatus={setup.embeddedDatabaseStatus}
        />;
    }
};
