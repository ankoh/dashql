import * as React from 'react';

import { AppLoadingStatus } from './app_loading_status.js';
import { FINISH_SETUP, useRouteContext, useRouterNavigate } from './router.js';
import { isDebugBuild } from './globals.js';
import { useConnectionRegistry, useConnectionStateAllocator, useDynamicConnectionDispatch } from './connection/connection_registry.js';
import { useDashQLCoreSetup } from './core_provider.js';
import { useLogger } from './platform/logger/logger_provider.js';
import { globalTraceContext } from './platform/logger/trace_context.js';
import { usePlatformEventListener } from './platform/events/event_listener_provider.js';
import { useNotebookSetup } from './notebook/notebook_setup.js';
import { AppLoadingPage } from './view/app_loading_page.js';
import { configureAppWithSetupEvent, FINISHED_LINK_SETUP, InteractiveAppSetupArgs, REQUIRES_INTERACTIVE_SETUP } from './app_setup_events.js';
import { InteractiveAppSetupPage } from './view/app_setup_page_interactive.js';
import { SetupEventVariant } from './platform/events/event.js';
import { AppLoadingProgress } from './app_loading_progress.js';
import { ProgressCounter } from './utils/progress.js';
import { loadApp } from './app_loading_logic.js';
import { useAppConfig } from './app_config.js';
import { useStorageReader } from './storage/storage_provider.js';
import { useNotebookRegistry } from './notebook/notebook_state_registry.js';
import { useDatalessNotebookSetup } from './connection/dataless/dataless_notebook.js';
import { useDemoNotebookSetup } from './connection/demo/demo_notebook.js';
import { useDuckDBSetup } from './platform/duckdb/duckdb_provider.js';

interface Props { }

export const AppLoader: React.FC<React.PropsWithChildren<Props>> = (props: React.PropsWithChildren<Props>) => {
    const config = useAppConfig();
    const logger = useLogger();
    const navigate = useRouterNavigate();
    const routeContext = useRouteContext();
    const setupCore = useDashQLCoreSetup();
    const setupNotebook = useNotebookSetup();
    const storageReader = useStorageReader();
    const allocateConnection = useConnectionStateAllocator();
    const [connReg, setConnReg] = useConnectionRegistry();
    const connDispatch = useDynamicConnectionDispatch()[1];
    const setNotebookReg = useNotebookRegistry()[1];
    const setupDataless = useDatalessNotebookSetup();
    const setupDemo = useDemoNotebookSetup();
    const setupWebDB = useDuckDBSetup();

    const appEvents = usePlatformEventListener();
    const abortDefaultNotebookSwitch = React.useRef(new AbortController());
    const [loadingProgress, setLoadingProgress] = React.useState<AppLoadingProgress>(() => ({
        restoreConnections: new ProgressCounter(),
        restoreCatalogs: new ProgressCounter(),
        restoreNotebooks: new ProgressCounter(),
        setupDefaultConnections: new ProgressCounter(),
        setupDefaultNotebooks: new ProgressCounter(),
    }));
    const [setupDone, resolveSetupDone, _rejectSetupDone] = React.useMemo(() => {
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
        // Start trace for setup event handling
        globalTraceContext.startTrace();
        try {
            logger.debug("consuming setup event", { "event_type": String(data.type) }, "app_loader");

            // Stop the default notebook switch after DashQL is ready
            abortDefaultNotebookSwitch.current.abort("notebook_setup_event");
            // Wait for core to be ready
            const core = await setupCore("app_setup");
            // Wait for the default connections to be created
            await setupDone;
            // Configure the app with the setup event
            const interactiveSetupDone = () => { setInteractiveSetupArgs(null); };
            const setupResult = await configureAppWithSetupEvent(data, logger, core, allocateConnection, setupNotebook, connReg, interactiveSetupDone);
            if (setupResult == null) {
                return;
            }
            // Are we done with the setup, or do we need an interactive setup?
            switch (setupResult.type) {
                case REQUIRES_INTERACTIVE_SETUP:
                    logger.debug("requires interactive setup", {}, "app_loader");
                    setInteractiveSetupArgs(setupResult.value);
                    break;
                case FINISHED_LINK_SETUP:
                    logger.debug("finished link setup", {}, "app_loader");
                    navigate({
                        type: FINISH_SETUP,
                        value: setupResult?.value
                    });
                    break;
            }
        } finally {
            globalTraceContext.endSpan();
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
            // Start trace for app loading
            globalTraceContext.startTrace();
            try {
                logger.debug("starting app loading", {}, "app_loader");

                // Wait for core and webdb to be ready
                const [core] = await Promise.all([
                    setupCore("app_setup"),
                    setupWebDB("app_setup"),
                ]);

                logger.debug("core and webdb ready", {}, "app_loader");

                // Load the app
                const loaded = await loadApp(config, logger, core, storageReader, setConnReg, allocateConnection, connDispatch, setNotebookReg, setupDataless, setupDemo, setLoadingProgress, abort.signal);

                logger.debug("app loaded", {
                    "has_demo": (loaded.demo != null).toString(),
                    "dataless_notebook_id": loaded.dataless.notebookId.toString(),
                }, "app_loader");

                // Mark the setup as done
                resolveSetupDone();

                // Await the setup of the static notebooks
                // We might have received a notebook setup link in the meantime.
                // In that case, don't default-select the dataless notebook
                if (abortDefaultNotebookSwitch.current.signal.aborted) {
                    logger.debug("notebook switch aborted", {}, "app_loader");
                    return;
                }

                // Is debug build?
                let notebookId: number;
                let connectionId: number;
                if (loaded.demo != null) {
                    notebookId = loaded.demo.notebookId;
                    connectionId = loaded.demo.connectionId;
                } else {
                    notebookId = loaded.dataless.notebookId;
                    connectionId = loaded.dataless.connectionId;
                }

                logger.debug("navigating to setup done", {
                    "notebook_id": notebookId.toString(),
                    "connection_id": connectionId.toString(),
                }, "app_loader");

                // Mark setup as done
                navigate({
                    type: FINISH_SETUP,
                    value: {
                        notebookId: notebookId,
                        connectionId: connectionId,
                    }
                });
            } finally {
                globalTraceContext.endSpan();
            }
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
