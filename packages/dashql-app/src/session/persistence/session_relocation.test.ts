import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestLogger } from '../../platform/logger/test_logger.js';
import type { CompositeStorageBackend } from '../../storage/composite_storage_backend.js';
import type { StorageWriter } from '../../storage/storage_writer.js';
import { addNativeSessionFromFolder, relocateSessionToNative } from './session_relocation.js';

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

describe('relocateSessionToNative', () => {
    it('does nothing when the folder picker is cancelled', async () => {
        pickFolder(null);
        const writer = fakeWriter();
        const backend = { relocateSessionToNative: vi.fn() } as unknown as CompositeStorageBackend;
        expect(await relocateSessionToNative('s1', backend, writer as unknown as StorageWriter, new TestLogger())).toBe(false);
        expect(writer.pause).not.toHaveBeenCalled();
        expect(backend.relocateSessionToNative).not.toHaveBeenCalled();
    });

    it('resumes the writer when the relocation fails', async () => {
        pickFolder('/Users/me/session');
        const writer = fakeWriter();
        const backend = { relocateSessionToNative: vi.fn(async () => { throw new Error('copy failed'); }) } as unknown as CompositeStorageBackend;
        await expect(relocateSessionToNative('s1', backend, writer as unknown as StorageWriter, new TestLogger())).rejects.toThrow('copy failed');
        expect(writer.pause).toHaveBeenCalledOnce();
        expect(writer.flush).toHaveBeenCalledOnce();
        expect(backend.relocateSessionToNative).toHaveBeenCalledWith('s1', '/Users/me/session');
        expect(writer.resume).toHaveBeenCalledOnce();
    });
});

describe('addNativeSessionFromFolder', () => {
    it('does nothing when the folder picker is cancelled', async () => {
        pickFolder(null);
        const backend = { loadNativeSession: vi.fn() } as unknown as CompositeStorageBackend;
        expect(await addNativeSessionFromFolder(backend, new TestLogger())).toBe(false);
        expect(backend.loadNativeSession).not.toHaveBeenCalled();
    });

    it('forwards folders without a session', async () => {
        pickFolder('/Users/me/empty');
        const backend = { loadNativeSession: vi.fn(async () => { throw new Error('no session'); }) } as unknown as CompositeStorageBackend;
        await expect(addNativeSessionFromFolder(backend, new TestLogger())).rejects.toThrow('no session');
    });
});
