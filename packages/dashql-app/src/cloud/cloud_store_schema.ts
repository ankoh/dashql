import type * as arrow from 'apache-arrow';

import { createTableSQL, qualifiedName, type CloudColumn } from './cloud_sql.js';
import { quoteLiteral } from '@akohn/dashql/platform/utils/sql_quote';
import { VERSIONS_TABLE } from '@akohn/dashql/platform/storage/workbook_tables';

// The tables of DashQL in the cloud connection and how they evolve. See docs/design/cloud.md.
//
// Clients of different versions share the tables. A migration only adds: tables and nullable columns, declared, so the
// columns of the tables follow from the number of migrations that ran. Every statement names its columns, so a client
// keeps reading and writing tables that later migrations changed, unless one of them declared that it breaks the
// clients that don't know it. The store row holds the number of migrations that ran, the oldest clients that may still
// read and write, and a lock. Only the installer creates and migrates the tables: it takes the lock and runs the
// migrations that it knows and the tables miss, an installer of another client waits for it. A writer refuses tables
// that are missing or older than it, a reader never migrates and never waits, it reads the columns that exist.

/// The database of DashQL in the cloud connection
export const CLOUD_DATABASE = 'dashql';
/// The schema of the tables of DashQL
export const CLOUD_SCHEMA = 'dashql';
/// The store row: the version of the tables, the oldest clients that may use them, the lock of a migration
export const CLOUD_STORE_TABLE = 'cloud_store';
/// The versions of the published workbooks, one row per version: the versions table of the workbook tables with the
/// columns of the store after its columns
export const CLOUD_VERSIONS_TABLE = VERSIONS_TABLE;
/// The published workbooks, one row per workbook: its folder and whether it was deleted
export const CLOUD_WORKBOOKS_TABLE = 'workbooks';
/// The folders of the published workbooks, a folder names its parent
export const CLOUD_FOLDERS_TABLE = 'workbook_folders';

/// The text of a UUID as Hyper writes it: lowercase, with dashes
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/// Check the id of a workbook, a version or a folder, a UUID in the text that Hyper gives back
export function checkCloudId(id: string, what: string): string {
    if (!UUID_TEXT.test(id)) throw new Error(`Not the id of a ${what}: ${id}`);
    return id;
}

/// Run a SQL statement on the cloud connection, the result of a query
export type CloudQuery = (sql: string, signal?: AbortSignal) => Promise<arrow.Table>;

export interface CloudStoreOptions {
    /// The database of DashQL, CLOUD_DATABASE by default
    database?: string;
    /// The length of an INSERT statement at which the next row goes into another one
    maxStatementLength?: number;
    /// The migrations that this client knows, CLOUD_MIGRATIONS by default
    migrations?: readonly CloudMigration[];
    /// How long the lock of a migration holds without being renewed, 2 minutes by default
    lockSeconds?: number;
    /// How long to wait for the migration of another client, as long as a lock holds by default
    lockWaitMs?: number;
    /// How often to look at the lock of another client, every second by default
    lockPollMs?: number;
    signal?: AbortSignal;
}

/// A table of DashQL
export function cloudTable(tableName: string, options: CloudStoreOptions): string {
    return qualifiedName(options.database ?? CLOUD_DATABASE, CLOUD_SCHEMA, tableName);
}

/// A migration of the tables of DashQL. It declares what it adds, running it again, also after it stopped halfway, ends
/// the same way.
export interface CloudMigration {
    /// What the migration changes
    description: string;
    /// The tables that the migration creates, with their columns
    tables?: Record<string, CloudColumn[]>;
    /// The columns that the migration adds to the tables of earlier migrations, all nullable
    columns?: Record<string, CloudColumn[]>;
    /// Clients that don't know this migration may no longer write, or no longer read and write.
    /// Without, the migration only adds what older clients don't miss.
    breaks?: 'writers' | 'readers';
}

const column = (name: string, type: string, nullable = false): CloudColumn => ({ name, type, nullable });
const KEY = [column('workbook_id', 'uuid'), column('version_id', 'uuid')];

