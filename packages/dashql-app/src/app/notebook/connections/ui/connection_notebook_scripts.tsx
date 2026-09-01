import { useNotebookScriptsRegistry } from '../../scripts/notebook_scripts_registry.js';
import { AttachedDatabaseState } from '../attached_database_state.js';
import { NotebookScripts } from '../../scripts/notebook_scripts.js';

export type SelectConnectionNotebook = (conn: AttachedDatabaseState) => void;

export function useAnyConnectionNotebookScripts(notebookId: string | null): NotebookScripts | null {
    if (notebookId == null) {
        return null;
    }

    const [notebookScriptsRegistry] = useNotebookScriptsRegistry();
    return notebookScriptsRegistry.notebookScriptsMap.get(notebookId) ?? null;
}
