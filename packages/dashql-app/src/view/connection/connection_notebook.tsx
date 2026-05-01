import { useNotebookRegistry } from '../../notebook/notebook_state_registry.js';
import { ConnectionState } from '../../connection/connection_state.js';
import { NotebookState } from '../../notebook/notebook_state.js';

export type SelectConnectionNotebook = (conn: ConnectionState) => void;

export function useAnyConnectionNotebook(sessionId: string | null): NotebookState | null {
    if (sessionId == null) {
        return null;
    }

    const [notebookRegistry, _modifyNotebookRegistry] = useNotebookRegistry();
    // 1:1 mapping: sessionId -> sessionId
    const notebookSessionId = notebookRegistry.notebooksByConnection.get(sessionId);
    if (notebookSessionId) {
        return notebookRegistry.notebookMap.get(notebookSessionId)!;
    } else {
        return null
    }
}
