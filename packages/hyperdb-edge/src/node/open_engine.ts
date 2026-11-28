import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { HyperDB, type HyperDBConnection, type HyperDBSettings, type MountedResource } from 'hyperdb-wasm';

import { quoteIdentifier } from '../quote.js';
import { checkWasmFeatures } from './runtime_check.js';

/// Where the engine sees the working folder. hyperdb-wasm reaches host files only through mounts below /mnt/external.
export const WORK_MOUNT = '/mnt/external/work';

/// The settings of the engine unless the caller sets them: one log file, the engine can't put it elsewhere
export const DEFAULT_ENGINE_SETTINGS: HyperDBSettings = Object.freeze({
    log_file_max_count: 1,
});

export interface OpenEngineOptions {
    /// A .hyper file, created when missing; relative paths resolve against the working folder
    readonly database?: string | null;
    /// The host folder that SQL reads and writes at WORK_MOUNT
    readonly workDirectory: string;
    readonly settings?: HyperDBSettings;
}

export interface OpenEngine {
    readonly database: HyperDB;
    readonly connection: HyperDBConnection;
    /// The name the database is attached under, the file name without .hyper, or null without a database
    readonly databaseName: string | null;
    /// The host folder that the engine stores in: the folder of the database, or a temporary one
    readonly storagePath: string;
    close(): Promise<void>;
}

/// The folder of the database does not exist
export class DatabaseFolderMissingError extends Error {
    constructor(readonly folder: string) {
        super(`the folder ${folder} of the database does not exist`);
        this.name = 'DatabaseFolderMissingError';
    }
}

/// The engine refused its settings
export class EngineSettingsError extends Error {
    constructor(
        readonly settings: HyperDBSettings,
        cause: unknown,
    ) {
        const names = Object.keys(settings).join(', ');
        super(`the engine refused the settings ${names}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
        this.name = 'EngineSettingsError';
    }
}

function isDirectory(folder: string): boolean {
    try {
        return statSync(folder).isDirectory();
    } catch {
        return false;
    }
}

/// A database file of the working folder
export interface DatabaseFile {
    /// The absolute path
    readonly path: string;
    /// The name of the file
    readonly fileName: string;
    /// The name the database is attached under, the file name without .hyper
    readonly name: string;
}

/// Resolve a database file against the working folder. Fails if its folder does not exist.
export function resolveDatabaseFile(workDirectory: string, database: string): DatabaseFile {
    const databasePath = path.resolve(workDirectory, database);
    if (!isDirectory(path.dirname(databasePath))) throw new DatabaseFolderMissingError(path.dirname(databasePath));
    const fileName = path.basename(databasePath);
    const name = fileName.endsWith('.hyper') ? fileName.slice(0, -'.hyper'.length) : fileName;
    return { path: databasePath, fileName, name };
}

/// Start the engine, mount the working folder and open the database.
/// The engine stores in the folder of the database file: hyperdb-wasm mounts one host folder as its storage, and
/// the engine writes its logs/ there as well. Without a database it stores in a temporary folder that close() removes.
export async function openEngine(options: OpenEngineOptions): Promise<OpenEngine> {
    checkWasmFeatures();

    let storagePath: string;
    let file: DatabaseFile | null = null;
    let temporary = false;
    if (options.database != null) {
        file = resolveDatabaseFile(options.workDirectory, options.database);
        storagePath = path.dirname(file.path);
    } else {
        storagePath = mkdtempSync(path.join(tmpdir(), 'hyperdb-edge-'));
        temporary = true;
    }
    const removeStorage = () => {
        if (temporary) rmSync(storagePath, { recursive: true, force: true });
    };

    const settings = { ...DEFAULT_ENGINE_SETTINGS, ...options.settings };
    let database: HyperDB;
    try {
        database = await HyperDB.create({ storagePath, settings });
    } catch (e) {
        removeStorage();
        if (e instanceof Error && /settings/i.test(e.message) && options.settings != null && Object.keys(options.settings).length > 0) {
            throw new EngineSettingsError(options.settings, e);
        }
        throw e;
    }

    let mount: MountedResource | null = null;
    let connection: HyperDBConnection | null = null;
    let closed = false;
    const close = async () => {
        if (closed) return;
        closed = true;
        try {
            await connection?.close();
            await mount?.close();
        } finally {
            await database.terminate();
            removeStorage();
        }
    };

    try {
        mount = await database.mount(options.workDirectory, { path: WORK_MOUNT, mode: 'readwrite' });
        connection = await database.connect();
        if (file != null) {
            await connection.execute(`CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(file.fileName)}`);
            await connection.execute(`ATTACH DATABASE ${quoteIdentifier(file.fileName)} AS ${quoteIdentifier(file.name)}`);
        }
        return { database, connection, databaseName: file?.name ?? null, storagePath, close };
    } catch (e) {
        await close().catch(() => {});
        throw e;
    }
}