/// The tables as the first migration creates them. They never change, a change is a migration of its own.
const TABLES_1: Record<string, CloudColumn[]> = {
    workbook_versions: [
        ...KEY, column('format_version', 'integer'), column('name', 'text', true), column('metadata', 'text'),
        column('state', 'text'), column('created_at', 'timestamptz'), column('ready_at', 'timestamptz', true), column('updated_at', 'timestamptz'),
        column('published_by', 'text', true), column('app_version', 'text', true),
    ],
    workbook_connections: [...KEY, column('position', 'integer'), column('connection_id', 'text'), column('name', 'text', true), column('params', 'text')],
    workbook_scripts: [...KEY, column('position', 'integer'), column('name', 'text'), column('connection_id', 'text'), column('text', 'text')],
    connection_catalog_tables: [
        ...KEY, column('table_id', 'integer'), column('connection_id', 'text'), column('database_name', 'text'), column('schema_name', 'text'),
        column('table_name', 'text'),
    ],
    connection_catalog_columns: [...KEY, column('table_id', 'integer'), column('position', 'integer'), column('column_name', 'text'), column('column_type', 'text', true)],
    connection_catalog_functions: [
        ...KEY, column('function_id', 'integer'), column('connection_id', 'text'), column('database_name', 'text'), column('schema_name', 'text'),
        column('function_name', 'text'), column('is_aggregate', 'boolean'), column('return_type', 'text', true),
    ],
    connection_catalog_function_params: [
        ...KEY, column('function_id', 'integer'), column('position', 'integer'), column('param_name', 'text', true), column('param_type', 'text', true),
    ],
    workbook_attachments: [...KEY, column('position', 'integer'), column('name', 'text'), column('table_name', 'text')],
    workbook_results: [...KEY, column('cache_key', 'text'), column('table_name', 'text')],
    workbooks: [
        column('workbook_id', 'uuid'), column('folder_id', 'uuid', true), column('created_at', 'timestamptz'), column('created_by', 'text', true),
        column('updated_at', 'timestamptz'), column('deleted_at', 'timestamptz', true),
    ],
    workbook_folders: [
        column('folder_id', 'uuid'), column('parent_id', 'uuid', true), column('name', 'text'), column('created_at', 'timestamptz'),
        column('created_by', 'text', true), column('updated_at', 'timestamptz'), column('deleted_at', 'timestamptz', true),
    ],
};

/// The migrations of the tables of DashQL, in order. Only ever append to them.
export const CLOUD_MIGRATIONS: readonly CloudMigration[] = [
    { description: 'Create the tables of the published workbooks', tables: TABLES_1 },
    // A result belongs to its script, the key in its name only tells whether it fits the script (workbook_results.md)
    { description: 'Name the scripts of the published query results', columns: { workbook_results: [column('script_name', 'text', true)] } },
    // The view that a published workbook opens in, null for the feed
    { description: 'Name the default views of the published workbooks', columns: { workbook_versions: [column('default_view', 'text', true)] } },
];

/// The columns of the tables after a number of migrations, by table
export function cloudColumnsAfter(migrations: readonly CloudMigration[], count: number): Map<string, Set<string>> {
    const columns = new Map<string, Set<string>>();
    for (const migration of migrations.slice(0, count)) {
        for (const [tableName, created] of Object.entries(migration.tables ?? {})) {
            columns.set(tableName, new Set(created.map(column => column.name)));
        }
        for (const [tableName, added] of Object.entries(migration.columns ?? {})) {
            const existing = columns.get(tableName) ?? new Set<string>();
            for (const column of added) existing.add(column.name);
            columns.set(tableName, existing);
        }
    }
    return columns;
}

