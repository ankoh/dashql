import * as React from 'react';

import { SELECT_WORKBOOK, useRouteContext, useRouterNavigate } from '../router/router.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { AppLoadingPage } from '../app_loading_page.js';
import { canShowWorkbook } from './app_loading_logic.js';
import { useAppConfig, useAppReconfigure } from '../../config/app_config.js';
import { useAppSettingsReady } from '../../config/app_settings_sync.js';
import { useInitialMemorySetup, type InitialSetups } from './initial_memory_setup.js';
import { useConnectionViews, useOptionalRuntime, useWorkbook } from '../../runtime/runtime_hooks.js';
import { WorkbookSetupStatus } from './workbook_setup_status.js';
import { NarrowScreenWarning, useNarrowScreenWarning } from '../narrow_screen_warning.js';
import { useAppSetup } from './app_setup.js';
import { useSharedWorkbookImport } from './shared_workbook_import.js';
import { isCloudLink, useCloudSetupGate } from './cloud_setup_gate.js';
import { useHyperLinks } from '../hyper_links.js';

interface Props { }

export const AppLoader: React.FC<React.PropsWithChildren<Props>> = (props: React.PropsWithChildren<Props>) => {
    const config = useAppConfig();
    const appSettingsReady = useAppSettingsReady();
    const reconfigure = useAppReconfigure();
    const showNarrowScreenWarning = useNarrowScreenWarning(appSettingsReady, config?.settings?.narrowScreenLayout ?? false);
    const logger = useLogger();
    const navigate = useRouterNavigate();
    const routeContext = useRouteContext();
    // The startup sets up the connections that the slice of the opened workbook names (`connectionIds`)
    const workbookConnections = useConnectionViews(useWorkbook(routeContext.workbookId ?? null)?.connectionIds);
    const runtime = useOptionalRuntime();
    // The startup sets up the connections with the runtime, the Hyper connector of the config enables it
    const hyperEnabled = config?.connectors?.hyper != null;
    const setups = React.useMemo<InitialSetups | null>(() => runtime == null || !hyperEnabled ? null : {
        setup: connectionId => runtime.setupConnection(connectionId),
        reset: connectionId => { runtime.dispatch({ connection: connectionId }, { kind: 'resetConnection' }); },
        cancel: connectionId => runtime.module?.cancelSetup(connectionId),
    }, [runtime, hyperEnabled]);

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

    useInitialMemorySetup(
        routeContext.workbookId,
        workbookConnections,
        setups,
        logger,
    );

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
