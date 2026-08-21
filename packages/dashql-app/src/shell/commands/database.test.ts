import type {
    EmbeddedConnection,
    EmbeddedPersistentDatabase,
    EmbeddedPersistentDatabaseConnection,
    PersistentDatabaseMetadata,
} from '../../platform/database/embedded_database.js';
import type { PersistentDatabaseRegistry } from '../persistent_database_registry.js';
import { createDatabaseCommand } from './database.js';

class FakeDatabase implements EmbeddedPersistentDatabase {
    readonly databases: PersistentDatabaseMetadata[] = [];
    readonly calls: string[] = [];
    openError: Error | null = null;
    createError: Error | null = null;

    async listDatabases(): Promise<readonly PersistentDatabaseMetadata[]> {
        this.calls.push('list');
        return this.databases;
    }

    async createPersistentDatabase(name: string): Promise<void> {
        this.calls.push(`create:${name}`);
        if (this.createError != null) throw this.createError;
        this.databases.push({ name, storage: 'persistent' });
    }

    async openPersistentDatabase(name: string): Promise<void> {
        this.calls.push(`open:${name}`);
        if (this.openError != null) throw this.openError;
    }

    async checkpointPersistentDatabase(name: string): Promise<void> {
        this.calls.push(`checkpoint:${name}`);
    }

    async dropPersistentDatabase(name: string): Promise<void> {
        this.calls.push(`drop:${name}`);
    }
}

class FakeRegistry implements PersistentDatabaseRegistry {
    readonly databases = new Set<string>();

    async list(): Promise<readonly string[]> {
        return [...this.databases].sort();
    }

    async add(name: string): Promise<void> {
        this.databases.add(name);
    }

    async delete(name: string): Promise<void> {
        this.databases.delete(name);
    }
}

class FakeConnection implements EmbeddedConnection, EmbeddedPersistentDatabaseConnection {
    readonly calls: string[] = [];

    async close(): Promise<void> {}
    async query(): Promise<never> { throw new Error('not implemented'); }
    async queryArrowIPC(): Promise<never> { throw new Error('not implemented'); }

    async attachPersistentDatabase(name: string, alias: string): Promise<void> {
        this.calls.push(`attach:${name}:${alias}`);
    }

    async detachPersistentDatabase(alias: string): Promise<void> {
        this.calls.push(`detach:${alias}`);
    }
}

