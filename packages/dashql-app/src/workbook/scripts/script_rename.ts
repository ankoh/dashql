import { RENAME_SCRIPT, type WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import type { ModifyWorkbookScripts } from './workbook_scripts_registry.js';
import { scriptDisplayName } from '@ankoh/dashql-runtime/workbook/scripts/script_types';

/// Renames the references to a script in a draft, by display names
export type RenameDraftReferences = (from: string, to: string) => void;

/// Rename a script. The reducer rewrites the references in the other scripts, the draft follows once the name is
/// final, the reducer disambiguates it.
export async function renameScript(
    workbook: WorkbookScripts,
    modify: ModifyWorkbookScripts,
    fileName: string,
    newFileName: string,
    renameDraft: RenameDraftReferences | null | undefined,
): Promise<void> {
    const scriptId = workbook.scriptRefs[fileName]?.scriptId;
    const next = await modify({ type: RENAME_SCRIPT, value: { fileName, newFileName } });
    const renamed = scriptId != null ? next?.scripts[scriptId]?.fileName : undefined;
    if (renamed != null && renamed !== fileName) {
        renameDraft?.(scriptDisplayName(fileName), scriptDisplayName(renamed));
    }
}
