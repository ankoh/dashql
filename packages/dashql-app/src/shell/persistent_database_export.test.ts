// @vitest-environment node
import {
    deletePersistentDatabaseFile,
    listPersistentDatabaseFiles,
    persistentDatabaseFileName,
    readPersistentDatabaseFile,
} from './persistent_database_export.js';

describe('persistent database export', () => {
    it('maps logical database names to HyperDB OPFS filenames', () => {
        expect(persistentDatabaseFileName('demo')).toBe('demo.hyper');
        expect(persistentDatabaseFileName('a_b-c')).toBe('a_b-c.hyper');
    });

    it('reads the database snapshot without creating storage entries', async () => {
        const bytes = new Uint8Array([3, 1, 4]);
        const getFileHandle = vi.fn().mockResolvedValue({
            getFile: async () => ({ arrayBuffer: async () => bytes.buffer }),
        });
        const getDirectoryHandle = vi.fn().mockResolvedValue({ getFileHandle });
        const root = { getDirectoryHandle } as unknown as FileSystemDirectoryHandle;

        await expect(readPersistentDatabaseFile('demo', async () => root)).resolves.toEqual(bytes);
        expect(getDirectoryHandle).toHaveBeenCalledWith('hyperdb', { create: false });
        expect(getFileHandle).toHaveBeenCalledWith('demo.hyper', { create: false });
    });

    it('lists and deletes physical HyperDB files', async () => {
        const removeEntry = vi.fn().mockResolvedValue(undefined);
        const directory = {
            removeEntry,
            async *entries() {
                yield ['test1.hyper', { kind: 'file' }];
                yield ['ignore.txt', { kind: 'file' }];
                yield ['nested.hyper', { kind: 'directory' }];
            },
        };
        const root = {
            getDirectoryHandle: vi.fn().mockResolvedValue(directory),
        } as unknown as FileSystemDirectoryHandle;

        await expect(listPersistentDatabaseFiles(async () => root)).resolves.toEqual(['test1']);
        await expect(deletePersistentDatabaseFile('test1', async () => root)).resolves.toBe(true);
        expect(removeEntry).toHaveBeenCalledWith('test1.hyper');
    });
});
