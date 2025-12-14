import * as React from 'react';

import { ConnectorType } from './connector_info.js';
import { ConnectionStateAction, createDatalessConnectionState } from './connection_state.js';
import { DemoDatabaseChannel } from './demo/demo_database_channel.js';
import { createDemoConnectionState } from './demo/demo_connection_state.js';
import { createHyperGrpcConnectionState } from './hyper/hyper_connection_state.js';
import { createSalesforceConnectionState } from './salesforce/salesforce_connection_state.js';
import { createTrinoConnectionState } from './trino/trino_connection_state.js';
import { setupDemoConnection } from './demo/demo_connection_setup.js';
import { ConnectionRegistry, useConnectionRegistry, useConnectionStateAllocator, useDynamicConnectionDispatch } from './connection_registry.js';
import { useDashQLCoreSetup } from '../core_provider.js';
import { useLogger } from '../platform/logger_provider.js';
import { useAppConfig } from '../app_config.js';
import { useAwaitStateChange } from '../utils/state_change.js';

export async function waitForDefaultConnectionSetup(): Promise<ConnectionRegistry> {
    const [reg, _setReg] = useConnectionRegistry();
    const awaitReg = useAwaitStateChange(reg);
    return await awaitReg(reg, reg => reg.connectionsByType[ConnectorType.DEMO].size > 0 && reg.connectionsByType[ConnectorType.DATALESS].size > 0)
}

export const DefaultConnectionSetup: React.FC<{ children: React.ReactElement }> = (props: { children: React.ReactElement }) => {
    const logger = useLogger();
    const config = useAppConfig();
    const setupCore = useDashQLCoreSetup();
    const allocateConnection = useConnectionStateAllocator();
    const [registry, dynamicDispatch] = useDynamicConnectionDispatch();

    React.useEffect(() => {
        const abort = new AbortController();

        const allocateAsync = async () => {
            // Wait for core to be ready
            const core = await setupCore("conn_setup");
            abort.signal.throwIfAborted();

            // Allocate stub connection states
            allocateConnection(createTrinoConnectionState(core, registry.connectionsBySignature));
            allocateConnection(createHyperGrpcConnectionState(core, registry.connectionsBySignature));
            allocateConnection(createDatalessConnectionState(core, registry.connectionsBySignature));
            allocateConnection(createSalesforceConnectionState(core, registry.connectionsBySignature));

            // For the demo connection, run through a proper setup
            const demoConn = allocateConnection(createDemoConnectionState(core, registry.connectionsBySignature));

            // Now run through the demo connection
            if (config?.settings?.setupDemoConnection === undefined || config?.settings?.setupDemoConnection) {
                // Create the default demo params
                const demoChannel = new DemoDatabaseChannel();
                // Curry the state dispatch
                const dispatch = (action: ConnectionStateAction) => dynamicDispatch(demoConn.connectionId, action);
                // Setup the demo connection
                await setupDemoConnection(dispatch, logger, demoChannel, abort.signal);
            }
        };
        allocateAsync();

        return () => abort.abort();
    }, []);

    return props.children;
};
