import * as React from 'react';
import type * as core from '@akohn/dashql';
import { useLocation } from 'react-router-dom';

import { OPEN_EPHEMERAL_WORKBOOK, OPEN_LINK_WORKBOOK, workbookIdFromPathname, useRouterNavigate } from '../router.js';
import { useRuntime } from '@akohn/dashql-react/hooks';
import { embeddedConnection, newWorkbookConnection } from '../../connections/embedded_connection.js';
import { getHyperLinkTabState } from '../../connections/hyper/hyper_link.js';
import { useDashQLCoreSetup } from '../../host/core_provider.js';
import { useLogger } from '../../host/logger_provider.js';
import { createTrace } from '@akohn/dashql/platform/logger/trace_context';
import { useEphemeralWorkbook } from '../../workbook/workbook_creation.js';
import { deleteSurplusEphemeralWorkbooks, selectStartupWorkbook, shouldFinishInitialNavigation } from './app_loading_logic.js';
import { useAppConfig } from '../../config/app_config.js';
import { useDeleteWorkbook } from '../../workbook/workbook_lifecycle.js';
import { useEmbeddedDatabaseSetup } from '../../host/embedded_database_provider.js';
import { getAppHost } from '@akohn/dashql-react/dom/app_host';
import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
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

/// The phase of the setup of the app: it sets up the core, the embedded database and the fonts and restores its state
/// (`restoring`), opens the workbook that it starts with (`opening`) and is set up (`opened`), or it failed (`failed`)
export type AppSetupPhase = 'restoring' | 'opening' | 'opened' | 'failed';

/// Did the app restore its state? Imports and the cloud setup use the restored registries.
export function isAppStateRestored(phase: AppSetupPhase): boolean {
    return phase === 'opening' || phase === 'opened';
}

const SETUP_CONFIRMATION_CTX = React.createContext<(confirmed: boolean) => void>(() => { });

/// Confirm the finished setup, or take the confirmation back: an app that pauses after its setup shows the setup page
/// until the user confirms. The app loader provides it to the workbench.
export const AppSetupConfirmationProvider = SETUP_CONFIRMATION_CTX.Provider;
export const useAppSetupConfirmation = (): ((confirmed: boolean) => void) => React.useContext(SETUP_CONFIRMATION_CTX);

/// The setup of the app
export interface AppSetup {
    /// The phase of the setup
    phase: AppSetupPhase;
    /// The progress of the restoration, null until it started
    progress: core.RestoreProgress | null;
    /// The status of the setup of the embedded database
    embeddedDatabaseStatus: IndicatorStatus;
    /// Why the setup failed, null while it did not fail
    error: string | null;
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
    const deleteWorkbook = useDeleteWorkbook();
    const pathname = useLocation().pathname;
    const runtime = useRuntime();
    const setupEmbeddedDatabase = useEmbeddedDatabaseSetup();

    const [embeddedDatabaseStatus, setEmbeddedDatabaseStatus] = React.useState<IndicatorStatus>(IndicatorStatus.None);
    const [progress, setProgress] = React.useState<core.RestoreProgress | null>(null);
    const [phase, setPhase] = React.useState<AppSetupPhase>('restoring');
    const [error, setError] = React.useState<string | null>(null);

    // Run the setup once at the beginning. We guard against re-runs triggered by config identity
    // changes (e.g. AppSettingsSync hydrating persisted settings into AppConfig).
    const hasStartedSetup = React.useRef(false);
    // The setup reads the values of the render that starts it
    const startSetup = React.useEffectEvent(() => {
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

            if (setupEmbeddedDatabase == null) throw new Error("The app has no embedded database");
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

            // Restore the connections and the workbooks into the runtime, it writes through its writer
            traced.info("Restoring application state", {}, LOG_CTX);
            const restoreStartTime = performance.now();
            const restored = await trackInitialization(
                "Application state",
                runtime.restore(setProgress),
            );
            setProgress(restored.progress);
            // The workbooks that the runtime took, in the order of the workbook tree
            const restoredWorkbooks = new Map<string, WorkbookScripts>();
            for (const workbookId of restored.workbookIds) {
                const workbook = runtime.store.get('workbook', workbookId);
                if (workbook != null) restoredWorkbooks.set(workbookId, workbook);
            }
            traced.info("Restored application state", {
                connections: restored.connectionIds.length.toString(),
                workbooks: restoredWorkbooks.size.toString(),
                durationMs: (performance.now() - restoreStartTime).toFixed(2),
            }, LOG_CTX);

            // The list of the workbooks holds the workbooks that were refused a load. This is just an
            // aggregate count for the log — each refused workbook already logs a WARN with its path
            // and reason, so a second WARN here would only duplicate the diagnostic. Keep it at INFO.
            if (restored.invalidWorkbooks.length > 0) {
                traced.info("Some workbooks were refused a load", {
                    count: restored.invalidWorkbooks.length.toString()
                }, LOG_CTX);
            }

            const totalDuration = performance.now() - totalStartTime;
            traced.info("Application loaded successfully", {
                totalDurationMs: totalDuration.toFixed(2)
            }, LOG_CTX);

            traced.info("Opening the startup workbook", {}, LOG_CTX);
            setPhase('opening');

            // Workbooks fall back to the embedded Hyper and the user can't attach one, the app always holds it.
            // The restored state lacks it when no workbook uses it, e.g. when every workbook runs on the Hyper of a link.
            const allocateConnection = runtime.createConnection.bind(runtime);
            const connections = new Map(runtime.store.all('connection') as ReadonlyMap<string, ConnectionState>);
            const embedded = embeddedConnection(connections.values(), allocateConnection);
            connections.set(embedded.connectionId, embedded);

            // The app holds exactly one ephemeral workbook, whatever it opens below
            await deleteSurplusEphemeralWorkbooks(restoredWorkbooks.values(), deleteWorkbook, (workbookId, error) => {
                traced.warn("Failed to delete a surplus ephemeral workbook", { workbookId, error: stringifyError(error) }, LOG_CTX);
            });
            const greeter = ephemeralWorkbook(newWorkbookConnection(connections, allocateConnection, getHyperLinkTabState().current));

            if (await shouldFinishInitialNavigation(initialImport.current)) {
                const workbookId = selectStartupWorkbook(workbookIdFromPathname(pathname), restoredWorkbooks);
                navigate(workbookId != null
                    ? { type: OPEN_LINK_WORKBOOK, value: workbookId }
                    : { type: OPEN_EPHEMERAL_WORKBOOK, value: greeter.workbookId });
            }
            setPhase('opened');
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
            const component = failedComponent ?? "Unknown";
            logger.error("Application initialization failed", {
                component,
                error: stringifyError(error),
            }, LOG_CTX);
            setError(`${component}: ${stringifyError(error)}`);
            setPhase('failed');
        });
    });
    React.useEffect(() => {
        if (config == null || !appSettingsReady || hasStartedSetup.current) {
            return;
        }
        hasStartedSetup.current = true;
        startSetup();
    }, [appSettingsReady, config]);

    return { phase, progress, embeddedDatabaseStatus, error };
}
