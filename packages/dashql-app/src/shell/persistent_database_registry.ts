import { STORAGE_SHELL_FOLDER } from '../app/notebook/persistence/storage_backend.js';
import { listPersistentDatabaseFiles } from './persistent_database_export.js';

const DATABASES_FILE = 'persistent-databases.json';
const DATABASES_LOCK = 'dashql-persistent-databases';

interface PersistentDatabaseDocument {
    version: 1;
    databases: string[];
}

export interface PersistentDatabaseRegistry {
    list(): Promise<readonly string[]>;
    add(name: string): Promise<void>;
    delete(name: string): Promise<void>;
}

export class OPFSPersistentDatabaseRegistry implements PersistentDatabaseRegistry {
    constructor(
        private readonly getOPFSRoot: () => Promise<FileSystemDirectoryHandle> = () => navigator.storage.getDirectory(),
    ) {}

    async list(): Promise<readonly string[]> {
        const databases = new Set(await listPersistentDatabaseFiles(this.getOPFSRoot));
        const directory = await this.getDirectory(false);
        if (directory == null) return [...databases].sort((a, b) => a.localeCompare(b));
        try {
            const handle = await directory.getFileHandle(DATABASES_FILE, { create: false });
            const document: unknown = JSON.parse(await (await handle.getFile()).text());
            if (document == null || typeof document !== 'object') throw invalidRegistry();
            const candidate = document as Partial<PersistentDatabaseDocument>;
            if (
                candidate.version !== 1 ||
                !Array.isArray(candidate.databases) ||
                !candidate.databases.every(name => typeof name === 'string' && name.length > 0)
            ) {
                throw invalidRegistry();
            }
            for (const name of candidate.databases) databases.add(name);
            return [...databases].sort((a, b) => a.localeCompare(b));
        } catch (error) {
            if ((error as DOMException).name === 'NotFoundError') {
                return [...databases].sort((a, b) => a.localeCompare(b));
            }
            throw error;
        }
    }

    async add(name: string): Promise<void> {
        await this.withLock(async () => {
            const databases = new Set(await this.list());
            databases.add(name);
            await this.write([...databases].sort((a, b) => a.localeCompare(b)));
        });
    }

    async delete(name: string): Promise<void> {
        await this.withLock(async () => {
            const databases = (await this.list()).filter(database => database !== name);
            await this.write(databases);
        });
    }

    private async withLock<T>(operation: () => Promise<T>): Promise<T> {
        if (typeof navigator !== 'undefined' && navigator.locks != null) {
            return await navigator.locks.request(DATABASES_LOCK, operation);
        }
        return await operation();
    }

    private async write(databases: string[]): Promise<void> {
        const directory = await this.getDirectory(true);
        if (directory == null) throw new Error('Could not create persistent database registry directory');
        const handle = await directory.getFileHandle(DATABASES_FILE, { create: true });
        const writable = await handle.createWritable();
        try {
            await writable.write(JSON.stringify({ version: 1, databases } satisfies PersistentDatabaseDocument, null, 2));
        } finally {
            await writable.close();
        }
    }

    private async getDirectory(create: boolean): Promise<FileSystemDirectoryHandle | null> {
        try {
            return await (await this.getOPFSRoot()).getDirectoryHandle(STORAGE_SHELL_FOLDER, { create });
        } catch (error) {
            if (!create && (error as DOMException).name === 'NotFoundError') return null;
            throw error;
        }
    }
}

function invalidRegistry(): Error {
    return new Error('Invalid persistent database registry format');
}
