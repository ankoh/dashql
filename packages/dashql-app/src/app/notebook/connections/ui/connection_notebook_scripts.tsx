import { useNotebookScriptsRegistry } from '../../scripts/notebook_scripts_registry.js';
import { ConnectionState } from '../connection_state.js';
import { NotebookScripts } from '../../scripts/notebook_scripts.js';

export type SelectConnectionNotebook = (conn: ConnectionState) => void;

export function useAnyConnectionNotebookScripts(notebookId: string | null): NotebookScripts | null {
    if (notebookId == null) {
        return null;
    }

    const [notebookScriptsRegistry] = useNotebookScriptsRegistry();
    return notebookScriptsRegistry.notebookScriptsMap.get(notebookId) ?? null;
}
