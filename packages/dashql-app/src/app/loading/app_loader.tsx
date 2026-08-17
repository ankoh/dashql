import * as React from 'react';

import { AppLoadingStatus } from '../router/app_loading_status.js';
import { NotebookSetupStatus } from '../router/notebook_setup_status.js';
import { FINISH_SETUP, OPEN_LINK_NOTEBOOK, useRouteContext, useRouterNavigate } from '../router/router.js';
import { isDebugBuild } from '../../shared/globals.js';
import { useConnectionRegistry, useConnectionStateAllocator, useDynamicConnectionDispatch } from '../notebook/connections/connection_registry.js';
import { useDashQLCoreSetup } from '../providers/core_provider.js';
import { useLogger } from '../../shared/platform/logger/logger_provider.js';
import { createTrace } from '../../shared/platform/logger/trace_context.js';
import { usePlatformEventListener } from '../../shared/platform/events/event_listener_provider.js';
import { useNotebookScriptsSetup } from '../notebook/scripts/notebook_scripts_setup.js';
import { AppLoadingPage } from '../ui/app_loading_page.js';
import { configureAppWithSetupEvent, FINISHED_LINK_SETUP, InteractiveAppSetupArgs, REQUIRES_INTERACTIVE_SETUP } from './app_setup_events.js';
import { InteractiveAppSetupPage } from '../ui/app_setup_page_interactive.js';
import { NotebookSelectorPage } from '../ui/notebook_selector_page.js';
import { SetupEventVariant } from '../../shared/platform/events/event.js';
import { AppLoadingProgress } from './app_loading_progress.js';
import { ProgressCounter } from '../../shared/utils/progress.js';
import { loadApp } from './app_loading_logic.js';
import { useAppConfig } from '../config/app_config.js';
import { useStorage } from '../notebook/persistence/storage_provider.js';
import { useNotebookScriptsRegistry } from '../notebook/scripts/notebook_scripts_registry.js';
import { useDemoNotebookScriptsSetup } from '../notebook/connections/dataless/dataless_notebook.js';
import { useEmbeddedDatabaseSetup } from '../../shared/platform/database/embedded_database_provider.js';
import { InvalidNotebook } from '../notebook/persistence/notebook_validation.js';

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
    const setupNotebookScripts = useNotebookScriptsSetup();
    const [storageReader, storageWriter] = useStorage();
    const allocateConnection = useConnectionStateAllocator();
    const [connReg, setConnReg] = useConnectionRegistry();
    const connectionSignatures = connReg.connectionsBySignature;
    const connDispatch = useDynamicConnectionDispatch()[1];
    const [notebookScriptsRegistry, setNotebookScriptsRegistry] = useNotebookScriptsRegistry();
    const setupDemoNotebookScripts = useDemoNotebookScriptsSetup();
    const setupEmbeddedDatabase = useEmbeddedDatabaseSetup();

    const appEvents = usePlatformEventListener();
    const abortDefaultNotebookSwitch = React.useRef(new AbortController());
    const [loadedCore, setLoadedCore] = React.useState<any>(null);
    // Notebooks whose metadata was refused a load. Surfaced (marked invalid, blocked, deletable) in
    // the notebook selector instead of being silently dropped.
    const [invalidNotebooks, setInvalidNotebooks] = React.useState<Map<string, InvalidNotebook>>(() => new Map());
    const [loadingProgress, setLoadingProgress] = React.useState<AppLoadingProgress>(() => ({
        restoreConnections: new ProgressCounter(),
        restoreCatalogs: new ProgressCounter(),
        restoreNotebookScripts: new ProgressCounter(),
        analyzeScripts: new ProgressCounter(),
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
    const consumeSetupEvent = React.useEffectEvent(async (data: SetupEventVariant) => {
        // Start trace for setup event handling
        const traced = logger.withTrace(createTrace());
        traced.debug("Consuming setup event", { "event_type": String(data.type) }, "app_loader");

        // Stop the default notebook switch after DashQL is ready
        abortDefaultNotebookSwitch.current.abort("notebook_setup_event");
        // Wait for core to be ready
        const core = await setupCore("app_setup");
        // Wait for the default connections to be created
        await setupDone;
        // Configure the app with the setup event. This imports the shared notebook into storage and
        // restores it (connection + catalog + notebook) into fresh scratch maps. It reuses the same
        // restore path as the boot loader, which takes the unwrapped (concrete) logger.
        const setupResult = await configureAppWithSetupEvent(
            data,
            logger,
            core,
            storageWriter.backend,
            connectionSignatures,
        );
        if (setupResult == null) {
            return;
        }
        // Are we done with the setup, or do we need an interactive setup?
        switch (setupResult.type) {
            case REQUIRES_INTERACTIVE_SETUP:
                traced.debug("Requires interactive setup", {}, "app_loader");
                setInteractiveSetupArgs(setupResult.value);
                break;
            case FINISHED_LINK_SETUP: {
                const { restoredNotebook } = setupResult.value;
                traced.debug("Finished link setup", { notebookId: restoredNotebook.notebookId }, "app_loader");

                // The initial app load already populated the registries, so merge the restored
                // notebook's connection + notebook into them here. Without this the notebook exists
                // only in storage and the connection setup screen would have nothing to render.
                setConnReg(reg => {
                    reg.connectionMap.set(restoredNotebook.notebookId, restoredNotebook.connection);
                    reg.connectionsByType[restoredNotebook.connectorType].push(restoredNotebook.notebookId);
                    reg.connectionsBySignature.set(restoredNotebook.connection.connectionSignature.signatureString, restoredNotebook.notebookId);
                    return { ...reg };
                });
                setNotebookScriptsRegistry(reg => {
                    reg.notebookScriptsMap.set(restoredNotebook.notebookId, restoredNotebook.notebookScripts);
                    reg.notebookScriptsByConnection.set(restoredNotebook.notebookId, restoredNotebook.notebookId);
                    reg.notebookScriptsByConnectionType[restoredNotebook.connectorType].push(restoredNotebook.notebookId);
                    return { ...reg };
                });

                // Land directly on this notebook's connection setup screen. OPEN_LINK_NOTEBOOK sets the
                // full route state atomically (setup done + notebook selected + CONFIGURING), so the
                // user drops straight into connecting to the shared notebook instead of the loading
                // ("Setup") screen or the notebook selector.
                navigate({ type: OPEN_LINK_NOTEBOOK, value: restoredNotebook.notebookId });
                break;
            }
        }
    });

    // Effect Events are non-reactive. Depending on consumeSetupEvent would resubscribe after every
    // render even though it always reads the latest callback state.
    React.useEffect(() => {
        appEvents.subscribeSetupEvents(consumeSetupEvent);
        return () => appEvents.unsubscribeSetupEvents(consumeSetupEvent);
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

            // Wait for Core and HyperDB to be ready.
            traced.info("Initializing Core and HyperDB", {}, "app_loader");
            const coreStartTime = performance.now();

            const [core] = await Promise.all([
                setupCore("app_setup"),
                setupEmbeddedDatabase("app_setup"),
                loadFonts(),
            ]);

            const coreDuration = performance.now() - coreStartTime;
            traced.info("Core and HyperDB ready", {
                durationMs: coreDuration.toFixed(2)
            }, "app_loader");

            // Store loaded core for notebook selector
            setLoadedCore(core);

            // Load the app
            traced.info("Loading application state and notebooks", {}, "app_loader");
            const loaded = await loadApp(config, traced, core, storageReader, setConnReg, allocateConnection, connDispatch, setNotebookScriptsRegistry, setupDemoNotebookScripts, setLoadingProgress, abort.signal);

            // Surface any notebooks that were refused a load in the selector. This is just an
            // aggregate count for the log — each refused notebook already logs a WARN with its path
            // and reason, so a second WARN here would only duplicate the diagnostic. Keep it at INFO.
            if (loaded.invalidNotebooks.size > 0) {
                traced.info("Some notebooks were refused a load", {
                    count: loaded.invalidNotebooks.size.toString()
                }, "app_loader");
                setInvalidNotebooks(loaded.invalidNotebooks);
            }

            // Get notebook ID directly from the loaded notebook
            const demoNotebookId = loaded.demo.notebookId;

            const totalDuration = performance.now() - totalStartTime;
            traced.info("Application loaded successfully", {
                demoNotebookId,
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

            // Mark setup as done - no notebook selected yet, user will choose
            navigate({
                type: FINISH_SETUP,
                value: null
            });
        };
        run();
    }, [config]);

    // Delete an invalid notebook: remove its files from storage and drop it from the selector list.
    // Invalid notebooks never entered the connection/notebook registries, so there is nothing to
    // dispatch there — only the persisted files and our local list need cleaning up.
    const deleteInvalidNotebook = React.useCallback(async (notebookId: string) => {
        try {
            await storageWriter.backend.deleteNotebook(notebookId);
        } catch (e) {
            logger.error("Failed to delete invalid notebook", { notebookId, error: String(e) }, "app_loader");
        }
        setInvalidNotebooks(prev => {
            if (!prev.has(notebookId)) return prev;
            const next = new Map(prev);
            next.delete(notebookId);
            return next;
        });
    }, [storageWriter, logger]);

    // Setup done but no notebook selected, or notebook setup in progress? Show notebook selector
    if (routeContext.appLoadingStatus == AppLoadingStatus.SETUP_DONE &&
        (routeContext.notebookId === null || routeContext.notebookSetupStatus === NotebookSetupStatus.CONFIGURING)) {
        return <NotebookSelectorPage
            connectionRegistry={connReg}
            notebookScriptsRegistry={notebookScriptsRegistry}
            allocateConnection={allocateConnection}
            setupNotebookScripts={setupNotebookScripts}
            core={loadedCore}
            invalidNotebooks={invalidNotebooks}
            onDeleteInvalidNotebook={deleteInvalidNotebook}
        />;
    }

    // Setup done and notebook selected? Show main interface
    const pauseAfterSetup = config?.settings?.pauseAfterAppSetup ?? false;
    if (routeContext.appLoadingStatus == AppLoadingStatus.SETUP_DONE &&
        routeContext.notebookId !== null &&
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
