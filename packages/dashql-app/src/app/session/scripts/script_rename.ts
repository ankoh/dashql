import { RENAME_SCRIPT, type SessionScripts } from './session_scripts.js';
import type { ModifySessionScripts } from './session_scripts_registry.js';
import { scriptDisplayName } from './script_types.js';

/// Renames the references to a script in a draft, by display names
export type RenameDraftReferences = (from: string, to: string) => void;

/// Rename a script. The reducer rewrites the references in the other scripts, the draft follows once the name is
/// final, the reducer disambiguates it.
export async function renameScript(
    session: SessionScripts,
    modify: ModifySessionScripts,
    fileName: string,
    newFileName: string,
    renameDraft: RenameDraftReferences | null | undefined,
): Promise<void> {
    const scriptId = session.scriptRefs[fileName]?.scriptId;
    const next = await modify({ type: RENAME_SCRIPT, value: { fileName, newFileName } });
    const renamed = scriptId != null ? next?.scripts[scriptId]?.fileName : undefined;
    if (renamed != null && renamed !== fileName) {
        renameDraft?.(scriptDisplayName(fileName), scriptDisplayName(renamed));
    }
}
