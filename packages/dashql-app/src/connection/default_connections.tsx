import * as React from 'react';

import { createDemoConnectionState } from './demo/demo_connection_state.js';
import { createHyperGrpcConnectionState } from './hyper/hyper_connection_state.js';
import { createSalesforceConnectionState } from './salesforce/salesforce_connection_state.js';
import { createServerlessConnectionState } from './connection_state.js';
import { createTrinoConnectionState } from './trino/trino_connection_state.js';
import { useDashQLCoreSetup } from '../core_provider.js';
import { useConnectionStateAllocator } from './connection_registry.js';

/// For now, we just set up connections.
/// Our abstractions would allow for a more dynamic workbook management, but we don't have the UI for that.
interface DefaultConnections {
    salesforce: number;
    hyper: number;
    serverless: number;
    trino: number;
    demo: number;
}
const DEFAULT_CONNECTIONS = React.createContext<DefaultConnections | null>(null);
export const useDefaultConnections = () => React.useContext(DEFAULT_CONNECTIONS);

export const DefaultConnectionProvider: React.FC<{ children: React.ReactElement }> = (props: { children: React.ReactElement }) => {
    const setupCore = useDashQLCoreSetup();
    const allocateConnection = useConnectionStateAllocator();

    const [defaultConns, setDefaultConns] = React.useState<DefaultConnections | null>(null);
    React.useEffect(() => {
        const abort = new AbortController();

        const allocateAsync = async () => {
            const core = await setupCore("conn_setup");
            abort.signal.throwIfAborted();

            const trinoConn = allocateConnection(createTrinoConnectionState(core));
            const hyperConn = allocateConnection(createHyperGrpcConnectionState(core));
            const serverlessConn = allocateConnection(createServerlessConnectionState(core));
            const demoConn = allocateConnection(createDemoConnectionState(core));
            const sfConn = allocateConnection(createSalesforceConnectionState(core));

            const connections: DefaultConnections = {
                salesforce: sfConn.connectionId,
                hyper: hyperConn.connectionId,
                serverless: serverlessConn.connectionId,
                trino: trinoConn.connectionId,
                demo: demoConn.connectionId,
            };
            setDefaultConns(connections);
        };
        allocateAsync();

        return () => abort.abort();
    }, []);

    return (
        <DEFAULT_CONNECTIONS.Provider value={defaultConns}>
            {props.children}
        </DEFAULT_CONNECTIONS.Provider>
    );
};
