// @vitest-environment node
import { OPFSPersistentDatabaseRegistry } from './persistent_database_registry.js';

function notFound(): Error {
    return Object.assign(new Error('not found'), { name: 'NotFoundError' });
}

class MockFileHandle {
    text = '';

    async getFile() {
        return { text: async () => this.text } as File;
    }

    async createWritable() {
        return {
            write: async (value: string) => { this.text = value; },
            close: async () => {},
        } as unknown as FileSystemWritableFileStream;
    }
}

class MockDirectoryHandle {
    readonly directories = new Map<string, MockDirectoryHandle>();
    readonly files = new Map<string, MockFileHandle>();

    async getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions) {
        let directory = this.directories.get(name);
        if (!directory && options?.create) {
            directory = new MockDirectoryHandle();
            this.directories.set(name, directory);
        }
        if (!directory) throw notFound();
        return directory as unknown as FileSystemDirectoryHandle;
    }

    async getFileHandle(name: string, options?: FileSystemGetFileOptions) {
        let file = this.files.get(name);
        if (!file && options?.create) {
            file = new MockFileHandle();
            this.files.set(name, file);
        }
        if (!file) throw notFound();
        return file as unknown as FileSystemFileHandle;
    }

    async *entries() {
        for (const [name, file] of this.files) yield [name, { ...file, kind: 'file' }];
        for (const [name, directory] of this.directories) yield [name, { ...directory, kind: 'directory' }];
    }
}

describe('OPFSPersistentDatabaseRegistry', () => {
    beforeEach(() => vi.stubGlobal('navigator', {}));
    afterEach(() => vi.unstubAllGlobals());

    it('persists sorted unique database names across instances', async () => {
        const root = new MockDirectoryHandle();
        const create = () => new OPFSPersistentDatabaseRegistry(
            async () => root as unknown as FileSystemDirectoryHandle,
        );

        await create().add('zeta');
        await create().add('alpha');
        await create().add('zeta');

        await expect(create().list()).resolves.toEqual(['alpha', 'zeta']);
        await create().delete('alpha');
        await expect(create().list()).resolves.toEqual(['zeta']);
    });

    it('loads an empty registry when it has not been created', async () => {
        const root = new MockDirectoryHandle();
        const registry = new OPFSPersistentDatabaseRegistry(
            async () => root as unknown as FileSystemDirectoryHandle,
        );

        await expect(registry.list()).resolves.toEqual([]);
    });

    it('discovers legacy persistent databases directly from OPFS', async () => {
        const root = new MockDirectoryHandle();
        const hyperdb = await root.getDirectoryHandle('hyperdb', { create: true }) as unknown as MockDirectoryHandle;
        await hyperdb.getFileHandle('test1.hyper', { create: true });
        const registry = new OPFSPersistentDatabaseRegistry(
            async () => root as unknown as FileSystemDirectoryHandle,
        );

        await expect(registry.list()).resolves.toEqual(['test1']);
    });

    it('rejects malformed registry data', async () => {
        const root = new MockDirectoryHandle();
        const directory = await root.getDirectoryHandle('dashql-shell', { create: true }) as unknown as MockDirectoryHandle;
        const file = await directory.getFileHandle('persistent-databases.json', { create: true }) as unknown as MockFileHandle;
        file.text = '{"version":1,"databases":[1]}';
        const registry = new OPFSPersistentDatabaseRegistry(
            async () => root as unknown as FileSystemDirectoryHandle,
        );

        await expect(registry.list()).rejects.toThrow('Invalid persistent database registry format');
    });
});
