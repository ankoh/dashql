import { describe, expect, it } from 'vitest';

import { MemoryFolder } from './migration_folder.js';
import { migrateWorkbookFolder, WorkbookMigrationResult } from './workbook_migration.js';
import { WORKBOOK_FORMAT_VERSION } from './versions.js';
import { loadWorkbookFormat } from '../workbook_format.js';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';

// The steps are tested in the core (`workbook_format::migration`), these tests apply them to a folder
describe('workbook migration', () => {
    it('declares the format version of the core', async () => {
        const constants = (await loadWorkbookFormat()).constants();
        expect(constants.formatVersion).toBe(WORKBOOK_FORMAT_VERSION);
    });

    it('brings a notebook folder to the current format, the writes first and then the removals', async () => {
        const folder = new MemoryFolder([
            ['dashql-notebook.json', JSON.stringify({ formatVersion: 2, notebookId: SESSION_ID, notebookPath: 'opfs://notebooks/x', name: 'n' })],
            ['dashql-notebook-index.json', '{"scripts":[]}'],
            ['dashql-relations.sql', 'relations'],
        ]);
        expect(await migrateWorkbookFolder(folder)).toBe(WorkbookMigrationResult.Migrated);
        expect([...folder.files.keys()]).toEqual(['dashql-workbook.json']);
        expect(JSON.parse(folder.files.get('dashql-workbook.json')!)).toEqual({
            formatVersion: WORKBOOK_FORMAT_VERSION, workbookId: SESSION_ID, workbookPath: 'opfs://notebooks/x', name: 'n',
            scripts: [], attachments: [], connections: [],
        });
        const before = new Map(folder.files);
        expect(await migrateWorkbookFolder(folder)).toBe(WorkbookMigrationResult.Current);
        expect(folder.files).toEqual(before);
    });

    it('stops at a target version and leaves unusable folders untouched', async () => {
        const folder = new MemoryFolder([
            ['dashql-notebook.json', JSON.stringify({ formatVersion: 2, notebookId: SESSION_ID })],
            ['dashql-relations.sql', 'relations'],
        ]);
        expect(await migrateWorkbookFolder(folder, 3)).toBe(WorkbookMigrationResult.Migrated);
        expect(JSON.parse(folder.files.get('dashql-notebook.json')!).formatVersion).toBe(3);
        expect(folder.files.has('dashql-catalog-relations.sql')).toBe(true);

        const newer = new MemoryFolder([['dashql-session.json', `{"formatVersion":${WORKBOOK_FORMAT_VERSION + 1}}`]]);
        expect(await migrateWorkbookFolder(newer)).toBe(WorkbookMigrationResult.Newer);
        expect(await migrateWorkbookFolder(new MemoryFolder())).toBe(WorkbookMigrationResult.Missing);
    });
});
