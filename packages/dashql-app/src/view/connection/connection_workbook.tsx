import * as React from 'react';

import { useCurrentWorkbookSelector } from "../../workbook/current_workbook.js";
import { useConnectionRegistry } from '../../connection/connection_registry.js';
import { useWorkbookRegistry } from '../../workbook/workbook_state_registry.js';
import { ConnectionState } from '../../connection/connection_state.js';
import { useWorkbookSetup } from '../../workbook/workbook_setup.js';
import { WorkbookState } from '../../workbook/workbook_state.js';

export type SelectConnectionWorkbook = (conn: ConnectionState) => void;

export function useAnyConnectionWorkbook(connectionId: number | null): WorkbookState | null {
    if (connectionId == null) {
        return null;
    }
    const workbookRegistry = useWorkbookRegistry();
    const workbooks: undefined | (number[]) = workbookRegistry.workbooksByConnection.get(connectionId);
    if (workbooks !== undefined && workbooks.length > 0) {
        return workbookRegistry.workbookMap.get(workbooks[0])!;
    } else {
        return null
    }
}

export function useConnectionWorkbookSelector(): SelectConnectionWorkbook {
    const [connRegistry, _setConnRegistry] = useConnectionRegistry();
    const workbookRegistry = useWorkbookRegistry();
    const selectCurrentWorkbook = useCurrentWorkbookSelector();
    const setupWorkbook = useWorkbookSetup();

    return React.useCallback((conn: ConnectionState) => {
        const workbooks: undefined | (number[]) = workbookRegistry.workbooksByConnection.get(conn.connectionId);
        if (workbooks !== undefined && workbooks.length > 0) {
            selectCurrentWorkbook(workbooks[0]);
        } else {
            const workbook = setupWorkbook(conn);
            selectCurrentWorkbook(workbook.workbookId);
        }
    }, [connRegistry, workbookRegistry, selectCurrentWorkbook]);
}
