import * as dashql from './core/index.js';

import { Logger } from './platform/logger/logger.js';
import { StorageReader } from './platform/storage/storage_provider.js';
import { globalTraceContext } from './platform/logger/trace_context.js';
import { AppLoadingProgress, AppLoadingProgressConsumer } from './app_loading_progress.js';
import { ConnectionAllocator, DynamicConnectionDispatch, SetConnectionRegistryAction } from './connection/connection_registry.js';
import { ConnectionState, ConnectionStateAction, createDatalessConnectionState } from './connection/connection_state.js';
import { createDemoConnectionState } from './connection/demo/demo_connection_state.js';
import { AppConfig } from './app_config.js';
import { DemoDatabaseChannel } from './connection/demo/demo_database_channel.js';
import { setupDemoConnection } from './connection/demo/demo_connection_setup.js';
import { ConnectorType } from './connection/connector_info.js';
import { Dispatch } from './utils/variant.js';
import { SetNotebookRegistryAction } from './notebook/notebook_state_registry.js';
import { NotebookSetupFn } from './connection/demo/demo_notebook.js';
import { ProgressCounter } from './utils/progress.js';
import { NotebookState } from './notebook/notebook_state.js';

export interface AppLoadingResult {
    /// The dataless notebook
    dataless: NotebookState;
    /// The demo notebook
    demo: NotebookState | null;
}

