import * as React from 'react';

import { AppLoadingStatus } from './app_loading_status.js';
import { FINISH_SETUP, useRouteContext, useRouterNavigate } from './router.js';
import { isDebugBuild } from './globals.js';
import { useConnectionRegistry, useConnectionStateAllocator, useDynamicConnectionDispatch } from './connection/connection_registry.js';
import { useDashQLCoreSetup } from './core_provider.js';
import { useLogger } from './platform/logger_provider.js';
import { usePlatformEventListener } from './platform/event_listener_provider.js';
import { useWorkbookSetup } from './workbook/workbook_setup.js';
import { AppLoadingPage } from './view/app_loading_page.js';
import { configureAppWithSetupEvent, FINISHED_LINK_SETUP, InteractiveAppSetupArgs, REQUIRES_INTERACTIVE_SETUP } from './app_setup_events.js';
import { InteractiveAppSetupPage } from './view/app_setup_page_interactive.js';
import { SetupEventVariant } from './platform/event.js';
import { AppLoadingProgress } from './app_loading_progress.js';
import { ProgressCounter } from './utils/progress.js';
import { loadApp } from './app_loading_logic.js';
import { useAppConfig } from './app_config.js';
import { useStorageReader } from './storage/storage_provider.js';
import { useWorkbookRegistry } from './workbook/workbook_state_registry.js';
import { useDatalessWorkbookSetup } from './connection/dataless/dataless_workbook.js';
import { useDemoWorkbookSetup } from './connection/demo/demo_workbook.js';

interface Props { }

export const AppLoader: React.FC<React.PropsWithChildren<Props>> = (props: React.PropsWithChildren<Props>) => {
    const config = useAppConfig();
    const logger = useLogger();
    const navigate = useRouterNavigate();
    const routeContext = useRouteContext();
    const setupCore = useDashQLCoreSetup();
    const setupWorkbook = useWorkbookSetup();
    const storageReader = useStorageReader();
    const allocateConnection = useConnectionStateAllocator();
    const [connReg, setConnReg] = useConnectionRegistry();
    const connDispatch = useDynamicConnectionDispatch()[1];
    const setWorkbookReg = useWorkbookRegistry()[1];
    const setupDataless = useDatalessWorkbookSetup();
    const setupDemo = useDemoWorkbookSetup();

    const appEvents = usePlatformEventListener();
    const abortDefaultWorkbookSwitch = React.useRef(new AbortController());
    const [loadingProgress, setLoadingProgress] = React.useState<AppLoadingProgress>(() => ({
        restoreConnections: new ProgressCounter(),
        restoreCatalogs: new ProgressCounter(),
        restoreWorkbooks: new ProgressCounter(),
        setupDefaultConnections: new ProgressCounter(),
        setupDefaultWorkbooks: new ProgressCounter(),
    }));
    const [setupDone, resolveSetupDone, rejectSetupDone] = React.useMemo(() => {
        let resolve: () => void;
        let reject: (e: Error) => void;
        const promise = new Promise<void>((a, b) => {
            resolve = a;
            reject = b
        });
        return [promise, resolve!, reject!];
    }, []);

    // Callback to consume setup event.
    // This function is called through os deep links and when opening DashQL by through .dashql files
    const [interactiveSetupArgs, setInteractiveSetupArgs] = React.useState<InteractiveAppSetupArgs | null>(null);
    const consumeSetupEvent = React.useCallback(async (data: SetupEventVariant) => {
        // Stop the default workbook switch after DashQL is ready
        abortDefaultWorkbookSwitch.current.abort("workbook_setup_event");
        // Wait for core to be ready
        const core = await setupCore("app_setup");
        // Wait for the default connections to be created
        await setupDone;
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
        const abort = new AbortController();
        if (config == null) {
            return;
        }

        const run = async () => {
            // Wait for core to be ready
            const core = await setupCore("app_setup");
            // Load the app
            const loaded = await loadApp(config, logger, core, storageReader, setConnReg, allocateConnection, connDispatch, setWorkbookReg, setupDataless, setupDemo, setLoadingProgress, abort.signal);
            // Mark the setup as done
            resolveSetupDone();

            // Await the setup of the static workbooks
            // We might have received a workbook setup link in the meantime.
            // In that case, don't default-select the dataless workbook
            if (abortDefaultWorkbookSwitch.current.signal.aborted) {
                return;
            }

            // Is debug build?
            let workbookId: number;
            let connectionId: number;
            if (loaded.demo != null) {
                workbookId = loaded.demo.workbookId;
                connectionId = loaded.demo.connectionId;
            } else {
                workbookId = loaded.dataless.workbookId;
                connectionId = loaded.dataless.connectionId;
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
        run();

        return () => abort.abort();
    }, [config]);

    // Setup done?
    const pauseAfterSetup = config?.settings?.pauseAfterAppSetup ?? false;
    if (routeContext.appLoadingStatus == AppLoadingStatus.SETUP_DONE && (!pauseAfterSetup || routeContext.confirmedFinishedSetup)) {
        return props.children;
    } else if (interactiveSetupArgs != null) {
        // Switch to the interactive setup?
        return <InteractiveAppSetupPage />;
    } else {
        // Otherwise show the app loading page
        return <AppLoadingPage pauseAfterSetup={config?.settings?.pauseAfterAppSetup ?? false} progress={loadingProgress} />;
    }
};
