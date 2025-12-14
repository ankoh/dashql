import * as React from 'react';

import { ConnectorType } from '../connection/connector_info.js';
import { useAwaitStateChange } from '../utils/state_change.js';
import { useConnectionRegistry } from '../connection/connection_registry.js';
import { useDemoWorkbookSetup } from '../connection/demo/demo_workbook.js';
import { useDatalessWorkbookSetup } from '../connection/dataless/dataless_workbook.js';
import { useWorkbookRegistry, WorkbookRegistry } from './workbook_state_registry.js';
import { isDebugBuild } from '../globals.js';

export async function waitForDefaultWorkbookSetup(): Promise<WorkbookRegistry> {
    const [reg, _setReg] = useWorkbookRegistry();
    const awaitReg = useAwaitStateChange(reg);
    return await awaitReg(reg, reg => (!isDebugBuild() || reg.workbooksByConnectionType[ConnectorType.DEMO].length > 0) && reg.workbooksByConnectionType[ConnectorType.DATALESS].length > 0)
}

export const DefaultWorkbookSetup: React.FC<{ children: React.ReactElement }> = (props: { children: React.ReactElement }) => {
    const setupDatalessWorkbook = useDatalessWorkbookSetup();
    const setupDemoWorkbook = useDemoWorkbookSetup();

    const [connReg, _setConnReg] = useConnectionRegistry();
    const awaitConnReg = useAwaitStateChange(connReg);

    React.useEffect(() => {
        const abort = new AbortController();

        const asyncSetup = async () => {
            // Wait until dataless and demo connections are set up
            await Promise.all([
                awaitConnReg(connReg, (s) => s.connectionsByType[ConnectorType.DATALESS].size > 0),
                awaitConnReg(connReg, (s) => s.connectionsByType[ConnectorType.DEMO].size > 0),
            ]);
            abort.signal.throwIfAborted();

            // Setup the dataless workbook
            const datalessConnId = connReg
                .connectionsByType[ConnectorType.DATALESS]
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
