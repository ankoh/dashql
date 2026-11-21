/// The `.gitignore` of a workbook folder: it keeps the results of the scripts and other generated files out of version
/// control (docs/design/workbook_results.md). The entries are those of `GITIGNORE_ENTRIES` of `workbook_format/layout.rs`
/// of the core: the storage backends write the file with the workbook file and stay below the core.
export const GITIGNORE_FILE = '.gitignore';
/// The entries: the results of the scripts, the query result cache of earlier versions and Hyper databases
export const GITIGNORE_ENTRIES = ['results/', 'cache/', '*.hyper'];

/// The `.gitignore` with the entries of the app, null if it has them. Missing entries are appended, a `.gitignore` of
/// the user keeps its lines.
export function gitignoreWithEntries(existing: string | null): string | null {
    const text = existing ?? '';
    const lines = new Set(text.split(/\r?\n/).map(line => line.trim()));
    const missing = GITIGNORE_ENTRIES.filter(entry => !lines.has(entry));
    if (missing.length === 0) return null;
    const separator = text.length > 0 && !text.endsWith('\n') ? '\n' : '';
    return `${text}${separator}${missing.join('\n')}\n`;
}
