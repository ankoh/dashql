import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';

import { CONNECTOR_TYPES, ConnectorType } from './connector_info.js';
import { ConnectionStateAction, createConnectionStateForType, createDatalessConnectionState } from './connection_state.js';
import { DemoDatabaseChannel } from './demo/demo_database_channel.js';
import { Dispatch } from '../utils/variant.js';
import { createDemoConnectionState } from './demo/demo_connection_state.js';
import { createHyperGrpcConnectionState } from './hyper/hyper_connection_state.js';
import { createSalesforceConnectionState } from './salesforce/salesforce_connection_state.js';
import { createTrinoConnectionState } from './trino/trino_connection_state.js';
import { setupDemoConnection } from './demo/demo_connection_setup.js';
import { useConnectionRegistry, useConnectionStateAllocator, useDynamicConnectionDispatch } from './connection_registry.js';
import { useDashQLCoreSetup } from '../core_provider.js';
import { useLogger } from '../platform/logger_provider.js';
import { useAppConfig } from '../app_config.js';

/// For now, we just set up connections.
/// Our abstractions would allow for a more dynamic workbook management, but we don't have the UI for that.
const DEFAULT_CONNECTIONS = React.createContext<[number[], Dispatch<React.SetStateAction<number[]>>] | null>(null);
export const useDefaultConnections = () => React.useContext(DEFAULT_CONNECTIONS)![0];

export function useDefaultConnectionSetup() {
    const [registry, _setReg] = useConnectionRegistry();
    const allocState = useConnectionStateAllocator();
    const [_, setDefaultConns] = React.useContext(DEFAULT_CONNECTIONS)!;
    return React.useCallback(async (dql: dashql.DashQL, type: ConnectorType) => {
        const newDefault = allocState(createConnectionStateForType(dql, type, registry.connectionsBySignature));
        setDefaultConns(c => {
            const copy = [...c];
            copy[type] = newDefault.connectionId;
            return copy;
        });
        return newDefault;
    }, [allocState, setDefaultConns]);
}

export const DefaultConnectionProvider: React.FC<{ children: React.ReactElement }> = (props: { children: React.ReactElement }) => {
    const logger = useLogger();
    const config = useAppConfig();
    const allocState = useConnectionStateAllocator();
    const setupCore = useDashQLCoreSetup();
    const allocateConnection = useConnectionStateAllocator();
    const [registry, dynamicDispatch] = useDynamicConnectionDispatch();

    const [defaultConns, setDefaultConns] = React.useState<number[]>([]);
    React.useEffect(() => {
        const abort = new AbortController();

        const allocateAsync = async () => {
            const core = await setupCore("conn_setup");
            abort.signal.throwIfAborted();

            // Allocate connection states
            const trinoConn = allocateConnection(createTrinoConnectionState(core, registry.connectionsBySignature));
            const hyperConn = allocateConnection(createHyperGrpcConnectionState(core, registry.connectionsBySignature));
            const datalessConn = allocateConnection(createDatalessConnectionState(core, registry.connectionsBySignature));
            const demoConn = allocateConnection(createDemoConnectionState(core, registry.connectionsBySignature));
            const sfConn = allocateConnection(createSalesforceConnectionState(core, registry.connectionsBySignature));

            // Set default connections
            const connections: number[] = new Array<number>(CONNECTOR_TYPES.length);
            connections[ConnectorType.DATALESS] = datalessConn.connectionId;
            connections[ConnectorType.DEMO] = demoConn.connectionId;
            connections[ConnectorType.SALESFORCE_DATA_CLOUD] = sfConn.connectionId;
            connections[ConnectorType.HYPER_GRPC] = hyperConn.connectionId;
            connections[ConnectorType.TRINO] = trinoConn.connectionId;
            setDefaultConns(connections);

            // Now run through the demo connection
            if (config?.settings?.setupDemoConnection === undefined || config?.settings?.setupDemoConnection) {
                // Create the default demo params
                const demoChannel = new DemoDatabaseChannel();
                // Curry the state dispatch
                const dispatch = (action: ConnectionStateAction) => dynamicDispatch(demoConn.connectionId, action);
                // Setup the demo connection
                await setupDemoConnection(dispatch, logger, demoChannel, abort.signal);
                // Create a fresh default connection.
                // This means we actually set up 2 demo connections to mimic the default connection behavior of normal connectors
                const newDefault = allocState(createConnectionStateForType(core, ConnectorType.DEMO, registry.connectionsBySignature));
                setDefaultConns(c => {
                    const copy = [...c];
                    copy[ConnectorType.DEMO] = newDefault.connectionId;
                    return copy;
                });
            }
        };
        allocateAsync();

        return () => abort.abort();
    }, []);

    return (
        <DEFAULT_CONNECTIONS.Provider value={[defaultConns, setDefaultConns]}>
            {props.children}
        </DEFAULT_CONNECTIONS.Provider>
    );
};
