import { beforeAll, describe, expect, it } from 'vitest';
import * as core from '@ankoh/dashql-core';

import { browserWorkbookFolder } from './browser_workbook_folder.js';
import { TEST_CONNECTION_ID, testWorkbook, WorkbookTestBackend } from '@ankoh/dashql-platform/testing/workbook_test_backend';
import { testStorageRuntime } from '@ankoh/dashql-runtime/testing/test_runtime';
import type { WorkbookData } from '@ankoh/dashql-platform/storage/storage_backend';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

function file(path: string, text: string): File {
    const value = new File([text], path.split('/').pop()!);
    Object.defineProperty(value, 'webkitRelativePath', { value: path });
    return value;
}

/// Import a selected folder into the storage of a runtime of the test, the workbook and the files that were written
async function load(files: File[]) {
    const storage = new WorkbookTestBackend();
    const runtime = testStorageRuntime(dql, storage);
    const preview = await runtime.readImport({ folder: browserWorkbookFolder(files) });
    const { workbookId } = await runtime.commitImport(preview.importId, { restore: false });
    return {
        workbook: preview.workbook as WorkbookData,
        scripts: storage.scripts.get(workbookId) ?? new Map<string, string>(),
        data: storage.data.get(workbookId) ?? new Map<string, Uint8Array>(),
    };
}

describe('V2 browser folder import', () => {
    it('preserves binary data without text decoding', async () => {
        const bytes = new Uint8Array([0, 255, 128]);
        const payload = new File([bytes], 'payload.parquet');
        Object.defineProperty(payload, 'webkitRelativePath', { value: 'selected/attachments/payload.parquet' });
        const { data } = await load([file('selected/dashql-workbook.json', JSON.stringify(testWorkbook())), payload]);
        expect([...data.keys()]).toEqual(['payload.parquet']);
        expect(new Uint8Array(data.get('payload.parquet')!)).toEqual(bytes);
    });

    it('strips one root and appends unlisted scripts in natural order', async () => {
        const { workbook, scripts } = await load([
            file('selected/dashql-workbook.json', JSON.stringify(testWorkbook())),
            file('selected/scripts/10_last.sql', 'SELECT 10'),
            file('selected/scripts/2_first.sql', 'SELECT 2'),
        ]);
        expect(workbook.scripts).toEqual([
            { name: '2_first.sql', connectionId: TEST_CONNECTION_ID },
            { name: '10_last.sql', connectionId: TEST_CONNECTION_ID },
        ]);
        expect(Object.fromEntries(scripts)).toEqual({ '2_first.sql': 'SELECT 2', '10_last.sql': 'SELECT 10' });
    });

    it.each([
        ['selected/scripts/page/query.sql', 'directly inside scripts/'],
        ['selected/scripts/dashql-draft.sql', 'directly inside scripts/'],
        ['selected/attachments/nested/payload.parquet', 'directly inside attachments/'],
        ['selected/attachments/../payload.parquet', 'directly inside attachments/'],
    ])('rejects obsolete V1 layout %s', (path, message) => {
        expect(() => browserWorkbookFolder([
            file('selected/dashql-workbook.json', JSON.stringify(testWorkbook())),
            file(path, 'SELECT 1'),
        ])).toThrow(message);
    });

    it('rejects V1 metadata', async () => {
        await expect(load([
            file('selected/dashql-workbook.json', JSON.stringify({ ...testWorkbook(), formatVersion: 1 })),
        ])).rejects.toThrow('Unsupported workbook format version');
    });

    it('reads the notebook metadata of older versions', async () => {
        const legacy = { ...testWorkbook(), formatVersion: 2, workbookId: undefined, notebookId: testWorkbook().workbookId };
        const { workbook } = await load([file('selected/dashql-notebook.json', JSON.stringify(legacy))]);
        expect(workbook).toEqual(testWorkbook());
    });
});
