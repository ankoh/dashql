import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestLogger } from '../../platform/logger/test_logger.js';
import type { CompositeStorageBackend } from '../../storage/composite_storage_backend.js';
import type { StorageWriter } from '@ankoh/dashql-sdk/storage/storage_writer';
import { addNativeWorkbookFromFolder, relocateWorkbookToNative } from './workbook_relocation.js';

// The successful paths reload the app, which would reload the test frame, so only the cancelled and failed paths are
// tested here.

/// Let the folder picker of the native app return the folder
function pickFolder(folder: string | null) {
    globalThis.dashqlElectron = { openDirectory: vi.fn(async () => folder) } as unknown as DashQLElectronBridge;
}

const fakeWriter = () => ({ pause: vi.fn(), resume: vi.fn(), flush: vi.fn(async () => { }) });

afterEach(() => {
    delete globalThis.dashqlElectron;
});

describe('relocateWorkbookToNative', () => {
    it('does nothing when the folder picker is cancelled', async () => {
        pickFolder(null);
        const writer = fakeWriter();
        const backend = { relocateWorkbookToNative: vi.fn() } as unknown as CompositeStorageBackend;
        expect(await relocateWorkbookToNative('s1', backend, writer as unknown as StorageWriter, new TestLogger())).toBe(false);
        expect(writer.pause).not.toHaveBeenCalled();
        expect(backend.relocateWorkbookToNative).not.toHaveBeenCalled();
    });

    it('resumes the writer when the relocation fails', async () => {
        pickFolder('/Users/me/workbook');
        const writer = fakeWriter();
        const backend = { relocateWorkbookToNative: vi.fn(async () => { throw new Error('copy failed'); }) } as unknown as CompositeStorageBackend;
        await expect(relocateWorkbookToNative('s1', backend, writer as unknown as StorageWriter, new TestLogger())).rejects.toThrow('copy failed');
        expect(writer.pause).toHaveBeenCalledOnce();
        expect(writer.flush).toHaveBeenCalledOnce();
        expect(backend.relocateWorkbookToNative).toHaveBeenCalledWith('s1', '/Users/me/workbook');
        expect(writer.resume).toHaveBeenCalledOnce();
    });
});

describe('addNativeWorkbookFromFolder', () => {
    it('does nothing when the folder picker is cancelled', async () => {
        pickFolder(null);
        const backend = { loadNativeWorkbook: vi.fn() } as unknown as CompositeStorageBackend;
        expect(await addNativeWorkbookFromFolder(backend, new TestLogger())).toBe(false);
        expect(backend.loadNativeWorkbook).not.toHaveBeenCalled();
    });

    it('forwards folders without a workbook', async () => {
        pickFolder('/Users/me/empty');
        const backend = { loadNativeWorkbook: vi.fn(async () => { throw new Error('no workbook'); }) } as unknown as CompositeStorageBackend;
        await expect(addNativeWorkbookFromFolder(backend, new TestLogger())).rejects.toThrow('no workbook');
    });
});
