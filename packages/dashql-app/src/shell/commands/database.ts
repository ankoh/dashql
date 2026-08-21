import type {
    EmbeddedConnection,
    EmbeddedPersistentDatabase,
    EmbeddedPersistentDatabaseConnection,
} from '../../platform/database/embedded_database.js';
import type { FileDownloader } from '../../platform/file/file_downloader.js';
import type { DashQLShellCommand } from '../api.js';
import type { PersistentDatabaseRegistry } from '../persistent_database_registry.js';
import { deletePersistentDatabaseFile, readPersistentDatabaseFile } from '../persistent_database_export.js';

type PersistentDatabaseConnection = EmbeddedConnection & EmbeddedPersistentDatabaseConnection;

function isPersistentDatabaseConnection(connection: EmbeddedConnection): connection is PersistentDatabaseConnection {
    return 'attachPersistentDatabase' in connection && 'detachPersistentDatabase' in connection;
}

export function createDatabaseCommand(
    database: unknown,
    connection: EmbeddedConnection,
    registry: PersistentDatabaseRegistry,
    downloader: FileDownloader,
    readDatabaseFile: (name: string) => Promise<Uint8Array> = readPersistentDatabaseFile,
    deleteDatabaseFile: (name: string) => Promise<boolean> = deletePersistentDatabaseFile,
): DashQLShellCommand | null {
    if (!isPersistentDatabase(database) || !isPersistentDatabaseConnection(connection)) return null;

    return [
        'database',
        'Manage persistent OPFS databases: list, create, attach, detach, checkpoint, get, or drop',
        async args => {
            const normalizedArgs = args.map((arg, index) => index === args.length - 1 ? arg.replace(/;+$/, '') : arg);
            const [action = 'list', name, alias] = normalizedArgs;
            if (args.length > 3) throw new Error('usage: .database [list|create|attach|detach|checkpoint|get|drop]');
            switch (action) {
                case 'list': {
                    if (name != null) throw new Error('usage: .database list');
                    const databases = await registry.list();
                    return databases.length === 0 ? 'No persistent databases' : databases.join('\r\n');
                }
                case 'create': {
                    if (name == null) throw new Error('usage: .database create <name> [alias]');
                    const databaseAlias = alias ?? name;
                    validatePersistentDatabaseName(name);
                    const loaded = (await database.listDatabases()).find(entry => entry.name === name);
                    if (loaded?.storage === 'memory') throw new Error(`database is not persistent: ${name}`);
                    if (loaded != null || (await registry.list()).includes(name)) {
                        throw new Error(`persistent database already exists: ${name}`);
                    }
                    await database.createPersistentDatabase(name);
                    await registry.add(name);
                    await connection.attachPersistentDatabase(name, databaseAlias);
                    return `Created and attached ${name} as ${databaseAlias}\r\nUse ${databaseAlias}.public.<table> in SQL`;
                }
                case 'attach': {
                    if (name == null) throw new Error('usage: .database attach <name> [alias]');
                    const databaseAlias = alias ?? name;
                    validatePersistentDatabaseName(name);
                    const loaded = (await database.listDatabases()).find(entry => entry.name === name);
                    if (loaded?.storage === 'memory') throw new Error(`database is not persistent: ${name}`);
                    if (loaded == null) await database.openPersistentDatabase(name);
                    await registry.add(name);
                    await connection.attachPersistentDatabase(name, databaseAlias);
                    return `Opened and attached ${name} as ${databaseAlias}\r\nUse ${databaseAlias}.public.<table> in SQL`;
                }
                case 'detach':
                    if (name == null || alias != null) throw new Error('usage: .database detach <alias>');
                    await connection.detachPersistentDatabase(name);
                    return `Detached ${name}`;
                case 'checkpoint':
                    if (name == null || alias != null) throw new Error('usage: .database checkpoint <name>');
                    await openRegisteredDatabase(database, registry, name);
                    await database.checkpointPersistentDatabase(name);
                    return `Checkpointed ${name}`;
                case 'get': {
                    if (name == null || alias != null) throw new Error('usage: .database get <name>');
                    validatePersistentDatabaseName(name);
                    await openRegisteredDatabase(database, registry, name);
                    await database.checkpointPersistentDatabase(name);
                    await downloader.downloadBufferAsFile(await readDatabaseFile(name), `${name}.hyper`);
                    return `Downloaded ${name}.hyper`;
                }
                case 'drop':
                    if (name == null || alias != null) throw new Error('usage: .database drop <name>');
                    validatePersistentDatabaseName(name);
                    const loaded = (await database.listDatabases()).find(entry => entry.name === name);
                    if (loaded?.storage === 'memory') throw new Error(`database is not persistent: ${name}`);
                    let removedDirectly = false;
                    if (loaded != null) {
                        await database.dropPersistentDatabase(name);
                    } else if ((await registry.list()).includes(name)) {
                        try {
                            await database.openPersistentDatabase(name);
                            await database.dropPersistentDatabase(name);
                        } catch {
                            if (!await deleteDatabaseFile(name)) throw new Error(`persistent database does not exist: ${name}`);
                            removedDirectly = true;
                        }
                    } else {
                        throw new Error(`persistent database does not exist: ${name}`);
                    }
                    await registry.delete(name);
                    if (removedDirectly) {
                        return `Deleted ${name}.hyper directly from OPFS\r\nReload the page before recreating ${name}`;
                    }
                    return `Dropped ${name}`;
                default:
                    throw new Error('usage: .database [list|create|attach|detach|checkpoint|get|drop]');
            }
        },
    ];
}

async function openRegisteredDatabase(
    database: EmbeddedPersistentDatabase,
    registry: PersistentDatabaseRegistry,
    name: string,
): Promise<void> {
    const loaded = (await database.listDatabases()).find(entry => entry.name === name);
    if (loaded?.storage === 'memory') throw new Error(`database is not persistent: ${name}`);
    if (loaded != null) return;
    if (!(await registry.list()).includes(name)) throw new Error(`persistent database is not registered: ${name}`);
    await database.openPersistentDatabase(name);
}

function isPersistentDatabaseName(name: string): boolean {
    if (name.length === 0 || name.length > 200 || !/^[a-z0-9][a-z0-9_-]*$/.test(name)) return false;
    return !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(name);
}

function validatePersistentDatabaseName(name: string): void {
    if (!isPersistentDatabaseName(name)) {
        throw new Error('persistent database names must use lowercase letters, digits, hyphens, or underscores');
    }
}

function isPersistentDatabase(value: unknown): value is EmbeddedPersistentDatabase {
    return value != null && typeof value === 'object' &&
        'listDatabases' in value &&
        'createPersistentDatabase' in value &&
        'openPersistentDatabase' in value &&
        'checkpointPersistentDatabase' in value &&
        'dropPersistentDatabase' in value;
}
