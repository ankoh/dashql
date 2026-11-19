import * as React from 'react';
import { useLocation } from 'react-router-dom';

import { OPEN_EPHEMERAL_WORKBOOK, OPEN_LINK_WORKBOOK, workbookIdFromPathname, useRouterNavigate } from '../router.js';
import { useRuntime } from '@akohn/dashql-react/hooks';
import { embeddedConnection, newWorkbookConnection } from '../../connections/embedded_connection.js';
import { getHyperLinkTabState } from '../../connections/hyper/hyper_link_tab.js';
import { useDashQLCoreSetup } from '../../host/core_provider.js';
import { useLogger } from '../../host/logger_provider.js';
import { createTrace } from '@akohn/dashql/platform/logger/trace_context';
import { useEphemeralWorkbook } from '../../workbook/workbook_creation.js';
import { AppLoadingProgress } from './app_loading_progress.js';
import { ProgressCounter } from '@akohn/dashql/platform/utils/progress';
import { deleteSurplusEphemeralWorkbooks, loadApp, restoreProgress, selectStartupWorkbook, shouldFinishInitialNavigation } from './app_loading_logic.js';
import { useAppConfig } from '../../config/app_config.js';
import { useDeleteWorkbook } from '../../workbook/workbook_lifecycle.js';
import { useEmbeddedDatabaseSetup } from '../../host/embedded_database_provider.js';
import { getAppHost } from '@akohn/dashql-react/dom/app_host';
import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import type { InvalidWorkbook } from '../../workbook/workbook_lifecycle.js';
import { IndicatorStatus } from '@akohn/dashql-react/components/status_indicator';
import { useAppSettingsReady } from '../../config/app_settings_sync.js';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';

const LOG_CTX = "app_loader";

async function loadFonts(): Promise<void> {
    // The font families are theme tokens that the app flavor may override
    const style = getComputedStyle(document.documentElement);
    const family = style.getPropertyValue('--font_family').trim() || "'Instrument Sans'";
    const familyMono = style.getPropertyValue('--font_family_mono').trim() || "'JetBrains Mono'";
    await Promise.all([
        document.fonts.load(`300 16px ${family}`),
        document.fonts.load(`400 16px ${family}`),
        document.fonts.load(`500 16px ${family}`),
        document.fonts.load(`700 16px ${family}`),
        document.fonts.load(`400 16px ${familyMono}`),
        document.fonts.load(`500 16px ${familyMono}`),
        document.fonts.load(`700 16px ${familyMono}`),
    ]);
}

/// The setup of the app
export interface AppSetup {
    /// Resolves once the app state is restored
    done: Promise<void>;
    /// Resolves once the app opened the workbook it starts with
    opened: Promise<void>;
    /// The progress of the restoration
    progress: AppLoadingProgress;
    /// The status of the setup of the embedded database
    embeddedDatabaseStatus: IndicatorStatus;
}

