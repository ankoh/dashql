import { describe, expect, it, vi } from 'vitest';

import { RENAME_ATTACHMENT, type WorkbookScripts } from '../scripts/workbook_scripts.js';
import { readWorkbookAttachments } from './workbook_attachments.js';
import { renameAttachment } from './attachment_rename.js';

function workbook(): WorkbookScripts {
    return {
        workbookId: 'workbook', scriptOrder: ['revenue.sql'], scripts: {}, scriptRefs: {},
        attachments: readWorkbookAttachments([{ name: 'sales.parquet', sizeBytes: 1, mtimeMs: 1 }]),
    } as unknown as WorkbookScripts;
}

describe('attachment renames', () => {
    it('moves the file before the scripts and the draft read the new name', async () => {
        const calls: string[] = [];
        const backend = { renameDataFile: vi.fn(async (_: string, from: string, to: string) => { calls.push(`move ${from} ${to}`); }) };
        const modify = vi.fn(async (action: { type: symbol }) => { calls.push(String(action.type.description)); return null; });
        const draft = vi.fn();
        // The name of a script is taken, the attachment takes the next free name
        await expect(renameAttachment(workbook(), modify, backend, 'sales.parquet', 'revenue', draft)).resolves.toBe('revenue-2.parquet');
        expect(calls).toEqual(['move sales.parquet revenue-2.parquet', 'RENAME_ATTACHMENT']);
        expect(modify).toHaveBeenCalledWith({ type: RENAME_ATTACHMENT, value: { fileName: 'sales.parquet', newFileName: 'revenue-2.parquet' } });
        expect(draft).toHaveBeenCalledExactlyOnceWith('sales', 'revenue-2');
    });

    it('leaves an attachment alone whose name stays or is no file name', async () => {
        const backend = { renameDataFile: vi.fn(async () => {}) };
        const modify = vi.fn(async () => null);
        await expect(renameAttachment(workbook(), modify, backend, 'sales.parquet', 'sales', null)).resolves.toBeNull();
        await expect(renameAttachment(workbook(), modify, backend, 'sales.parquet', 'a/b', null)).resolves.toBeNull();
        await expect(renameAttachment(workbook(), modify, backend, 'other.parquet', 'x', null)).resolves.toBeNull();
        expect(backend.renameDataFile).not.toHaveBeenCalled();
        expect(modify).not.toHaveBeenCalled();
    });
});
