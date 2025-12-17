import * as dashql from '@ankoh/dashql-core';

import { Logger } from './platform/logger.js';
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
import { nextWorbookIdMustBeLargerThan, SetWorkbookRegistryAction } from './workbook/workbook_state_registry.js';
import { WorkbookSetupFn } from './connection/demo/demo_workbook.js';
import { ProgressCounter } from './utils/progress.js';
import { WorkbookState } from 'workbook/workbook_state.js';

export interface AppLoadingResult {
    /// The dataless workbook
    dataless: WorkbookState;
    /// The demo workbook
    demo: WorkbookState | null;
}

/// Main logic to setup the application
export async function loadApp(config: AppConfig, logger: Logger, core: dashql.DashQL, storage: StorageReader, resetConnections: Dispatch<SetConnectionRegistryAction>, allocateConnection: ConnectionAllocator, modifyConnection: DynamicConnectionDispatch, resetWorkbooks: Dispatch<SetWorkbookRegistryAction>, setupDatalessWorkbook: WorkbookSetupFn, setupDemoWorkbook: WorkbookSetupFn, consumer: AppLoadingProgressConsumer, abortSignal: AbortSignal) {

    let progress: AppLoadingProgress = {
        restoreConnections: new ProgressCounter(),
        restoreCatalogs: new ProgressCounter(),
        restoreWorkbooks: new ProgressCounter(),
        setupDefaultConnections: new ProgressCounter(1),
        setupDefaultWorkbooks: new ProgressCounter(1),
    };
    const partialProgressConsumer = (update: Partial<AppLoadingProgress>) => {
        progress = {
            ...progress,
            ...update
        };
        consumer(progress);
    };

    /// First restore the previous app state
    const state = await storage.restoreAppState(core, partialProgressConsumer);
    nextConnectionIdMustBeLargerThan(state.maxConnectionId);
    nextWorbookIdMustBeLargerThan(state.maxWorkbookId);

    // Reset the connection registry
    resetConnections({
        connectionMap: state.connectionStates,
        connectionsByType: state.connectionStatesByType,
        connectionsBySignature: state.connectionSignatures,
    });
    // Reset the workbook registry
    resetWorkbooks({
        workbookMap: state.workbooks,
        workbooksByConnection: state.workbooksByConnection,
        workbooksByConnectionType: state.workbooksByConnectionType,
    });

    progress = {
        ...progress,
        setupDefaultConnections: progress.setupDefaultConnections
            .clone()
            .addStarted()
    };
    consumer(progress);

    // Check if we need to fill in the dataless connection
    let datalessConn: ConnectionState;
    if (state.connectionStatesByType[ConnectorType.DATALESS].length == 0) {
        datalessConn = allocateConnection(createDatalessConnectionState(core, state.connectionSignatures));
    } else {
        const cid = state.connectionStatesByType[ConnectorType.DATALESS].values().next().value!;
        datalessConn = state.connectionStates.get(cid)!;
    }

    // Configure the demo connections
    let demoConn: ConnectionState | null = null;
    if (config.settings?.setupDemoConnection) {
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
    }

    progress = {
        ...progress,
        setupDefaultConnections: progress.setupDefaultConnections
            .clone()
            .addSucceeded(),
        setupDefaultWorkbooks: progress.setupDefaultWorkbooks
            .clone()
            .addStarted(),
    };
    consumer(progress);

    // Add a dataless workbook if none exist
    let datalessWorkbook: WorkbookState;
    if (state.workbooksByConnectionType[ConnectorType.DATALESS].length == 0) {
        datalessWorkbook = await setupDatalessWorkbook(datalessConn, abortSignal);
    } else {
        const wid = state.workbooksByConnectionType[ConnectorType.DATALESS].values().next().value!;
        datalessWorkbook = state.workbooks.get(wid)!;
    }

    // Add a demo workbook if none exist
    let demoWorkbook: WorkbookState;
    if (demoConn != null) {
        demoWorkbook = await setupDemoWorkbook(demoConn, abortSignal);
    } else {
        const wid = state.workbooksByConnectionType[ConnectorType.DEMO].values().next().value!;
        demoWorkbook = state.workbooks.get(wid)!;
    }

    progress = {
        ...progress,
        setupDefaultWorkbooks: progress.setupDefaultWorkbooks
            .clone()
            .addSucceeded()
    };
    consumer(progress);

    return {
        dataless: datalessWorkbook,
        demo: demoWorkbook,
    };
}


