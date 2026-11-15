import type { MigrationFolder } from './migration_folder.js';
import { WORKBOOK_FORMAT_VERSION } from './versions.js';
import { loadWorkbookFormat } from '../workbook_format.js';

// The migrations of a workbook folder are steps of the workbook format of the core (`workbook_format::migration`),
// see docs/design/storage_layout.md. The host reads the top-level files of the folder, the core migrates them in
// memory, the host writes back what changed: the writes first, then the removals.

/// The outcome of a migration of a workbook folder
export enum WorkbookMigrationResult {
    /// The workbook was at the target version already
    Current = 'current',
    /// Steps were applied
    Migrated = 'migrated',
    /// The folder has no workbook metadata
    Missing = 'missing',
    /// The metadata is unreadable or older than the oldest supported version, the folder stays untouched
    Unsupported = 'unsupported',
    /// The workbook was written by a newer version of the app, the folder stays untouched
    Newer = 'newer',
}

/// The workbook file of the current format
const WORKBOOK_FILE = 'dashql-workbook.json';

/// The text of the workbook file of a folder at the current format version, null if the folder needs the migrations.
/// The migrations read nothing else of a current folder, so a folder at the current version needs no core: the app
/// checks every reachable folder at startup, before it instantiates the core.
export async function readCurrentWorkbookFile(folder: MigrationFolder): Promise<string | null> {
    const text = await folder.readText(WORKBOOK_FILE);
    if (text == null) return null;
    try {
        const data: unknown = JSON.parse(text);
        return (data as { formatVersion?: unknown } | null)?.formatVersion === WORKBOOK_FORMAT_VERSION ? text : null;
    } catch {
        return null;
    }
}

/// The top-level files of a folder that the migrations read
export async function readMigrationFiles(folder: MigrationFolder, names: readonly string[]): Promise<[string, string][]> {
    const files: [string, string][] = [];
    for (const name of names) {
        const text = await folder.readText(name);
        if (text != null) files.push([name, text]);
    }
    return files;
}

/// Bring a workbook folder to a format version, by default the current one
export async function migrateWorkbookFolder(folder: MigrationFolder, targetVersion: number = WORKBOOK_FORMAT_VERSION): Promise<WorkbookMigrationResult> {
    if (targetVersion === WORKBOOK_FORMAT_VERSION && await readCurrentWorkbookFile(folder) != null) {
        return WorkbookMigrationResult.Current;
    }
    const format = await loadWorkbookFormat();
    const { result, changes } = format.migrate(await readMigrationFiles(folder, format.constants().migrationFiles), targetVersion);
    for (const change of changes) {
        if (change.kind === 'write') {
            await folder.writeText(change.name, change.text);
        } else {
            await folder.remove(change.name);
        }
    }
    return result as WorkbookMigrationResult;
}
