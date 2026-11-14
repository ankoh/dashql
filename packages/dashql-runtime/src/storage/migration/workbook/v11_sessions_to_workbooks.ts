import { renameFileIfPresent } from '../migration_folder.js';
import type { WorkbookMigrationStep } from '../workbook_migration.js';

/// The metadata fields that named the workbook a session
const RENAMED_FIELDS: Record<string, string> = {
    sessionId: 'workbookId',
    sessionPath: 'workbookPath',
};

/// Sessions are called workbooks, the metadata file and the identity of the metadata follow
export const sessionsToWorkbooks: WorkbookMigrationStep = {
    version: 11,
    description: 'Rename sessions as workbooks',
    async migrate(folder) {
        await renameFileIfPresent(folder, 'dashql-session.json', 'dashql-workbook.json');
        const text = await folder.readText('dashql-workbook.json');
        if (text == null) {
            return;
        }
        const data = JSON.parse(text) as Record<string, unknown>;
        if (!Object.keys(data).some(key => key in RENAMED_FIELDS)) {
            return;
        }
        const renamed = Object.fromEntries(Object.entries(data).map(([key, value]) => [RENAMED_FIELDS[key] ?? key, value]));
        await folder.writeText('dashql-workbook.json', JSON.stringify(renamed, null, 2));
    },
};
