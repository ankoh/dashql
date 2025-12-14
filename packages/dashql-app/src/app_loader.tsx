import * as React from 'react';

import { AppLoadingStatus } from './app_loading_status.js';
import { ConnectorType } from './connection/connector_info.js';
import { FINISH_SETUP, useRouteContext, useRouterNavigate } from './router.js';
import { isDebugBuild } from './globals.js';
import { useConnectionRegistry, useConnectionStateAllocator } from './connection/connection_registry.js';
import { useDashQLCoreSetup } from './core_provider.js';
import { waitForDefaultConnectionSetup } from './connection/default_connections.js';
import { useLogger } from './platform/logger_provider.js';
import { usePlatformEventListener } from './platform/event_listener_provider.js';
import { useWorkbookSetup } from './workbook/workbook_setup.js';
import { AppLoadingPage } from './view/app_loading_page.js';
import { configureAppWithSetupEvent, FINISHED_LINK_SETUP, InteractiveAppSetupArgs, REQUIRES_INTERACTIVE_SETUP } from './app_setup_events.js';
import { waitForDefaultWorkbookSetup } from './workbook/default_workbooks.js';
import { InteractiveAppSetupPage } from './view/app_setup_page_interactive.js';
import { SetupEventVariant } from './platform/event.js';

interface Props {
    children: React.ReactElement;
}

export const AppLoader: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const navigate = useRouterNavigate();
    const routeContext = useRouteContext();
    const setupCore = useDashQLCoreSetup();
    const setupWorkbook = useWorkbookSetup();
    const allocateConnection = useConnectionStateAllocator();
    const [connReg, _setConnReg] = useConnectionRegistry();
    const defaultConnectionSetup = waitForDefaultConnectionSetup();
    const defaultWorkbookSetup = waitForDefaultWorkbookSetup();

    const appEvents = usePlatformEventListener();
    const abortDefaultWorkbookSwitch = React.useRef(new AbortController());

    // Callback to consume setup event.
    // This function is called through os deep links and when opening DashQL by through .dashql files
    const [interactiveSetupArgs, setInteractiveSetupArgs] = React.useState<InteractiveAppSetupArgs | null>(null);
    const consumeSetupEvent = React.useCallback(async (data: SetupEventVariant) => {
        // Stop the default workbook switch after DashQL is ready
        abortDefaultWorkbookSwitch.current.abort("workbook_setup_event");
        // Wait for core to be ready
        const core = await setupCore("app_setup");
        // Wait for the default connections to be created
        await defaultConnectionSetup;
        // Configure the app with the setup event
        const interactiveSetupDone = () => { setInteractiveSetupArgs(null); };
        const setupResult = await configureAppWithSetupEvent(data, logger, core, allocateConnection, setupWorkbook, connReg, interactiveSetupDone);
        if (setupResult == null) {
            return;
        }
        // Are we done with the setup, or do we need an interactive setup?
        switch (setupResult.type) {
            case REQUIRES_INTERACTIVE_SETUP:
                setInteractiveSetupArgs(setupResult.value);
                break;
            case FINISHED_LINK_SETUP:
                navigate({
                    type: FINISH_SETUP,
                    value: setupResult?.value
                });
                break;
        }
    }, []);

    // Register an event handler for setup events
    React.useEffect(() => {
        // Subscribe to setup events
        appEvents.subscribeSetupEvents(consumeSetupEvent);
        // Remove listener as soon as this component unmounts
        return () => {
            appEvents.unsubscribeSetupEvents(consumeSetupEvent);
        };

    }, [appEvents]);

    // Effect to run the default setup once at the beginning
    React.useEffect(() => {
        const selectDefaultWorkbook = async () => {
            let workbookId: number;
            let connectionId: number;
            let reg = await defaultWorkbookSetup;

            // Is debug build?
            if (isDebugBuild()) {
                workbookId = reg.workbooksByConnectionType[ConnectorType.DEMO][0];
                connectionId = reg.workbookMap.get(workbookId)!.connectionId;
            } else {
                workbookId = reg.workbooksByConnectionType[ConnectorType.DATALESS][0];
                connectionId = reg.workbookMap.get(workbookId)!.connectionId;
            }

            // Await the setup of the static workbooks
            // We might have received a workbook setup link in the meantime.
            // In that case, don't default-select the dataless workbook
            if (abortDefaultWorkbookSwitch.current.signal.aborted) {
                return;
            }

            // Mark setup as done
            navigate({
                type: FINISH_SETUP,
                value: {
                    workbookId: workbookId,
                    connectionId: connectionId,
                }
            });
        };
        selectDefaultWorkbook();
    }, []);

    // Setup done?
    if (routeContext.appLoadingStatus == AppLoadingStatus.SETUP_DONE && (!isDebugBuild() || routeContext.confirmedFinishedSetup)) {
        return props.children;
    } else if (interactiveSetupArgs != null) {
        // Switch to the interactive setup?
        return <InteractiveAppSetupPage />;
    } else {
        // Otherwise show the app loading page
        return <AppLoadingPage pauseAfterSetup={isDebugBuild()} />;
    }
};

