import { useNotebookScriptsRegistry } from '../../scripts/notebook_scripts_registry.js';
import { ConnectionState } from '../../connection/connection_state.js';
import { NotebookScripts } from '../../scripts/notebook_scripts.js';

export type SelectConnectionNotebook = (conn: ConnectionState) => void;

export function useAnyConnectionNotebookScripts(notebookId: string | null): NotebookScripts | null {
    if (notebookId == null) {
        return null;
    }

    const [notebookScriptsRegistry] = useNotebookScriptsRegistry();
    // 1:1 mapping: notebookId -> notebookId
    const scriptsId = notebookScriptsRegistry.notebookScriptsByConnection.get(notebookId);
    if (scriptsId) {
        return notebookScriptsRegistry.notebookScriptsMap.get(scriptsId)!;
    } else {
        return null
    }
}