/// Run a migration: create its tables and add its columns, unless they exist already
async function runMigration(query: CloudQuery, migration: CloudMigration, options: CloudStoreOptions): Promise<void> {
    for (const [tableName, columns] of Object.entries(migration.tables ?? {})) {
        await query(createTableSQL(cloudTable(tableName, options), columns).replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS '), options.signal);
    }
    for (const [tableName, columns] of Object.entries(migration.columns ?? {})) {
        for (const column of columns) await addColumnIfMissing(query, tableName, column, options);
    }
}

/// Add a nullable column to a table of DashQL, unless it has it already
async function addColumnIfMissing(query: CloudQuery, tableName: string, added: CloudColumn, options: CloudStoreOptions): Promise<void> {
    if (!added.nullable) {
        throw new Error(`A migration only adds nullable columns, ${added.name} is not`);
    }
    const table = cloudTable(tableName, options);
    const exists = async () => {
        try {
            await query(`SELECT ${qualifiedName(added.name)} FROM ${table} LIMIT 0`, options.signal);
            return true;
        } catch {
            return false;
        }
    };
    if (await exists()) return;
    try {
        await query(`ALTER TABLE ${table} ADD COLUMN ${qualifiedName(added.name)} ${added.type}`, options.signal);
    } catch (error) {
        if (!await exists()) throw error;
    }
}

/// The store row
export interface CloudStoreState {
    /// The number of migrations that ran
    version: number;
    /// The oldest client that may read the tables, by the number of migrations it knows
    minReader: number;
    /// The oldest client that may write the tables, by the number of migrations it knows
    minWriter: number;
    /// The client that holds the lock, a UUID, null without a lock
    lockOwner: string | null;
    /// Has the lock expired?
    lockExpired: boolean;
}

/// The client is too old for the tables of DashQL in the cloud
export class CloudStoreVersionError extends Error {
    constructor(access: 'read' | 'write') {
        super(access === 'read'
            ? 'The cloud holds the workbooks of a newer DashQL, update DashQL to read them'
            : 'The cloud holds the workbooks of a newer DashQL, update DashQL to publish');
        this.name = 'CloudStoreVersionError';
    }
}

/// The tables of DashQL in the cloud need the installer before this client writes
export class CloudStoreSetupError extends Error {
    constructor(readonly needs: 'install' | 'update') {
        super(needs === 'install'
            ? 'DashQL is not installed in the cloud connection, install it first'
            : 'The tables of DashQL in the cloud are older than this DashQL, update them first');
        this.name = 'CloudStoreSetupError';
    }
}

function storeTable(options: CloudStoreOptions): string {
    return cloudTable(CLOUD_STORE_TABLE, options);
}

/// The tables as a client opened them
export interface CloudStoreView extends CloudStoreState {
    /// The columns that the client may use, those it knows that exist, by table. A table that doesn't exist is missing.
    columns: ReadonlyMap<string, ReadonlySet<string>>;
}

/// The store row of a cloud without the tables of DashQL
const EMPTY_STORE: CloudStoreState = { version: 0, minReader: 0, minWriter: 0, lockOwner: null, lockExpired: true };

/// Read the store row, null if there is no store table. A statement that fails while the connection answers means that
/// there is no store table, other failures are thrown.
async function readStoreState(query: CloudQuery, options: CloudStoreOptions): Promise<CloudStoreState | null> {
    let table: arrow.Table;
    try {
        table = await query(`SELECT version, min_reader, min_writer, CAST(lock_owner AS text) AS lock_owner, `
            + `COALESCE(lock_expires_at < now(), true) AS lock_expired FROM ${storeTable(options)}`, options.signal);
    } catch (error) {
        try {
            await query('SELECT 1', options.signal);
        } catch {
            throw error;
        }
        return null;
    }
    if (table.numRows !== 1) {
        throw new Error(`Expected one row in the store of DashQL, found ${table.numRows}`);
    }
    const row = table.get(0)!;
    return {
        version: Number(row.version),
        minReader: Number(row.min_reader),
        minWriter: Number(row.min_writer),
        lockOwner: row.lock_owner == null ? null : String(row.lock_owner),
        lockExpired: Boolean(row.lock_expired),
    };
}

/// Read the store row, created with its one row if there is none. Of two clients that create it at the same time, one
/// fails to and reads the row of the other.
async function readOrCreateStoreState(query: CloudQuery, options: CloudStoreOptions): Promise<CloudStoreState> {
    const state = await readStoreState(query, options);
    if (state != null) return state;
    await query(`CREATE SCHEMA IF NOT EXISTS ${qualifiedName(options.database ?? CLOUD_DATABASE, CLOUD_SCHEMA)}`, options.signal);
    try {
        await query(`CREATE TABLE ${storeTable(options)} AS SELECT CAST(0 AS integer) AS version, CAST(0 AS integer) AS min_reader, `
            + `CAST(0 AS integer) AS min_writer, CAST(NULL AS uuid) AS lock_owner, CAST(NULL AS timestamptz) AS lock_expires_at`, options.signal);
    } catch (error) {
        const created = await readStoreState(query, options);
        if (created == null) throw error;
        return created;
    }
    const created = await readStoreState(query, options);
    if (created == null) throw new Error('The store of DashQL could not be created');
    return created;
}

function checkClient(state: CloudStoreState, known: number, access: 'read' | 'write'): void {
    if (known < state.minReader) throw new CloudStoreVersionError('read');
    if (access === 'write' && known < state.minWriter) throw new CloudStoreVersionError('write');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        signal?.throwIfAborted();
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', abort);
            resolve();
        }, ms);
        const abort = () => {
            clearTimeout(timer);
            reject(signal!.reason);
        };
        signal?.addEventListener('abort', abort, { once: true });
    });
}

