import * as React from 'react';

import { ConnectorType } from '../connection/connector_info.js';
import { useAwaitStateChange } from '../utils/state_change.js';
import { useConnectionRegistry } from '../connection/connection_registry.js';
import { useDemoWorkbookSetup } from '../connection/demo/demo_workbook.js';
import { useDatalessWorkbookSetup } from '../connection/dataless/dataless_workbook.js';

export const DefaultWorkbookProvider: React.FC<{ children: React.ReactElement }> = (props: { children: React.ReactElement }) => {
    const setupDatalessWorkbook = useDatalessWorkbookSetup();
    const setupDemoWorkbook = useDemoWorkbookSetup();

    const [connReg, _setConnReg] = useConnectionRegistry();
    const awaitConnReg = useAwaitStateChange(connReg);

    React.useEffect(() => {
        const abort = new AbortController();

        const asyncSetup = async () => {
            // Wait until dataless and demo connections are set up
            await Promise.all([
                awaitConnReg((s) => s.connectionsByType[ConnectorType.SERVERLESS].size > 0),
                awaitConnReg((s) => s.connectionsByType[ConnectorType.DEMO].size > 0),
            ]);
            abort.signal.throwIfAborted();

            // Setup the dataless workbook
            const datalessConnId = connReg
                .connectionsByType[ConnectorType.SERVERLESS]
                .values()
                .next()
                .value!;
            const datalessConn = connReg.connectionMap.get(datalessConnId)!;
            setupDatalessWorkbook(datalessConn, abort.signal);

            // Setup the demo workbook
            const demoConnId = connReg
                .connectionsByType[ConnectorType.DEMO]
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