/// Main logic to setup the application
export async function loadApp(config: AppConfig, logger: Logger, core: dashql.DashQL, storage: StorageReader, resetConnections: Dispatch<SetConnectionRegistryAction>, allocateConnection: ConnectionAllocator, modifyConnection: DynamicConnectionDispatch, resetNotebooks: Dispatch<SetNotebookRegistryAction>, setupDatalessNotebook: NotebookSetupFn, setupDemoNotebook: NotebookSetupFn, consumer: AppLoadingProgressConsumer, abortSignal: AbortSignal) {
    // Create child span for loadApp
    globalTraceContext.startSpan();
    try {
        logger.info("Loading application", {}, "app_loading");
        const appLoadStartTime = performance.now();

        let progress: AppLoadingProgress = {
            restoreConnections: new ProgressCounter(),
            restoreCatalogs: new ProgressCounter(),
            restoreNotebooks: new ProgressCounter(),
            setupDefaultConnections: new ProgressCounter(1),
            setupDefaultNotebooks: new ProgressCounter(1),
        };
        const partialProgressConsumer = (update: Partial<AppLoadingProgress>) => {
            progress = {
                ...progress,
                ...update
            };
            consumer(progress);
        };

        logger.info("Restoring application state", {}, "app_loading");
        const restoreStartTime = performance.now();

        /// First restore the previous app state
        const state = await storage.restoreAppState(core, partialProgressConsumer);

        const restoreDuration = performance.now() - restoreStartTime;
        logger.info("Restored application state", {
            connections: state.connectionStates.size.toString(),
            notebooks: state.notebooks.size.toString(),
            durationMs: restoreDuration.toFixed(2)
        }, "app_loading");

        // Reset the connection registry
        logger.info("Updating connection registry", {
            connectionCount: state.connectionStates.size.toString()
        }, "app_loading");
        resetConnections({
            connectionMap: state.connectionStates,
            connectionsByType: state.connectionStatesByType,
            connectionsBySignature: state.connectionSignatures,
        });

        // Reset the notebook registry
        logger.info("Updating notebook registry", {
            notebookCount: state.notebooks.size.toString()
        }, "app_loading");
        resetNotebooks({
            notebookMap: state.notebooks,
            notebooksByConnection: state.notebooksByConnection,
            notebooksByConnectionType: state.notebooksByConnectionType,
        });

        progress = {
            ...progress,
            setupDefaultConnections: progress.setupDefaultConnections
                .clone()
                .addStarted()
        };
        consumer(progress);

        logger.info("Setting up default connections", {}, "app_loading");

        // Check if we need to fill in the dataless connection
        let datalessConn: ConnectionState;
        if (state.connectionStatesByType[ConnectorType.DATALESS].length == 0) {
            logger.info("Creating dataless connection", {}, "app_loading");
            datalessConn = allocateConnection(createDatalessConnectionState(core, state.connectionSignatures));
        } else {
            const sessionId = state.connectionStatesByType[ConnectorType.DATALESS].values().next().value!;
            datalessConn = state.connectionStates.get(sessionId)!;
            logger.info("Using existing dataless connection", { sessionId }, "app_loading");
        }

        // Configure the demo connections
        let demoConn: ConnectionState | null = null;
        if (config.settings?.setupDemoConnection) {
            logger.info("Setting up demo connection", {}, "app_loading");
            const demoSetupStartTime = performance.now();

            // Create the demo connection if it's missing
            if (state.connectionStatesByType[ConnectorType.DEMO].length == 0) {
                logger.info("Creating demo connection", {}, "app_loading");
                demoConn = allocateConnection(createDemoConnectionState(core, state.connectionSignatures));
            } else {
                const sessionId = state.connectionStatesByType[ConnectorType.DEMO].values().next().value!;
                demoConn = state.connectionStates.get(sessionId)!;
                logger.info("Using existing demo connection", { sessionId }, "app_loading");
            }

            // Create the default demo params
            logger.info("Creating demo database channel", {}, "app_loading");
            const demoChannel = new DemoDatabaseChannel();
            // Curry the dispatch
            const dispatch = (action: ConnectionStateAction) => modifyConnection(demoConn!.sessionId, action);
            // Setup the demo connection
            logger.info("Setting up demo connection", {}, "app_loading");
            await setupDemoConnection(dispatch, logger, demoChannel, abortSignal);

            const demoSetupDuration = performance.now() - demoSetupStartTime;
            logger.info("Demo connection setup complete", {
                durationMs: demoSetupDuration.toFixed(2)
            }, "app_loading");
        } else {
            logger.info("Demo connection disabled in config", {}, "app_loading");
        }

        progress = {
            ...progress,
            setupDefaultConnections: progress.setupDefaultConnections
                .clone()
                .addSucceeded(),
            setupDefaultNotebooks: progress.setupDefaultNotebooks
                .clone()
                .addStarted(),
        };
        consumer(progress);

        // Add a dataless notebook if none exist
        logger.info("Setting up default notebooks", {}, "app_loading");
        const notebookSetupStartTime = performance.now();

        let datalessNotebook: NotebookState;
        if (state.notebooksByConnectionType[ConnectorType.DATALESS].length == 0) {
            // Check if we restored a dataless connection from storage but failed to restore its notebook
            // This prevents data loss by warning instead of silently creating a fresh notebook
            const hadRestoredConnection = state.connectionStatesByType[ConnectorType.DATALESS].length > 0;
            if (hadRestoredConnection) {
                logger.warn("Restored dataless connection but failed to restore notebook - creating new notebook", {
                    sessionId: datalessConn.sessionId
                }, "app_loading");
            } else {
                logger.info("Creating dataless notebook", {}, "app_loading");
            }
            datalessNotebook = await setupDatalessNotebook(datalessConn, abortSignal);
            logger.info("Created dataless notebook", {
                sessionId: datalessNotebook.sessionId
            }, "app_loading");
        } else {
            const wid = state.notebooksByConnectionType[ConnectorType.DATALESS].values().next().value!;
            datalessNotebook = state.notebooks.get(wid)!;
            logger.info("Using existing dataless notebook", {
                notebookId: wid.toString()
            }, "app_loading");
        }

        // Add a demo notebook if none exist
        let demoNotebook: NotebookState;
        if (demoConn != null) {
            logger.info("Creating demo notebook", {}, "app_loading");
            demoNotebook = await setupDemoNotebook(demoConn, abortSignal);
            logger.info("Created demo notebook", {
                sessionId: demoNotebook.sessionId
            }, "app_loading");
        } else {
            const wid = state.notebooksByConnectionType[ConnectorType.DEMO].values().next().value!;
            demoNotebook = state.notebooks.get(wid)!;
            logger.info("Using existing demo notebook", {
                notebookId: wid.toString()
            }, "app_loading");
        }

        const notebookSetupDuration = performance.now() - notebookSetupStartTime;
        logger.info("Default notebooks setup complete", {
            durationMs: notebookSetupDuration.toFixed(2)
        }, "app_loading");

        progress = {
            ...progress,
            setupDefaultNotebooks: progress.setupDefaultNotebooks
                .clone()
                .addSucceeded()
        };
        consumer(progress);

        const totalAppLoadDuration = performance.now() - appLoadStartTime;
        logger.info("Application loading complete", {
            totalDurationMs: totalAppLoadDuration.toFixed(2)
        }, "app_loading");

        return {
            dataless: datalessNotebook,
            demo: demoNotebook,
        };
    } finally {
        globalTraceContext.endSpan();
    }
}


