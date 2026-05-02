import * as React from 'react';

import { AppLoadingStatus } from './app_loading_status.js';
import { FINISH_SETUP, SELECT_SESSION, useRouteContext, useRouterNavigate } from './router.js';
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
import { SessionSelectorPage } from './view/session_selector_page.js';
import { SetupEventVariant } from './platform/events/event.js';
import { AppLoadingProgress } from './app_loading_progress.js';
import { ProgressCounter } from './utils/progress.js';
import { loadApp } from './app_loading_logic.js';
import { useAppConfig } from './app_config.js';
import { useStorage } from './platform/storage/storage_provider.js';
import { useNotebookRegistry } from './notebook/notebook_state_registry.js';
import { useDemoNotebookSetup } from './connection/dataless/dataless_notebook.js';
import { useDuckDBSetup } from './platform/duckdb/duckdb_provider.js';

interface Props { }

export const AppLoader: React.FC<React.PropsWithChildren<Props>> = (props: React.PropsWithChildren<Props>) => {
    const config = useAppConfig();
    const logger = useLogger();
    const navigate = useRouterNavigate();
    const routeContext = useRouteContext();
    const setupCore = useDashQLCoreSetup();
    const setupNotebook = useNotebookSetup();
    const [storageReader, storageWriter] = useStorage();
    const allocateConnection = useConnectionStateAllocator();
    const [connReg, setConnReg] = useConnectionRegistry();
    const connDispatch = useDynamicConnectionDispatch()[1];
    const [notebookReg, setNotebookReg] = useNotebookRegistry();
    const setupDemo = useDemoNotebookSetup();
    const setupWebDB = useDuckDBSetup();

    const appEvents = usePlatformEventListener();
    const abortDefaultNotebookSwitch = React.useRef(new AbortController());
    const [loadedCore, setLoadedCore] = React.useState<any>(null);
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
            logger.debug("Consuming setup event", { "event_type": String(data.type) }, "app_loader");

            // Stop the default notebook switch after DashQL is ready
            abortDefaultNotebookSwitch.current.abort("notebook_setup_event");
            // Wait for core to be ready
            const core = await setupCore("app_setup");
            // Wait for the default connections to be created
            await setupDone;
            // Configure the app with the setup event
            const interactiveSetupDone = () => { setInteractiveSetupArgs(null); };
            const setupResult = await configureAppWithSetupEvent(data, logger, core, allocateConnection, setupNotebook, connReg, storageWriter.backend, interactiveSetupDone);
            if (setupResult == null) {
                return;
            }
            // Are we done with the setup, or do we need an interactive setup?
            switch (setupResult.type) {
                case REQUIRES_INTERACTIVE_SETUP:
                    logger.debug("Requires interactive setup", {}, "app_loader");
                    setInteractiveSetupArgs(setupResult.value);
                    break;
                case FINISHED_LINK_SETUP:
                    logger.debug("Finished link setup", {}, "app_loader");
                    const linkSessionId = setupResult?.value?.sessionId;
                    // Mark setup as done first
                    navigate({
                        type: FINISH_SETUP,
                        value: null
                    });
                    // Then select the session from the link
                    if (linkSessionId) {
                        setTimeout(() => {
                            navigate({
                                type: SELECT_SESSION,
                                value: linkSessionId
                            });
                        }, 0);
                    }
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

    // Effect to run the default setup once at the beginning.
    // We guard against re-runs triggered by config identity changes (e.g. AppSettingsSync
    // hydrating persisted settings into AppConfig). The abort controller is only fired
    // on unmount so an in-flight setup is not cancelled by an unrelated config update.
    const hasStartedSetup = React.useRef(false);
    const setupAbortRef = React.useRef<AbortController | null>(null);
    React.useEffect(() => () => setupAbortRef.current?.abort(), []);
    React.useEffect(() => {
        if (config == null || hasStartedSetup.current) {
            return;
        }
        hasStartedSetup.current = true;
        const abort = new AbortController();
        setupAbortRef.current = abort;

        const run = async () => {
            // Start trace for app loading
            globalTraceContext.startTrace();
            try {
                logger.info("Initializing application", {}, "app_loader");
                const totalStartTime = performance.now();

                // Wait for core and webdb to be ready
                logger.info("Initializing core and WebDB", {}, "app_loader");
                const coreStartTime = performance.now();

                const [core] = await Promise.all([
                    setupCore("app_setup"),
                    setupWebDB("app_setup"),
                ]);

                const coreDuration = performance.now() - coreStartTime;
                logger.info("Core and WebDB ready", {
                    durationMs: coreDuration.toFixed(2)
                }, "app_loader");

                // Store loaded core for session selector
                setLoadedCore(core);

                // Load the app
                logger.info("Loading application state and notebooks", {}, "app_loader");
                const loaded = await loadApp(config, logger, core, storageReader, setConnReg, allocateConnection, connDispatch, setNotebookReg, setupDemo, setLoadingProgress, abort.signal);

                // Get session ID directly from the loaded notebook
                const demoSessionId = loaded.demo.sessionId;

                const totalDuration = performance.now() - totalStartTime;
                logger.info("Application loaded successfully", {
                    demoSessionId,
                    totalDurationMs: totalDuration.toFixed(2)
                }, "app_loader");

                // Mark the setup as done
                logger.info("Marking setup as done", {}, "app_loader");
                resolveSetupDone();

                // Await the setup of the static notebook
                // We might have received a notebook setup link in the meantime.
                // In that case, don't default-select the demo notebook
                if (abortDefaultNotebookSwitch.current.signal.aborted) {
                    logger.info("Notebook switch aborted by setup event", {}, "app_loader");
                    return;
                }

                logger.info("Finishing setup", {}, "app_loader");

                // Mark setup as done - no session selected yet, user will choose
                navigate({
                    type: FINISH_SETUP,
                    value: null
                });
            } finally {
                globalTraceContext.endSpan();
            }
        };
        run();
    }, [config]);

    // Setup done but no session selected? Show session selector
    if (routeContext.appLoadingStatus == AppLoadingStatus.SETUP_DONE && routeContext.sessionId === null) {
        return <SessionSelectorPage
            connectionRegistry={connReg}
            notebookRegistry={notebookReg}
            allocateConnection={allocateConnection}
            setupNotebook={setupNotebook}
            core={loadedCore}
        />;
    }

    // Setup done and session selected? Show main interface
    const pauseAfterSetup = config?.settings?.pauseAfterAppSetup ?? false;
    if (routeContext.appLoadingStatus == AppLoadingStatus.SETUP_DONE &&
        routeContext.sessionId !== null &&
        (!pauseAfterSetup || routeContext.confirmedFinishedSetup)) {
        return props.children;
    } else if (interactiveSetupArgs != null) {
        // Switch to the interactive setup?
        return <InteractiveAppSetupPage />;
    } else {
        // Otherwise show the app loading page
        return <AppLoadingPage pauseAfterSetup={config?.settings?.pauseAfterAppSetup ?? false} progress={loadingProgress} />;
    }
};
