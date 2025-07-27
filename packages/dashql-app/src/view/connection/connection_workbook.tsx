import { useWorkbookRegistry } from '../../workbook/workbook_state_registry.js';
import { ConnectionState } from '../../connection/connection_state.js';
import { WorkbookState } from '../../workbook/workbook_state.js';

export type SelectConnectionWorkbook = (conn: ConnectionState) => void;

export function useAnyConnectionWorkbook(connectionId: number | null): WorkbookState | null {
    if (connectionId == null) {
        return null;
    }
    const [workbookRegistry, _modifyWorkbookRegistry] = useWorkbookRegistry();
    const workbooks: undefined | (number[]) = workbookRegistry.workbooksByConnection.get(connectionId);
    if (workbooks !== undefined && workbooks.length > 0) {
        return workbookRegistry.workbookMap.get(workbooks[0])!;
    } else {
        return null
    }
}
