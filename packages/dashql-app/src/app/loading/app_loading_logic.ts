import * as dashql from '../../core/index.js';

import { TracedLogger } from '../../platform/logger/logger.js';
import { StorageReader } from '../notebook/persistence/storage_provider.js';
import { AppLoadingProgress, AppLoadingProgressConsumer } from './app_loading_progress.js';
import { ConnectionAllocator, DynamicConnectionDispatch, SetConnectionRegistryAction } from '../notebook/connections/connection_registry.js';
import { ConnectionState, ConnectionStateAction } from '../notebook/connections/connection_state.js';
import { createDatalessConnectionState } from '../notebook/connections/dataless/dataless_connection_state.js';
import { AppConfig } from '../config/app_config.js';
import { DemoDatabaseChannel } from '../notebook/connections/dataless/dataless_demo_channel.js';
import { setupDatalessDemoConnection } from '../notebook/connections/dataless/dataless_demo_setup.js';
import { ConnectorType, DATALESS_CONNECTOR } from '../notebook/connections/connector_info.js';
import { Dispatch } from '../../utils/variant.js';
import { SetNotebookScriptsRegistryAction } from '../notebook/scripts/notebook_scripts_registry.js';
import { NotebookScriptsSetupFn } from '../notebook/connections/dataless/dataless_notebook.js';
import { ProgressCounter } from '../../utils/progress.js';
import { NotebookScripts } from '../notebook/scripts/notebook_scripts.js';
import { isDemoConnector } from '../notebook/connections/dataless/dataless_connection_state.js';
import { DatalessConnectionStateDetails } from '../notebook/connections/dataless/dataless_connection_state.js';
import { InvalidNotebook } from '../notebook/persistence/notebook_validation.js';

export interface AppLoadingResult {
    /// The demo notebook scripts
    demo: NotebookScripts;
    /// Notebooks whose metadata failed validation and were refused a load (keyed by bare UUID).
    invalidNotebooks: Map<string, InvalidNotebook>;
}

/// Main logic to setup the application
export async function loadApp(config: AppConfig, logger: TracedLogger, core: dashql.DashQL, storage: StorageReader, resetConnections: Dispatch<SetConnectionRegistryAction>, allocateConnection: ConnectionAllocator, modifyConnection: DynamicConnectionDispatch, resetNotebookScripts: Dispatch<SetNotebookScriptsRegistryAction>, setupDemoNotebookScripts: NotebookScriptsSetupFn, consumer: AppLoadingProgressConsumer, abortSignal: AbortSignal) {
    const traced = logger.childSpan();
    traced.info("Loading application", {}, "app_loading");
    const appLoadStartTime = performance.now();

    let progress: AppLoadingProgress = {
        restoreConnections: new ProgressCounter(),
        restoreCatalogs: new ProgressCounter(),
        restoreNotebookScripts: new ProgressCounter(),
        analyzeScripts: new ProgressCounter(),
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
        notebooks: state.notebookScripts.size.toString(),
        durationMs: restoreDuration.toFixed(2)
    }, "app_loading");

    // Reset the connection registry
    traced.info("Updating connection registry", {
        connectionCount: state.connectionStates.size.toString()
    }, "app_loading");
    resetConnections({
        connectionMap: state.connectionStates,
        connectionByNotebook: state.connectionByNotebook,
        connectionsByType: state.connectionStatesByType,
        connectionsBySignature: state.connectionSignatures,
    });

    // Reset the notebook scripts registry
    traced.info("Updating notebook scripts registry", {
        notebookCount: state.notebookScripts.size.toString()
    }, "app_loading");
    resetNotebookScripts({
        notebookScriptsMap: state.notebookScripts,
        notebookScriptsByConnection: state.notebookScriptsByConnection,
        notebookScriptsByConnectionType: state.notebookScriptsByConnectionType,
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
        const existingDemoConnectionId = findDemoConnection(state.connectionStatesByType, state.connectionStates);

        if (!existingDemoConnectionId) {
            traced.info("Creating demo connection", {}, "app_loading");
            demoConn = allocateConnection(createDatalessConnectionState(core, state.connectionSignatures, { demoConnector: true }));
        } else {
            demoConn = state.connectionStates.get(existingDemoConnectionId)!;
            traced.info("Using existing demo connection", { connectionId: existingDemoConnectionId }, "app_loading");
        }

        // Create the default demo params
        traced.info("Creating demo database channel", {}, "app_loading");
        const demoChannel = new DemoDatabaseChannel();
        // Curry the dispatch
        const dispatch = (action: ConnectionStateAction) => modifyConnection(demoConn!.connectionId, action);
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

    let demoNotebookScripts: NotebookScripts;
    const existingDemoNotebookId = findDemoNotebook(state.notebookScriptsByConnectionType, state.connectionStates, state.connectionByNotebook, state.notebookScripts);
    if (!existingDemoNotebookId) {
        traced.info("Creating demo notebook", {}, "app_loading");
        demoNotebookScripts = await setupDemoNotebookScripts(demoConn, abortSignal);
        traced.info("Created demo notebook", {
            notebookId: demoNotebookScripts.notebookId
        }, "app_loading");
    } else {
        demoNotebookScripts = state.notebookScripts.get(existingDemoNotebookId)!;
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
        demo: demoNotebookScripts,
        invalidNotebooks: state.invalidNotebooks,
    };
}

/// Find an existing dataless connection with demoConnector enabled
function findDemoConnection(connectionStatesByType: string[][], connectionStates: Map<string, ConnectionState>): string | null {
    const datalessIds = connectionStatesByType[ConnectorType.DATALESS] ?? [];
    for (const connectionId of datalessIds) {
        const conn = connectionStates.get(connectionId);
        if (conn) {
            const details = conn.details.value as DatalessConnectionStateDetails;
            if (isDemoConnector(details)) {
                return connectionId;
            }
        }
    }
    return null;
}

/// Find an existing notebook connected to a demo connection
function findDemoNotebook(
    notebookScriptsByConnectionType: string[][],
    connectionStates: Map<string, ConnectionState>,
    connectionByNotebook: Map<string, string>,
    notebookScripts: Map<string, NotebookScripts>,
): string | null {
    // Look through dataless notebooks to find one connected to a demo-mode connection
    const datalessNotebookIds = notebookScriptsByConnectionType[ConnectorType.DATALESS] ?? [];
    for (const nbId of datalessNotebookIds) {
        const nb = notebookScripts.get(nbId);
        if (!nb) continue;
        // Check the associated connection for demoConnector
        const connectionId = connectionByNotebook.get(nb.notebookId);
        const conn = connectionId == null ? null : connectionStates.get(connectionId);
        if (conn && conn.details.type === DATALESS_CONNECTOR) {
            const details = conn.details.value as DatalessConnectionStateDetails;
            if (isDemoConnector(details)) {
                return nbId;
            }
        }
    }
    return null;
}