/// Set up the app once its settings are ready.
///
/// The setup initializes the core, the embedded database and the fonts, restores the connections and
/// workbooks and makes sure that there is exactly one ephemeral workbook. It then opens the workbook of the path, otherwise
/// the greeter on the ephemeral workbook. A workbook that the app was started with is opened by its import instead,
/// `initialImport` resolves to true if it opened one.
export function useAppSetup(initialImport: React.RefObject<Promise<boolean> | null>): AppSetup {
    const config = useAppConfig();
    const appSettingsReady = useAppSettingsReady();
    const logger = useLogger();
    const navigate = useRouterNavigate();
    const setupCore = useDashQLCoreSetup();
    const ephemeralWorkbook = useEphemeralWorkbook();
    const deleteWorkbookScripts = useDeleteWorkbook();
    const pathname = useLocation().pathname;
    const runtime = useRuntime();
    const storageWriter = runtime.storage;
    const setupEmbeddedDatabase = useEmbeddedDatabaseSetup();

    const [embeddedDatabaseStatus, setEmbeddedDatabaseStatus] = React.useState<IndicatorStatus>(IndicatorStatus.None);
    const [progress, setProgress] = React.useState<AppLoadingProgress>(() => ({
        restoreConnections: new ProgressCounter(),
        restoreCatalogs: new ProgressCounter(),
        restoreWorkbookScripts: new ProgressCounter(),
    }));
    const [done, resolveDone] = React.useMemo(() => {
        let resolve: () => void;
        const promise = new Promise<void>(a => { resolve = a; });
        return [promise, resolve!] as const;
    }, []);
    const [opened, resolveOpened] = React.useMemo(() => {
        let resolve: () => void;
        const promise = new Promise<void>(a => { resolve = a; });
        return [promise, resolve!] as const;
    }, []);

    // Run the setup once at the beginning. We guard against re-runs triggered by config identity
    // changes (e.g. AppSettingsSync hydrating persisted settings into AppConfig).
    const hasStartedSetup = React.useRef(false);
    React.useEffect(() => {
        if (config == null || !appSettingsReady || hasStartedSetup.current) {
            return;
        }
        hasStartedSetup.current = true;
        let failedComponent: string | null = null;
        const trackInitialization = async <T,>(name: string, promise: Promise<T>): Promise<T> => {
            try {
                return await promise;
            } catch (error) {
                failedComponent ??= name;
                throw error;
            }
        };

        const run = async () => {
            // Start trace for app loading
            const traced = logger.withTrace(createTrace());
            traced.info("Initializing application", {}, LOG_CTX);
            const totalStartTime = performance.now();

            // Wait for Core and the platform's embedded database to be ready.
            traced.info("Initializing Core and embedded database", {}, LOG_CTX);
            const coreStartTime = performance.now();

            const corePromise = trackInitialization("Core", setupCore("app_setup"));
            setEmbeddedDatabaseStatus(IndicatorStatus.Running);
            const embeddedDatabasePromise = trackInitialization(
                "HyperDB",
                setupEmbeddedDatabase("app_setup").then(database => {
                    setEmbeddedDatabaseStatus(IndicatorStatus.Succeeded);
                    return database;
                }).catch(error => {
                    setEmbeddedDatabaseStatus(IndicatorStatus.Failed);
                    throw error;
                }),
            );
            const fontsPromise = trackInitialization("Fonts", loadFonts());
            await Promise.all([corePromise, embeddedDatabasePromise, fontsPromise]);

            const coreDuration = performance.now() - coreStartTime;
            traced.info("Core and embedded database ready", {
                durationMs: coreDuration.toFixed(2)
            }, LOG_CTX);

            // Load the app
            traced.info("Loading application state and workbooks", {}, LOG_CTX);
            const loaded = await trackInitialization(
                "Application state",
                loadApp(traced, {
                    restoreAppState: async progressConsumer => {
                        // The connections and the workbooks restore into the runtime, it writes through its writer
                        const restored = await runtime.restore(progress => progressConsumer(restoreProgress(progress)));
                        progressConsumer(restoreProgress(restored.progress));
                        const workbooks = new Map<string, WorkbookScripts>();
                        for (const workbookId of restored.workbookIds) {
                            const workbook = runtime.store.get('workbook', workbookId);
                            if (workbook != null) workbooks.set(workbookId, workbook);
                        }
                        const invalidWorkbooks = new Map<string, InvalidWorkbook>(restored.invalidWorkbooks.map(invalid => [invalid.workbookId, invalid]));
                        return { connectionIds: restored.connectionIds, workbooks, invalidWorkbooks };
                    },
                }, setProgress),
            );

            // The list of the workbooks holds the workbooks that were refused a load. This is just an
            // aggregate count for the log — each refused workbook already logs a WARN with its path
            // and reason, so a second WARN here would only duplicate the diagnostic. Keep it at INFO.
            if (loaded.invalidWorkbooks.size > 0) {
                traced.info("Some workbooks were refused a load", {
                    count: loaded.invalidWorkbooks.size.toString()
                }, LOG_CTX);
            }

            const totalDuration = performance.now() - totalStartTime;
            traced.info("Application loaded successfully", {
                totalDurationMs: totalDuration.toFixed(2)
            }, LOG_CTX);

            // Mark the setup as done
            traced.info("Marking setup as done", {}, LOG_CTX);
            resolveDone();

            traced.info("Finishing setup", {}, LOG_CTX);

            // Workbooks fall back to the embedded Hyper and the user can't attach one, the app always holds it.
            // The restored state lacks it when no workbook uses it, e.g. when every workbook runs on the Hyper of a link.
            const allocateConnection = runtime.createConnection.bind(runtime);
            const connections = new Map(runtime.store.all('connection') as ReadonlyMap<string, ConnectionState>);
            const embedded = embeddedConnection(connections.values(), allocateConnection);
            connections.set(embedded.connectionId, embedded);

            // The app holds exactly one ephemeral workbook, whatever it opens below
            await deleteSurplusEphemeralWorkbooks(loaded.restoredWorkbooks.values(), async workbookId => {
                await storageWriter.deleteWorkbook(workbookId);
                deleteWorkbookScripts(workbookId);
            }, (workbookId, error) => {
                traced.warn("Failed to delete a surplus ephemeral workbook", { workbookId, error: stringifyError(error) }, LOG_CTX);
            });
            const greeter = ephemeralWorkbook(newWorkbookConnection(connections, allocateConnection, getHyperLinkTabState().current));

            if (await shouldFinishInitialNavigation(initialImport.current)) {
                const workbookId = selectStartupWorkbook(workbookIdFromPathname(pathname), loaded.restoredWorkbooks);
                navigate(workbookId != null
                    ? { type: OPEN_LINK_WORKBOOK, value: workbookId }
                    : { type: OPEN_EPHEMERAL_WORKBOOK, value: greeter.workbookId });
            }
            resolveOpened();
            globalThis.__DASHQL_STARTUP__ = {
                embeddedDatabase: 'hyperdb-wasm',
                host: getAppHost(),
                status: 'ready',
            };
        };
        run().catch(error => {
            globalThis.__DASHQL_STARTUP__ = {
                embeddedDatabase: null,
                error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
                host: getAppHost(),
                status: 'failed',
            };
            logger.error("Application initialization failed", {
                component: failedComponent ?? "Unknown",
            }, LOG_CTX);
        });
    }, [appSettingsReady, config]);

    return { done, opened, progress, embeddedDatabaseStatus };
}
