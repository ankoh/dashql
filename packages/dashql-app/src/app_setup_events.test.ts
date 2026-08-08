import { beforeEach, describe, expect, it, vi } from 'vitest';

import { importNotebookFromZip } from './platform/storage/notebook_import.js';
import { restoreSingleNotebook } from './platform/storage/app_state_loader.js';
import { importAndRestoreNotebook } from './app_setup_events.js';

vi.mock('./platform/storage/notebook_import.js', () => ({
    importNotebookFromZip: vi.fn(),
}));
vi.mock('./platform/storage/app_state_loader.js', () => ({
    restoreSingleNotebook: vi.fn(),
}));

const NOTEBOOK_ID = 'a0000000-0000-4000-8000-000000000001';

describe('importAndRestoreNotebook', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(importNotebookFromZip).mockResolvedValue(NOTEBOOK_ID);
    });

    it('deletes the persisted notebook when restoration fails', async () => {
        const restoreError = new Error('restore failed');
        vi.mocked(restoreSingleNotebook).mockRejectedValue(restoreError);
        const backend = { deleteNotebook: vi.fn() } as any;
        const signatures = new Map<string, string | null>();

        await expect(importAndRestoreNotebook(
            new Blob(),
            {} as any,
            {} as any,
            backend,
            signatures,
        )).rejects.toBe(restoreError);

        expect(restoreSingleNotebook).toHaveBeenCalledWith(
            expect.anything(),
            backend,
            expect.anything(),
            NOTEBOOK_ID,
            signatures,
        );
        expect(backend.deleteNotebook).toHaveBeenCalledWith(NOTEBOOK_ID);
    });

    it('preserves the restoration error when cleanup also fails', async () => {
        const restoreError = new Error('restore failed');
        vi.mocked(restoreSingleNotebook).mockRejectedValue(restoreError);
        const backend = {
            deleteNotebook: vi.fn().mockRejectedValue(new Error('cleanup failed')),
        } as any;

        await expect(importAndRestoreNotebook(
            new Blob(),
            {} as any,
            {} as any,
            backend,
            new Map(),
        )).rejects.toBe(restoreError);
    });
});
