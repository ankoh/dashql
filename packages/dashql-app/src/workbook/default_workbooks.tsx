import * as React from 'react';

import { ConnectorType } from '../connection/connector_info.js';
import { useAwaitStateChange } from '../utils/state_change.js';
import { useConnectionRegistry } from '../connection/connection_registry.js';
import { useDemoWorkbookSetup } from '../connection/demo/demo_workbook.js';
import { useServerlessWorkbookSetup } from '../connection/serverless/serverless_workbook.js';

export const DefaultWorkbookProvider: React.FC<{ children: React.ReactElement }> = (props: { children: React.ReactElement }) => {
    const setupServerlessWorkbook = useServerlessWorkbookSetup();
    const setupDemoWorkbook = useDemoWorkbookSetup();

    const [connReg, _setConnReg] = useConnectionRegistry();
    const awaitConnReg = useAwaitStateChange(connReg);

    React.useEffect(() => {
        const abort = new AbortController();

        const asyncSetup = async () => {
            // Wait until serverless and demo connections are set up
            await Promise.all([
                awaitConnReg((s) => s.connectionsPerType[ConnectorType.SERVERLESS].size > 0),
                awaitConnReg((s) => s.connectionsPerType[ConnectorType.DEMO].size > 0),
            ]);
            abort.signal.throwIfAborted();

            // Setup the serverless workbook
            const serverlessConnId = connReg
                .connectionsPerType[ConnectorType.SERVERLESS]
                .values()
                .next()
                .value!;
            const serverlessConn = connReg.connectionMap.get(serverlessConnId)!;
            setupServerlessWorkbook(serverlessConn, abort.signal);

            // Setup the demo workbook
            const demoConnId = connReg
                .connectionsPerType[ConnectorType.DEMO]
                .values()
                .next()
                .value!;
            const demoConn = connReg.connectionMap.get(demoConnId)!;
            setupDemoWorkbook(demoConn, abort.signal);
        };
        asyncSetup();

        return () => abort.abort();
    }, []);

    return props.children;
}
