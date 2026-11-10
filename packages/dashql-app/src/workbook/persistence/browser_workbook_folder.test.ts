import { describe, expect, it } from 'vitest';

import { readWorkbookBundleFromBrowserFolder } from './browser_workbook_folder.js';
import { TEST_CONNECTION_ID, testWorkbook } from '../../storage/workbook_test_backend.js';

function file(path: string, text: string): File {
    const value = new File([text], path.split('/').pop()!);
    Object.defineProperty(value, 'webkitRelativePath', { value: path });
    return value;
}

describe('V2 browser folder import', () => {
    it('preserves binary data without text decoding', async () => {
        const bytes = new Uint8Array([0, 255, 128]);
        const payload = new File([bytes], 'payload.parquet');
        Object.defineProperty(payload, 'webkitRelativePath', { value: 'selected/attachments/payload.parquet' });
        const bundle = await readWorkbookBundleFromBrowserFolder([
            file('selected/dashql-workbook.json', JSON.stringify(testWorkbook())), payload,
        ]);
        expect(bundle.data).toEqual([{ name: 'payload.parquet', bytes }]);
    });
    it('strips one root and appends unlisted scripts in natural order', async () => {
        await expect(readWorkbookBundleFromBrowserFolder([
            file('selected/dashql-workbook.json', JSON.stringify(testWorkbook())),
            file('selected/scripts/10_last.sql', 'SELECT 10'),
            file('selected/scripts/2_first.sql', 'SELECT 2'),
        ])).resolves.toEqual({
            workbook: testWorkbook({ scripts: [
                { name: '2_first.sql', connectionId: TEST_CONNECTION_ID },
                { name: '10_last.sql', connectionId: TEST_CONNECTION_ID },
            ] }),
            catalogs: [],
            data: [],
            scripts: [
                { name: '2_first.sql', sql: 'SELECT 2' },
                { name: '10_last.sql', sql: 'SELECT 10' },
            ],
        });
    });

    it.each([
        ['selected/scripts/page/query.sql', 'directly inside scripts/'],
        ['selected/scripts/dashql-draft.sql', 'directly inside scripts/'],
        ['selected/attachments/nested/payload.parquet', 'directly inside attachments/'],
        ['selected/attachments/../payload.parquet', 'directly inside attachments/'],
    ])('rejects obsolete V1 layout %s', async (path, message) => {
        await expect(readWorkbookBundleFromBrowserFolder([
            file('selected/dashql-workbook.json', JSON.stringify(testWorkbook())),
            file(path, 'SELECT 1'),
        ])).rejects.toThrow(message);
    });

    it('rejects V1 metadata', async () => {
        await expect(readWorkbookBundleFromBrowserFolder([
            file('selected/dashql-workbook.json', JSON.stringify({ ...testWorkbook(), formatVersion: 1 })),
        ])).rejects.toThrow('Unsupported workbook format version');
    });

    it('reads the notebook metadata of older versions', async () => {
        const legacy = { ...testWorkbook(), formatVersion: 2, workbookId: undefined, notebookId: testWorkbook().workbookId };
        const bundle = await readWorkbookBundleFromBrowserFolder([
            file('selected/dashql-notebook.json', JSON.stringify(legacy)),
        ]);
        expect(bundle.workbook).toEqual(testWorkbook());
    });
});
