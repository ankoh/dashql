import * as dashql from '@ankoh/dashql-core';

import { Logger } from './platform/logger.js';
import { StorageReader } from './storage/storage_reader.js';
import { AppLoadingProgressConsumer } from './app_loading_progress.js';
import { ConnectionAllocator, DynamicConnectionDispatch, nextConnectionIdMustBeLargerThan, SetConnectionRegistryAction } from './connection/connection_registry.js';
import { ConnectionStateAction, createDatalessConnectionState } from './connection/connection_state.js';
import { createDemoConnectionState } from 'connection/demo/demo_connection_state.js';
import { AppConfig } from './app_config.js';
import { DemoDatabaseChannel } from './connection/demo/demo_database_channel.js';
import { setupDemoConnection } from './connection/demo/demo_connection_setup.js';
import { ConnectorType } from './connection/connector_info.js';
import { Dispatch } from './utils/variant.js';
import { nextWorbookIdMustBeLargerThan } from 'workbook/workbook_state_registry.js';

/// Main logic to setup the application
export async function loadApp(config: AppConfig, logger: Logger, core: dashql.DashQL, storage: StorageReader, resetConnections: Dispatch<SetConnectionRegistryAction>, allocateConnection: ConnectionAllocator, modifyConnection: DynamicConnectionDispatch, consumer: AppLoadingProgressConsumer, abortSignal: AbortSignal) {

    /// First restore the previous app state
    const state = await storage.restoreAppState(core, consumer);
    nextConnectionIdMustBeLargerThan(state.maxConnectionId);
    nextWorbookIdMustBeLargerThan(state.maxWorkbookId);

    // Reset the connection registry
    resetConnections({
        connectionMap: state.connectionStates,
        connectionsByType: state.connectionStatesByType,
        connectionsBySignature: state.connectionSignatures,
    });

    // Check if we need to fill in the dataless connection
    if (state.connectionStatesByType[ConnectorType.DATALESS].size == 0) {
        // Allocate the dataless connection
        const conn = allocateConnection(createDatalessConnectionState(core, state.connectionSignatures));
        // Register the connection state
        state.connectionStates.set(conn.connectionId, conn);
        state.connectionStatesByType[ConnectorType.DATALESS].add(conn.connectionId);
    }

    // Create the demo connection if it's missing
    if (state.connectionStatesByType[ConnectorType.DEMO].size > 0) {
        allocateConnection(createDemoConnectionState(core, state.connectionSignatures));
    }
    // Configure the demo connections
    for (const cid of state.connectionStatesByType[ConnectorType.DEMO]) {
        // Create the default demo params
        const demoChannel = new DemoDatabaseChannel();
        // Curry the dispatch
        const dispatch = (action: ConnectionStateAction) => modifyConnection(cid, action);
        // Setup the demo connection
        await setupDemoConnection(dispatch, logger, demoChannel, abortSignal);
    }
}


