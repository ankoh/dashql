import type { ModifyWorkbookScripts, WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';

/// Renames the references to a script in a draft, by display names
export type RenameDraftReferences = (from: string, to: string) => void;

/// Rename a script. The workbook rewrites the references in the other scripts, the draft follows once the name is
/// final, the workbook disambiguates it. `fileNameOf` reads the file name of a script as the runtime holds it now.
export function renameScript(
    workbook: Pick<WorkbookScripts, 'scriptRefs'>,
    modify: ModifyWorkbookScripts,
    fileName: string,
    newFileName: string,
    renameDraft: RenameDraftReferences | null | undefined,
    fileNameOf: (scriptKey: number) => string | null,
): void {
    const scriptId = workbook.scriptRefs[fileName]?.scriptId;
    modify({ kind: 'renameScript', value: { fileName, newName: newFileName } });
    const renamed = scriptId != null ? fileNameOf(scriptId) : null;
    if (renamed != null && renamed !== fileName) {
        renameDraft?.(scriptDisplayName(fileName), scriptDisplayName(renamed));
    }
}