/// Open the tables of DashQL and check that they don't need a newer client.
///
/// A writer needs the tables that the migrations it knows declare, the installer creates and updates them. A reader
/// changes nothing and waits for nothing: it reads the columns that exist, a cloud without the tables of DashQL reads
/// as empty. So neither needs the rights to create or alter tables.
export async function openCloudStore(query: CloudQuery, access: 'read' | 'write', options: CloudStoreOptions = {}): Promise<CloudStoreView> {
    const migrations = options.migrations ?? CLOUD_MIGRATIONS;
    const known = migrations.length;
    const state = await readStoreState(query, options);
    if (access === 'write' && (state == null || state.version === 0)) throw new CloudStoreSetupError('install');
    checkClient(state ?? EMPTY_STORE, known, access);
    if (access === 'write' && state!.version < known) throw new CloudStoreSetupError('update');
    return { ...(state ?? EMPTY_STORE), columns: cloudColumnsAfter(migrations, Math.min(state?.version ?? 0, known)) };
}

/// Drop the tables of DashQL with the published workbooks. Only the local cloud offers it, to try the installer again.
export async function dropCloudStore(query: CloudQuery, options: CloudStoreOptions = {}): Promise<void> {
    await query(`DROP SCHEMA IF EXISTS ${qualifiedName(options.database ?? CLOUD_DATABASE, CLOUD_SCHEMA)} CASCADE`, options.signal);
}

/// What the installer finds in the cloud connection
export type CloudInstallationState =
    /// The connection reaches no database of DashQL
    | 'unreachable'
    /// The database holds no tables of DashQL
    | 'missing'
    /// The tables miss migrations that this client knows
    | 'outdated'
    /// The tables have every migration that this client knows
    | 'current'
    /// A migration that this client doesn't know broke it, it may no longer write and maybe no longer read
    | 'newer';

/// A migration that the installer runs
export interface CloudPendingMigration {
    /// The number of migrations that ran after it
    version: number;
    migration: CloudMigration;
}

/// The tables of DashQL in the cloud connection, as the installer finds them
export interface CloudInstallation {
    state: CloudInstallationState;
    /// The database of DashQL
    database: string;
    /// The store row, null without one
    store: CloudStoreState | null;
    /// The number of migrations that this client knows
    known: number;
    /// The migrations that the installer would run, in order
    pending: CloudPendingMigration[];
    /// May this client read the tables?
    canRead: boolean;
    /// May this client write the tables?
    canWrite: boolean;
    /// Another installer holds the lock, the installer waits for it
    locked: boolean;
}

/// Find out whether DashQL is installed in the cloud connection and which migrations the installer would run. Only reads.
export async function inspectCloudStore(query: CloudQuery, options: CloudStoreOptions = {}): Promise<CloudInstallation> {
    const migrations = options.migrations ?? CLOUD_MIGRATIONS;
    const known = migrations.length;
    const database = options.database ?? CLOUD_DATABASE;
    const store = await readStoreState(query, options);
    if (store == null) {
        try {
            await query(`SELECT count(*) AS n FROM ${qualifiedName(database, 'pg_catalog', 'pg_namespace')}`, options.signal);
        } catch {
            return { state: 'unreachable', database, store: null, known, pending: [], canRead: false, canWrite: false, locked: false };
        }
    }
    const version = store?.version ?? 0;
    const pending = migrations.slice(version).map((migration, index) => ({ version: version + index + 1, migration }));
    const canRead = known >= (store?.minReader ?? 0);
    const canWrite = canRead && known >= (store?.minWriter ?? 0);
    const state: CloudInstallationState = !canWrite ? 'newer'
        : version === 0 ? 'missing'
        : version < known ? 'outdated'
        : 'current';
    const locked = store != null && store.lockOwner != null && !store.lockExpired;
    return { state, database, store, known, pending, canRead, canWrite, locked };
}

