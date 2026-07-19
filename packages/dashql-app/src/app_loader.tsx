import * as React from 'react';

import { AppLoadingStatus } from './app_loading_status.js';
import { SessionSetupStatus } from './session_setup_status.js';
import { FINISH_SETUP, SELECT_SESSION, useRouteContext, useRouterNavigate } from './router.js';
import { isDebugBuild } from './globals.js';
import { useConnectionRegistry, useConnectionStateAllocator, useDynamicConnectionDispatch } from './connection/connection_registry.js';
import { useDashQLCoreSetup } from './core_provider.js';
import { useLogger } from './platform/logger/logger_provider.js';
import { createTrace } from './platform/logger/trace_context.js';
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
import { InvalidSession } from './platform/storage/session_validation.js';

async function loadFonts(): Promise<void> {
    await Promise.all([
        document.fonts.load("300 16px 'Roboto'"),
        document.fonts.load("400 16px 'Roboto'"),
        document.fonts.load("500 16px 'Roboto'"),
        document.fonts.load("700 16px 'Roboto'"),
        document.fonts.load("400 16px 'Roboto Mono'"),
        document.fonts.load("500 16px 'Roboto Mono'"),
        document.fonts.load("700 16px 'Roboto Mono'"),
    ]);
}

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
    // Sessions whose metadata was refused a load. Surfaced (marked invalid, blocked, deletable) in
    // the session selector instead of being silently dropped.
    const [invalidSessions, setInvalidSessions] = React.useState<Map<string, InvalidSession>>(() => new Map());
    const [loadingProgress, setLoadingProgress] = React.useState<AppLoadingProgress>(() => ({
        restoreConnections: new ProgressCounter(),
        restoreCatalogs: new ProgressCounter(),
        restoreNotebooks: new ProgressCounter(),
        analyzeNotebooks: new ProgressCounter(),
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
        const traced = logger.withTrace(createTrace());
        traced.debug("Consuming setup event", { "event_type": String(data.type) }, "app_loader");

        // Stop the default notebook switch after DashQL is ready
        abortDefaultNotebookSwitch.current.abort("notebook_setup_event");
        // Wait for core to be ready
        const core = await setupCore("app_setup");
        // Wait for the default connections to be created
        await setupDone;
        // Configure the app with the setup event
        const interactiveSetupDone = () => { setInteractiveSetupArgs(null); };
        const setupResult = await configureAppWithSetupEvent(data, traced, core, allocateConnection, setupNotebook, connReg, storageWriter.backend, interactiveSetupDone);
        if (setupResult == null) {
            return;
        }
        // Are we done with the setup, or do we need an interactive setup?
        switch (setupResult.type) {
            case REQUIRES_INTERACTIVE_SETUP:
                traced.debug("Requires interactive setup", {}, "app_loader");
                setInteractiveSetupArgs(setupResult.value);
                break;
            case FINISHED_LINK_SETUP:
                traced.debug("Finished link setup", {}, "app_loader");
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
            const traced = logger.withTrace(createTrace());
            traced.info("Initializing application", {}, "app_loader");
            const totalStartTime = performance.now();

            // Wait for core and webdb to be ready
            traced.info("Initializing core and WebDB", {}, "app_loader");
            const coreStartTime = performance.now();

            const [core] = await Promise.all([
                setupCore("app_setup"),
                setupWebDB("app_setup"),
                loadFonts(),
            ]);

            const coreDuration = performance.now() - coreStartTime;
            traced.info("Core and WebDB ready", {
                durationMs: coreDuration.toFixed(2)
            }, "app_loader");

            // Store loaded core for session selector
            setLoadedCore(core);

            // Load the app
            traced.info("Loading application state and notebooks", {}, "app_loader");
            const loaded = await loadApp(config, traced, core, storageReader, setConnReg, allocateConnection, connDispatch, setNotebookReg, setupDemo, setLoadingProgress, abort.signal);

            // Surface any sessions that were refused a load in the selector. This is just an
            // aggregate count for the log — each refused session already logs a WARN with its path
            // and reason (which raises a UI popup), so a second WARN here would only double up. Keep
            // it at INFO.
            if (loaded.invalidSessions.size > 0) {
                traced.info("Some sessions were refused a load", {
                    count: loaded.invalidSessions.size.toString()
                }, "app_loader");
                setInvalidSessions(loaded.invalidSessions);
            }

            // Get session ID directly from the loaded notebook
            const demoSessionId = loaded.demo.sessionId;

            const totalDuration = performance.now() - totalStartTime;
            traced.info("Application loaded successfully", {
                demoSessionId,
                totalDurationMs: totalDuration.toFixed(2)
            }, "app_loader");

            // Mark the setup as done
            traced.info("Marking setup as done", {}, "app_loader");
            resolveSetupDone();

            // Await the setup of the static notebook
            // We might have received a notebook setup link in the meantime.
            // In that case, don't default-select the demo notebook
            if (abortDefaultNotebookSwitch.current.signal.aborted) {
                traced.info("Notebook switch aborted by setup event", {}, "app_loader");
                return;
            }

            traced.info("Finishing setup", {}, "app_loader");

            // Mark setup as done - no session selected yet, user will choose
            navigate({
                type: FINISH_SETUP,
                value: null
            });
        };
        run();
    }, [config]);

    // Delete an invalid session: remove its files from storage and drop it from the selector list.
    // Invalid sessions never entered the connection/notebook registries, so there is nothing to
    // dispatch there — only the persisted files and our local list need cleaning up.
    const deleteInvalidSession = React.useCallback(async (sessionId: string) => {
        try {
            await storageWriter.backend.deleteSession(sessionId);
        } catch (e) {
            logger.error("Failed to delete invalid session", { sessionId, error: String(e) }, "app_loader");
        }
        setInvalidSessions(prev => {
            if (!prev.has(sessionId)) return prev;
            const next = new Map(prev);
            next.delete(sessionId);
            return next;
        });
    }, [storageWriter, logger]);

    // Setup done but no session selected, or session setup in progress? Show session selector
    if (routeContext.appLoadingStatus == AppLoadingStatus.SETUP_DONE &&
        (routeContext.sessionId === null || routeContext.sessionSetupStatus === SessionSetupStatus.CONFIGURING)) {
        return <SessionSelectorPage
            connectionRegistry={connReg}
            notebookRegistry={notebookReg}
            allocateConnection={allocateConnection}
            setupNotebook={setupNotebook}
            core={loadedCore}
            invalidSessions={invalidSessions}
            onDeleteInvalidSession={deleteInvalidSession}
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