describe('database shell command', () => {
    const downloader = { downloadBufferAsFile: vi.fn().mockResolvedValue(undefined) };

    beforeEach(() => downloader.downloadBufferAsFile.mockClear());

    it('creates a new persistent database and attaches it', async () => {
        const database = new FakeDatabase();
        const connection = new FakeConnection();
        const registry = new FakeRegistry();
        const command = createDatabaseCommand(database, connection, registry, downloader)!;

        await expect(command[2](['create', 'demo'], {})).resolves.toBe(
            'Created and attached demo as demo\r\nUse demo.public.<table> in SQL',
        );
        expect(database.calls).toEqual(['list', 'create:demo']);
        expect(connection.calls).toEqual(['attach:demo:demo']);
        expect(await registry.list()).toEqual(['demo']);
    });

    it('does not overwrite a persistent database during create', async () => {
        const database = new FakeDatabase();
        const registry = new FakeRegistry();
        registry.databases.add('demo');
        const command = createDatabaseCommand(database, new FakeConnection(), registry, downloader)!;

        await expect(command[2](['create', 'demo'], {})).rejects.toThrow('persistent database already exists: demo');
        expect(database.calls).toEqual(['list']);
    });

    it('attaches an existing loaded database and supports its lifecycle commands', async () => {
        const database = new FakeDatabase();
        database.databases.push({ name: 'demo', storage: 'persistent' });
        const connection = new FakeConnection();
        const registry = new FakeRegistry();
        const command = createDatabaseCommand(database, connection, registry, downloader)!;

        await expect(command[2](['attach', 'demo', 'saved'], {})).resolves.toBe(
            'Opened and attached demo as saved\r\nUse saved.public.<table> in SQL',
        );
        await expect(command[2](['checkpoint', 'demo'], {})).resolves.toBe('Checkpointed demo');
        await expect(command[2](['detach', 'saved'], {})).resolves.toBe('Detached saved');
        await expect(command[2](['drop', 'demo'], {})).resolves.toBe('Dropped demo');

        expect(database.calls).toEqual(['list', 'list', 'checkpoint:demo', 'list', 'drop:demo']);
        expect(connection.calls).toEqual(['attach:demo:saved', 'detach:saved']);
        expect(await registry.list()).toEqual([]);
    });

    it('opens and registers a persistent database hidden from the engine list after reload', async () => {
        const database = new FakeDatabase();
        const connection = new FakeConnection();
        const registry = new FakeRegistry();
        const command = createDatabaseCommand(database, connection, registry, downloader)!;

        await expect(command[2](['attach', 'test1'], {})).resolves.toBe(
            'Opened and attached test1 as test1\r\nUse test1.public.<table> in SQL',
        );
        expect(database.calls).toEqual(['list', 'open:test1']);
        expect(await command[2](['list'], {})).toBe('test1');
    });

    it('drops an unregistered persistent database without opening it', async () => {
        const database = new FakeDatabase();
        database.openError = new Error('corrupt database');
        const registry = new FakeRegistry();
        const remove = vi.fn().mockResolvedValue(true);
        const command = createDatabaseCommand(database, new FakeConnection(), registry, downloader, undefined, remove)!;

        registry.databases.add('test1');
        await expect(command[2](['drop', 'test1;'], {})).resolves.toBe(
            'Deleted test1.hyper directly from OPFS\r\nReload the page before recreating test1',
        );
        expect(database.calls).toEqual(['list', 'open:test1']);
        expect(remove).toHaveBeenCalledWith('test1');
        expect(await registry.list()).toEqual([]);
    });

    it('lists only persistent databases and rejects a memory database name', async () => {
        const database = new FakeDatabase();
        database.databases.push(
            { name: 'temporary', storage: 'memory' },
            { name: 'persisted', storage: 'persistent' },
        );
        const registry = new FakeRegistry();
        registry.databases.add('persisted');
        const command = createDatabaseCommand(database, new FakeConnection(), registry, downloader)!;

        await expect(command[2](['list'], {})).resolves.toBe('persisted');
        await expect(command[2](['attach', 'temporary'], {})).rejects.toThrow('database is not persistent: temporary');
        await expect(command[2](['attach', 'MixedCase'], {})).rejects.toThrow(
            'persistent database names must use lowercase letters, digits, hyphens, or underscores',
        );
        await expect(command[2](['unknown'], {})).rejects.toThrow('usage: .database [list|create|attach|detach|checkpoint|get|drop]');
    });

    it('checkpoints and downloads a registered persistent database', async () => {
        const database = new FakeDatabase();
        const registry = new FakeRegistry();
        registry.databases.add('demo');
        const read = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
        const command = createDatabaseCommand(database, new FakeConnection(), registry, downloader, read)!;

        await expect(command[2](['get', 'demo'], {})).resolves.toBe('Downloaded demo.hyper');
        expect(database.calls).toEqual(['list', 'open:demo', 'checkpoint:demo']);
        expect(read).toHaveBeenCalledWith('demo');
        expect(downloader.downloadBufferAsFile).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'demo.hyper');
    });

    it('does not read or download when checkpointing fails', async () => {
        const database = new FakeDatabase();
        database.checkpointPersistentDatabase = async () => { throw new Error('checkpoint failed'); };
        const registry = new FakeRegistry();
        registry.databases.add('demo');
        const read = vi.fn();
        const command = createDatabaseCommand(database, new FakeConnection(), registry, downloader, read)!;

        await expect(command[2](['get', 'demo'], {})).rejects.toThrow('checkpoint failed');
        expect(read).not.toHaveBeenCalled();
        expect(downloader.downloadBufferAsFile).not.toHaveBeenCalled();
    });

    it('is unavailable when the embedded database has no OPFS capability', () => {
        const connection: EmbeddedConnection = {
            close: async () => {},
            query: async () => { throw new Error('not implemented'); },
            queryArrowIPC: async () => { throw new Error('not implemented'); },
        };
        expect(createDatabaseCommand({}, connection, new FakeRegistry(), downloader)).toBeNull();
    });
});