/// A step of the installer
export type CloudInstallProgress =
    /// Creating the schema and the store row
    | { type: 'store' }
    /// Waiting for the installer of another client
    | { type: 'waiting' }
    /// Running a migration
    | { type: 'migrating'; version: number }
    /// A migration ran
    | { type: 'migrated'; version: number };

export interface CloudInstallOptions extends CloudStoreOptions {
    onProgress?: (progress: CloudInstallProgress) => void;
}

/// Install DashQL in the cloud connection or update its tables: create the schema and the store row if there are none
/// and run the migrations that this client knows and the tables miss. Installers of several clients may run at the
/// same time, one of them takes the lock and the others wait for it.
export async function installCloudStore(query: CloudQuery, options: CloudInstallOptions = {}): Promise<CloudStoreView> {
    const migrations = options.migrations ?? CLOUD_MIGRATIONS;
    const known = migrations.length;
    let state = await readStoreState(query, options);
    if (state == null) {
        options.onProgress?.({ type: 'store' });
        state = await readOrCreateStoreState(query, options);
    }
    checkClient(state, known, 'write');
    if (state.version < known) {
        state = await migrateCloudStore(query, options);
        checkClient(state, known, 'write');
    }
    return { ...state, columns: cloudColumnsAfter(migrations, Math.min(state.version, known)) };
}

/// Run the migrations that this installer knows and the tables miss, under the lock of the store row.
///
/// A single UPDATE takes the lock if nobody holds it or the lock expired. The client that finds itself the owner runs
/// the migrations one by one, every migration counted and the lock renewed in the store row after it, the others wait
/// until the migrations ran or the lock expired. A breaking migration raises the oldest clients before it runs.
async function migrateCloudStore(query: CloudQuery, options: CloudInstallOptions): Promise<CloudStoreState> {
    const migrations = options.migrations ?? CLOUD_MIGRATIONS;
    const known = migrations.length;
    const lockSeconds = Math.max(1, Math.floor(options.lockSeconds ?? 2 * 60));
    const deadline = Date.now() + (options.lockWaitMs ?? lockSeconds * 1000);
    const owner = quoteLiteral(crypto.randomUUID());
    const store = storeTable(options);
    const expires = `now() + INTERVAL '${lockSeconds} seconds'`;
    const owned = (state: CloudStoreState) => state.lockOwner != null && quoteLiteral(state.lockOwner) === owner;

    let state: CloudStoreState;
    let waiting = false;
    for (;;) {
        await query(`UPDATE ${store} SET lock_owner = ${owner}, lock_expires_at = ${expires} `
            + `WHERE version < ${known} AND (lock_owner IS NULL OR lock_expires_at < now())`, options.signal);
        state = (await readStoreState(query, options))!;
        if (owned(state)) break;
        if (state.version >= known) return state;
        if (Date.now() >= deadline) {
            throw new Error('Another client is installing or updating DashQL in the cloud, try again later');
        }
        if (!waiting) options.onProgress?.({ type: 'waiting' });
        waiting = true;
        await sleep(options.lockPollMs ?? 1000, options.signal);
    }
    try {
        for (let version = state.version; version < known; ++version) {
            const migration = migrations[version];
            const next = version + 1;
            if (migration.breaks != null) {
                const readers = migration.breaks === 'readers' ? `, min_reader = ${next}` : '';
                await query(`UPDATE ${store} SET min_writer = ${next}${readers} WHERE lock_owner = ${owner}`, options.signal);
            }
            options.onProgress?.({ type: 'migrating', version: next });
            await runMigration(query, migration, options);
            await query(`UPDATE ${store} SET version = ${next}, lock_expires_at = ${expires} `
                + `WHERE lock_owner = ${owner} AND version = ${version}`, options.signal);
            state = (await readStoreState(query, options))!;
            if (!owned(state) || state.version !== next) {
                throw new Error(`Lost the lock while migrating the tables of DashQL: ${migration.description}`);
            }
            options.onProgress?.({ type: 'migrated', version: next });
        }
    } finally {
        await query(`UPDATE ${store} SET lock_owner = NULL, lock_expires_at = NULL WHERE lock_owner = ${owner}`).catch(() => {});
    }
    return (await readStoreState(query, options))!;
}
