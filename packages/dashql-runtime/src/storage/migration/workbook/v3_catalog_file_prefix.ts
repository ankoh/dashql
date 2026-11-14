import { renameFileIfPresent } from '../migration_folder.js';
import type { WorkbookMigrationStep } from '../workbook_migration.js';

/// The catalog files share the dashql-catalog prefix.
/// The prefix shipped without a version of its own, folders of version 2 may have it already.
export const catalogFilePrefix: WorkbookMigrationStep = {
    version: 3,
    description: 'Prefix the catalog files with dashql-catalog',
    async migrate(folder) {
        await renameFileIfPresent(folder, 'dashql-relations.sql', 'dashql-catalog-relations.sql');
        await renameFileIfPresent(folder, 'dashql-functions.sql', 'dashql-catalog-functions.sql');
    },
};
