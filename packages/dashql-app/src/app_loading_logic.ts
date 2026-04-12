import * as dashql from './core/index.js';

import { Logger } from './platform/logger/logger.js';
import { globalTraceContext } from './platform/logger/trace_context.js';
import { StorageReader } from './storage/storage_reader.js';
import { AppLoadingProgress, AppLoadingProgressConsumer } from './app_loading_progress.js';
import { ConnectionAllocator, DynamicConnectionDispatch, nextConnectionIdMustBeLargerThan, SetConnectionRegistryAction } from './connection/connection_registry.js';
import { ConnectionState, ConnectionStateAction, createDatalessConnectionState } from './connection/connection_state.js';
import { createDemoConnectionState } from './connection/demo/demo_connection_state.js';
import { AppConfig } from './app_config.js';
import { DemoDatabaseChannel } from './connection/demo/demo_database_channel.js';
import { setupDemoConnection } from './connection/demo/demo_connection_setup.js';
import { ConnectorType } from './connection/connector_info.js';
import { Dispatch } from './utils/variant.js';
import { nextWorbookIdMustBeLargerThan, SetNotebookRegistryAction } from './notebook/notebook_state_registry.js';
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
        logger.debug("loading app", {}, "app_loading");

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

        logger.debug("restoring app state", {}, "app_loading");

        /// First restore the previous app state
        const state = await storage.restoreAppState(core, partialProgressConsumer);
        nextConnectionIdMustBeLargerThan(state.maxConnectionId);
        nextWorbookIdMustBeLargerThan(state.maxNotebookId);

        // Reset the connection registry
        resetConnections({
            connectionMap: state.connectionStates,
            connectionsByType: state.connectionStatesByType,
            connectionsBySignature: state.connectionSignatures,
        });
        // Reset the notebook registry
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

        logger.debug("app state restored", {
            "max_connection_id": state.maxConnectionId.toString(),
            "max_notebook_id": state.maxNotebookId.toString(),
        }, "app_loading");

        // Check if we need to fill in the dataless connection
        let datalessConn: ConnectionState;
        if (state.connectionStatesByType[ConnectorType.DATALESS].length == 0) {
            logger.debug("creating dataless connection", {}, "app_loading");
            datalessConn = allocateConnection(createDatalessConnectionState(core, state.connectionSignatures));
        } else {
            const cid = state.connectionStatesByType[ConnectorType.DATALESS].values().next().value!;
            datalessConn = state.connectionStates.get(cid)!;
            logger.debug("using existing dataless connection", { "connection_id": cid.toString() }, "app_loading");
        }

        // Configure the demo connections
        let demoConn: ConnectionState | null = null;
        if (config.settings?.setupDemoConnection) {
            logger.debug("setting up demo connection", {}, "app_loading");
            // Create the demo connection if it's missing
            if (state.connectionStatesByType[ConnectorType.DEMO].length == 0) {
                demoConn = allocateConnection(createDemoConnectionState(core, state.connectionSignatures));
            } else {
                const cid = state.connectionStatesByType[ConnectorType.DEMO].values().next().value!;
                demoConn = state.connectionStates.get(cid)!;
            }

            // Create the default demo params
            const demoChannel = new DemoDatabaseChannel();
            // Curry the dispatch
            const dispatch = (action: ConnectionStateAction) => modifyConnection(demoConn!.connectionId, action);
            // Setup the demo connection
            await setupDemoConnection(dispatch, logger, demoChannel, abortSignal);
            logger.debug("demo connection setup complete", {}, "app_loading");
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
        logger.debug("setting up notebooks", {}, "app_loading");
        let datalessNotebook: NotebookState;
        if (state.notebooksByConnectionType[ConnectorType.DATALESS].length == 0) {
            datalessNotebook = await setupDatalessNotebook(datalessConn, abortSignal);
            logger.debug("dataless notebook created", { "notebook_id": datalessNotebook.notebookId.toString() }, "app_loading");
        } else {
            const wid = state.notebooksByConnectionType[ConnectorType.DATALESS].values().next().value!;
            datalessNotebook = state.notebooks.get(wid)!;
            logger.debug("using existing dataless notebook", { "notebook_id": wid.toString() }, "app_loading");
        }

        // Add a demo notebook if none exist
        let demoNotebook: NotebookState;
        if (demoConn != null) {
            demoNotebook = await setupDemoNotebook(demoConn, abortSignal);
            logger.debug("demo notebook created", { "notebook_id": demoNotebook.notebookId.toString() }, "app_loading");
        } else {
            const wid = state.notebooksByConnectionType[ConnectorType.DEMO].values().next().value!;
            demoNotebook = state.notebooks.get(wid)!;
        }

        progress = {
            ...progress,
            setupDefaultNotebooks: progress.setupDefaultNotebooks
                .clone()
                .addSucceeded()
        };
        consumer(progress);

        logger.debug("app loading complete", {}, "app_loading");

        return {
            dataless: datalessNotebook,
            demo: demoNotebook,
        };
    } finally {
        globalTraceContext.endSpan();
    }
}


