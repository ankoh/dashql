import { useNotebookRegistry } from '../../notebook/notebook_state_registry.js';
import { ConnectionState } from '../../connection/connection_state.js';
import { NotebookState } from '../../notebook/notebook_state.js';

export type SelectConnectionNotebook = (conn: ConnectionState) => void;

export function useAnyConnectionNotebook(connectionId: number | null): NotebookState | null {
    if (connectionId == null) {
        return null;
    }
    const [notebookRegistry, _modifyNotebookRegistry] = useNotebookRegistry();
    const notebooks: undefined | (number[]) = notebookRegistry.notebooksByConnection.get(connectionId);
    if (notebooks !== undefined && notebooks.length > 0) {
        return notebookRegistry.notebookMap.get(notebooks[0])!;
    } else {
        return null
    }
}
