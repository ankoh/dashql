import * as dashql from './core/index.js';

import { TracedLogger } from './platform/logger/logger.js';
import { StorageReader } from './platform/storage/storage_provider.js';
import { AppLoadingProgress, AppLoadingProgressConsumer } from './app_loading_progress.js';
import { ConnectionAllocator, DynamicConnectionDispatch, SetConnectionRegistryAction } from './connection/connection_registry.js';
import { ConnectionState, ConnectionStateAction } from './connection/connection_state.js';
import { createDatalessConnectionState } from './connection/dataless/dataless_connection_state.js';
import { AppConfig } from './app_config.js';
import { DemoDatabaseChannel } from './connection/dataless/dataless_demo_channel.js';
import { setupDatalessDemoConnection } from './connection/dataless/dataless_demo_setup.js';
import { ConnectorType, DATALESS_CONNECTOR } from './connection/connector_info.js';
import { Dispatch } from './utils/variant.js';
import { SetNotebookRegistryAction } from './notebook/notebook_state_registry.js';
import { NotebookSetupFn } from './connection/dataless/dataless_notebook.js';
import { ProgressCounter } from './utils/progress.js';
import { NotebookState } from './notebook/notebook_state.js';
import { isDemoConnector } from './connection/dataless/dataless_connection_state.js';
import { DatalessConnectionStateDetails } from './connection/dataless/dataless_connection_state.js';

export interface AppLoadingResult {
    /// The demo notebook
    demo: NotebookState;
}

/// Main logic to setup the application
export async function loadApp(config: AppConfig, logger: TracedLogger, core: dashql.DashQL, storage: StorageReader, resetConnections: Dispatch<SetConnectionRegistryAction>, allocateConnection: ConnectionAllocator, modifyConnection: DynamicConnectionDispatch, resetNotebooks: Dispatch<SetNotebookRegistryAction>, setupDemoNotebook: NotebookSetupFn, consumer: AppLoadingProgressConsumer, abortSignal: AbortSignal) {
    const traced = logger.childSpan();
    traced.info("Loading application", {}, "app_loading");
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

    traced.info("Restoring application state", {}, "app_loading");
    const restoreStartTime = performance.now();

    /// First restore the previous app state
    const state = await storage.restoreAppState(core, partialProgressConsumer);

    const restoreDuration = performance.now() - restoreStartTime;
    traced.info("Restored application state", {
        connections: state.connectionStates.size.toString(),
        notebooks: state.notebooks.size.toString(),
        durationMs: restoreDuration.toFixed(2)
    }, "app_loading");

    // Reset the connection registry
    traced.info("Updating connection registry", {
        connectionCount: state.connectionStates.size.toString()
    }, "app_loading");
    resetConnections({
        connectionMap: state.connectionStates,
        connectionsByType: state.connectionStatesByType,
        connectionsBySignature: state.connectionSignatures,
    });

    // Reset the notebook registry
    traced.info("Updating notebook registry", {
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

    traced.info("Setting up default connections", {}, "app_loading");

    // Configure the demo connection (as a dataless connection with demoConnector enabled)
    let demoConn: ConnectionState;
    if (config.settings?.setupDemoConnection) {
        traced.info("Setting up demo connection", {}, "app_loading");
        const demoSetupStartTime = performance.now();

        // Find an existing dataless connection with demoConnector enabled
        const existingDemoSessionId = findDemoConnection(state.connectionStatesByType, state.connectionStates);

        if (!existingDemoSessionId) {
            traced.info("Creating demo connection", {}, "app_loading");
            demoConn = allocateConnection(createDatalessConnectionState(core, state.connectionSignatures, { demoConnector: true }));
        } else {
            demoConn = state.connectionStates.get(existingDemoSessionId)!;
            traced.info("Using existing demo connection", { sessionId: existingDemoSessionId }, "app_loading");
        }

        // Create the default demo params
        traced.info("Creating demo database channel", {}, "app_loading");
        const demoChannel = new DemoDatabaseChannel();
        // Curry the dispatch
        const dispatch = (action: ConnectionStateAction) => modifyConnection(demoConn!.sessionId, action);
        // Setup the demo connection
        traced.info("Setting up demo connection", {}, "app_loading");
        await setupDatalessDemoConnection(dispatch, traced, demoChannel, abortSignal);

        const demoSetupDuration = performance.now() - demoSetupStartTime;
        traced.info("Demo connection setup complete", {
            durationMs: demoSetupDuration.toFixed(2)
        }, "app_loading");
    } else {
        traced.error("Demo connection is required but disabled in config", {}, "app_loading");
        throw new Error("Demo connection is required");
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

    // Add a demo notebook if none exist
    traced.info("Setting up default notebooks", {}, "app_loading");
    const notebookSetupStartTime = performance.now();

    let demoNotebook: NotebookState;
    const existingDemoNotebookId = findDemoNotebook(state.notebooksByConnectionType, state.connectionStatesByType, state.connectionStates, state.notebooks);
    if (!existingDemoNotebookId) {
        traced.info("Creating demo notebook", {}, "app_loading");
        demoNotebook = await setupDemoNotebook(demoConn, abortSignal);
        traced.info("Created demo notebook", {
            sessionId: demoNotebook.sessionId
        }, "app_loading");
    } else {
        demoNotebook = state.notebooks.get(existingDemoNotebookId)!;
        traced.info("Using existing demo notebook", {
            notebookId: existingDemoNotebookId.toString()
        }, "app_loading");
    }

    const notebookSetupDuration = performance.now() - notebookSetupStartTime;
    traced.info("Default notebooks setup complete", {
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
    traced.info("Application loading complete", {
        totalDurationMs: totalAppLoadDuration.toFixed(2)
    }, "app_loading");

    return {
        demo: demoNotebook,
    };
}

/// Find an existing dataless connection with demoConnector enabled
function findDemoConnection(connectionStatesByType: string[][], connectionStates: Map<string, ConnectionState>): string | null {
    const datalessIds = connectionStatesByType[ConnectorType.DATALESS] ?? [];
    for (const sessionId of datalessIds) {
        const conn = connectionStates.get(sessionId);
        if (conn) {
            const details = conn.details.value as DatalessConnectionStateDetails;
            if (isDemoConnector(details)) {
                return sessionId;
            }
        }
    }
    return null;
}

/// Find an existing notebook connected to a demo connection
function findDemoNotebook(
    notebooksByConnectionType: string[][],
    connectionStatesByType: string[][],
    connectionStates: Map<string, ConnectionState>,
    notebooks: Map<string, NotebookState>,
): string | null {
    // Look through dataless notebooks to find one connected to a demo-mode connection
    const datalessNotebookIds = notebooksByConnectionType[ConnectorType.DATALESS] ?? [];
    for (const nbId of datalessNotebookIds) {
        const nb = notebooks.get(nbId);
        if (!nb) continue;
        // Check the associated connection for demoConnector
        const conn = connectionStates.get(nb.sessionId);
        if (conn && conn.details.type === DATALESS_CONNECTOR) {
            const details = conn.details.value as DatalessConnectionStateDetails;
            if (isDemoConnector(details)) {
                return nbId;
            }
        }
    }
    return null;
}
