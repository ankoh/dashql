import * as React from 'react';

import { SELECT_WORKBOOK, useRouteContext, useRouterNavigate } from '../router/router.js';
import { useConnectionDispatch, useWorkbookConnections } from '../../connections/connection_registry.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { AppLoadingPage } from '../app_loading_page.js';
import { canShowWorkbook } from './app_loading_logic.js';
import { useAppConfig, useAppReconfigure } from '../../config/app_config.js';
import { useAppSettingsReady } from '../../config/app_settings_sync.js';
import { useHyperSetup } from '../../connections/hyper/hyper_connection_setup.js';
import { useInitialMemorySetup } from './initial_memory_setup.js';
import { WorkbookSetupStatus } from './workbook_setup_status.js';
import { NarrowScreenWarning, useNarrowScreenWarning } from '../narrow_screen_warning.js';
import { useAppSetup } from './app_setup.js';
import { useSharedWorkbookImport } from './shared_workbook_import.js';
import { useCloudSetupGate } from './cloud_setup_gate.js';
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
    const workbookConnections = useWorkbookConnections(routeContext.workbookId ?? null);
    const dispatchDatabase = useConnectionDispatch();
    const hyperSetup = useHyperSetup();

    // The import of a workbook that the app was started with, the setup then doesn't open another one
    const initialImport = React.useRef<Promise<boolean> | null>(null);
    const setup = useAppSetup(initialImport);
    const sharedWorkbookCard = useSharedWorkbookImport(setup.done, initialImport);
    const cloudSetupPage = useCloudSetupGate(setup.done);
    useHyperLinks(setup.opened);

    React.useEffect(() => {
        if (routeContext.workbookSetupStatus === WorkbookSetupStatus.OPENING && routeContext.workbookId != null) {
            navigate({ type: SELECT_WORKBOOK, value: routeContext.workbookId });
        }
    }, [navigate, routeContext.workbookId, routeContext.workbookSetupStatus]);

    useInitialMemorySetup(
        routeContext.workbookId,
        workbookConnections,
        hyperSetup,
        dispatchDatabase,
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
        // The cloud setup shows before the workbench, at the start of the app and when the Cloud overlay asks for it
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
