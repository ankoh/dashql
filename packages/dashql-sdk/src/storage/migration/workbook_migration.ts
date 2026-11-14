import type { MigrationFolder } from './migration_folder.js';
import { WORKBOOK_FORMAT_VERSION } from './versions.js';
import { catalogFilePrefix } from './workbook/v3_catalog_file_prefix.js';
import { notebooksToSessions } from './workbook/v4_notebooks_to_sessions.js';
import { scriptsInSessionFile } from './workbook/v5_scripts_in_session_file.js';
import { sessionConnections } from './workbook/v6_session_connections.js';
import { catalogsOfConnections } from './workbook/v7_catalogs_of_connections.js';
import { connectionsOfScripts } from './workbook/v8_connections_of_scripts.js';
import { dropSessionSettings } from './workbook/v9_drop_session_settings.js';
import { dbcomConnector } from './workbook/v10_dbcom_connector.js';
import { sessionsToWorkbooks } from './workbook/v11_sessions_to_workbooks.js';

/// A step that brings a session folder from the previous format version to `version`.
///
/// A step only touches the top-level files of the folder and spells out every file name and field
/// it touches, it never uses the storage constants of the app. Those describe the current layout
/// while a step describes the layout of its own version. Steps are idempotent: the version is
/// written after a step, an interrupted migration repeats the step.
export interface WorkbookMigrationStep {
    /// The format version the step produces
    version: number;
    /// What the step changes
    description: string;
    /// Migrate the folder
    migrate(folder: MigrationFolder): Promise<void>;
}

/// The steps in order. Steps are never removed, a session may skip any number of app versions.
export const WORKBOOK_MIGRATION_STEPS: readonly WorkbookMigrationStep[] = [
    catalogFilePrefix,
    notebooksToSessions,
    scriptsInSessionFile,
    sessionConnections,
    catalogsOfConnections,
    connectionsOfScripts,
    dropSessionSettings,
    dbcomConnector,
    sessionsToWorkbooks,
];

/// The oldest format version the steps migrate, older sessions are not supported
const OLDEST_WORKBOOK_FORMAT_VERSION = 2;

/// Every name the session metadata had, newest first
const WORKBOOK_METADATA_FILES = ['dashql-workbook.json', 'dashql-session.json', 'dashql-notebook.json'];

/// The outcome of a session migration
export enum WorkbookMigrationResult {
    /// The session was at the target version already
    Current = 'current',
    /// Steps were applied
    Migrated = 'migrated',
    /// The folder has no session metadata
    Missing = 'missing',
    /// The metadata is unreadable or older than the oldest supported version, the folder stays untouched
    Unsupported = 'unsupported',
    /// The session was written by a newer version of the app, the folder stays untouched
    Newer = 'newer',
}

/// The session metadata of a folder
interface WorkbookMetadataFile {
    /// The file name
    name: string;
    /// The parsed metadata, null if it is not a JSON object
    data: Record<string, unknown> | null;
}

/// Read the session metadata under its newest name
async function readWorkbookMetadata(folder: MigrationFolder): Promise<WorkbookMetadataFile | null> {
    for (const name of WORKBOOK_METADATA_FILES) {
        const text = await folder.readText(name);
        if (text == null) {
            continue;
        }
        try {
            const data: unknown = JSON.parse(text);
            const isObject = data != null && typeof data === 'object' && !Array.isArray(data);
            return { name, data: isObject ? data as Record<string, unknown> : null };
        } catch {
            return { name, data: null };
        }
    }
    return null;
}

/// Bring a session folder to a format version, by default the current one
export async function migrateWorkbookFolder(
    folder: MigrationFolder,
    targetVersion: number = WORKBOOK_FORMAT_VERSION,
    steps: readonly WorkbookMigrationStep[] = WORKBOOK_MIGRATION_STEPS,
): Promise<WorkbookMigrationResult> {
    const metadata = await readWorkbookMetadata(folder);
    if (metadata == null) {
        return WorkbookMigrationResult.Missing;
    }
    const version = metadata.data?.formatVersion;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < OLDEST_WORKBOOK_FORMAT_VERSION) {
        return WorkbookMigrationResult.Unsupported;
    }
    const latestVersion = steps.reduce((latest, step) => Math.max(latest, step.version), OLDEST_WORKBOOK_FORMAT_VERSION);
    if (version > latestVersion) {
        return WorkbookMigrationResult.Newer;
    }

    let current = version;
    for (const step of steps) {
        if (step.version <= current || step.version > targetVersion) {
            continue;
        }
        await step.migrate(folder);
        const migrated = await readWorkbookMetadata(folder);
        if (migrated?.data == null) {
            throw new Error(`Workbook migration to format version ${step.version} lost the workbook metadata`);
        }
        await folder.writeText(migrated.name, JSON.stringify({ ...migrated.data, formatVersion: step.version }, null, 2));
        current = step.version;
    }
    return current === version ? WorkbookMigrationResult.Current : WorkbookMigrationResult.Migrated;
}
