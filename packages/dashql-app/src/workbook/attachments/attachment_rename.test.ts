import { describe, expect, it, vi } from 'vitest';

import type { WorkbookScripts } from '@ankoh/dashql/platform/workbook/workbook_scripts';
import { renameAttachment } from './attachment_rename.js';

function workbook(fileName: string, name: string): Pick<WorkbookScripts, 'workbookId' | 'attachments'> {
    return { workbookId: 'workbook', attachments: [{ fileName, name, sizeBytes: 1, mtimeMs: 1, columns: null }] };
}

/// A runtime that renames an attachment to a name, null for a name that it leaves alone
function runtime(renamed: string | null) {
    const after = renamed == null ? workbook('sales.parquet', 'sales') : workbook(renamed, renamed.replace(/\.parquet$/, ''));
    return {
        renameAttachment: vi.fn(async (_workbookId: string, _fileName: string, _name: string) => renamed),
        store: { get: vi.fn(() => after) },
    } as unknown as Parameters<typeof renameAttachment>[0] & { renameAttachment: ReturnType<typeof vi.fn> };
}

describe('attachment renames', () => {
    it('renames through the runtime, then the draft reads the new name', async () => {
        const rt = runtime('revenue-2.parquet');
        const draft = vi.fn();
        await expect(renameAttachment(rt, workbook('sales.parquet', 'sales'), 'sales.parquet', 'revenue', draft)).resolves.toBe('revenue-2.parquet');
        expect(rt.renameAttachment).toHaveBeenCalledExactlyOnceWith('workbook', 'sales.parquet', 'revenue');
        expect(draft).toHaveBeenCalledExactlyOnceWith('sales', 'revenue-2');
    });

    it('leaves the draft alone when the runtime renames nothing or the attachment is unknown', async () => {
        const rt = runtime(null);
        const draft = vi.fn();
        await expect(renameAttachment(rt, workbook('sales.parquet', 'sales'), 'sales.parquet', 'a/b', draft)).resolves.toBeNull();
        await expect(renameAttachment(rt, workbook('sales.parquet', 'sales'), 'other.parquet', 'x', draft)).resolves.toBeNull();
        expect(rt.renameAttachment).toHaveBeenCalledOnce();
        expect(draft).not.toHaveBeenCalled();
    });
});
