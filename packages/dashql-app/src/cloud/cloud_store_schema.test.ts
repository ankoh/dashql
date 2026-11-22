import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from '@akohn/dashql';

import type { HyperDB, HyperDBConnection } from '@akohn/dashql/platform/hyperdb/hyperdb_wasm';
import { createTestHyperDB, testDatabasePath } from '../tests/hyperdb_test_client.js';
import { cloudColumnsUsed } from './cloud_store.js';
import {
    CLOUD_DATABASE,
    CLOUD_MIGRATIONS,
    cloudColumnsAfter,
    CloudStoreSetupError,
    CloudStoreVersionError,
    inspectCloudStore,
    type CloudInstallProgress,
    installCloudStore,
    openCloudStore,
    type CloudMigration,
    type CloudQuery,
} from './cloud_store_schema.js';

/// The number of migrations that this client knows, a test adds its own after them
const KNOWN = CLOUD_MIGRATIONS.length;

let database: HyperDB;
let dispose: () => Promise<void>;
/// Two clients of the cloud, each with a connection of its own
let connections: HyperDBConnection[] = [];
let clients: CloudQuery[] = [];
/// The statements that the clients sent
let statements: string[];

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
/// The core of the tests, the cloud store reads the workbook tables and the storage versions from it
let dql: core.DashQL;

beforeAll(async () => {
    dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
    const test = await createTestHyperDB('dashql-cloud-store-schema');
    database = test.database;
    dispose = test.dispose;
    const path = await testDatabasePath(`dashql-cloud-schema-${crypto.randomUUID()}.hyper`);
    connections = [await database.connect(), await database.connect()];
    await connections[0].execute(`CREATE DATABASE "${path}"`);
    for (const connection of connections) {
        await connection.execute(`ATTACH DATABASE "${path}" AS "${CLOUD_DATABASE}"`);
    }
}, 60_000);
afterAll(async () => {
    for (const connection of connections) await connection.close();
    await dispose?.();
});
beforeEach(async () => {
    statements = [];
    clients = connections.map(connection => async (sql, signal) => {
        statements.push(sql);
        return await connection.query(sql, signal);
    });
    await connections[0].execute(`DROP SCHEMA IF EXISTS "${CLOUD_DATABASE}"."dashql" CASCADE`);
});

async function storeRow(): Promise<Record<string, unknown>> {
    const table = await connections[0].query(`SELECT version, min_reader, min_writer, CAST(lock_owner AS text) AS lock_owner FROM "dashql"."dashql"."cloud_store"`);
    expect(table.numRows).toBe(1);
    return { ...table.get(0)!.toJSON() };
}

/// A migration that adds a column to the scripts
function adding(name: string, breaks?: CloudMigration['breaks']): CloudMigration {
    return { description: `Add ${name}`, columns: { workbook_scripts: [{ name, type: 'text', nullable: true }] }, breaks };
}

/// How often a column was added
function additions(name: string): number {
    return statements.filter(sql => sql.endsWith(`ADD COLUMN "${name}" text`)).length;
}

describe('cloud store schema', () => {
    it('creates the store and runs the migrations once', async () => {
        const state = await installCloudStore(clients[0]);
        expect(state).toMatchObject({ version: CLOUD_MIGRATIONS.length, minReader: 0, minWriter: 0, lockOwner: null });
        expect(await storeRow()).toEqual({ version: CLOUD_MIGRATIONS.length, min_reader: 0, min_writer: 0, lock_owner: null });
        statements = [];
        await installCloudStore(clients[1]);
        // A store that is up to date is only read
        expect(statements.length).toBeGreaterThan(0);
        expect(statements.every(sql => sql.startsWith('SELECT'))).toBe(true);
    });

    it('creates every column that the store uses', async () => {
        const state = await installCloudStore(clients[0]);
        for (const [tableName, columns] of Object.entries(cloudColumnsUsed(dql))) {
            expect([...state.columns.get(tableName)!]).toEqual(expect.arrayContaining(columns));
            await connections[0].query(`SELECT ${columns.map(name => `CAST("${name}" AS text)`).join(', ')} FROM "dashql"."dashql"."${tableName}" LIMIT 0`);
        }
    });

    it('lets one installer migrate while the other waits for it', async () => {
        let started!: () => void;
        const running = new Promise<void>(resolve => { started = resolve; });
        let finish!: () => void;
        const finished = new Promise<void>(resolve => { finish = resolve; });
        const slow: CloudQuery = async (sql, signal) => {
            if (sql.endsWith('ADD COLUMN "slow" text')) {
                started();
                await finished;
            }
            return await clients[0](sql, signal);
        };
        const migrations = [...CLOUD_MIGRATIONS, adding('slow')];
        const first = installCloudStore(slow, { migrations });
        await running;
        const second = installCloudStore(clients[1], { migrations, lockPollMs: 10 });
        await new Promise(resolve => setTimeout(resolve, 100));
        expect((await storeRow()).lock_owner).not.toBeNull();
        finish();
        expect((await first).version).toBe(KNOWN + 1);
        expect((await second).version).toBe(KNOWN + 1);
        expect(additions('slow')).toBe(1);
        expect((await storeRow()).lock_owner).toBeNull();
    });

    it('gives up waiting for the lock of another installer', async () => {
        await installCloudStore(clients[0]);
        await connections[0].execute(`UPDATE "dashql"."dashql"."cloud_store" SET lock_owner = '7c9e6679-7425-40de-944b-e07fc1f90ae7', lock_expires_at = now() + INTERVAL '1 hour'`);
        await expect(installCloudStore(clients[0], { migrations: [...CLOUD_MIGRATIONS, adding('a')], lockWaitMs: 50, lockPollMs: 10 }))
            .rejects.toThrow('Another client is installing');
        expect(additions('a')).toBe(0);
        expect(await storeRow()).toMatchObject({ version: CLOUD_MIGRATIONS.length, lock_owner: '7c9e6679-7425-40de-944b-e07fc1f90ae7' });
    });

    it('takes over a lock that expired', async () => {
        await installCloudStore(clients[0]);
        await connections[0].execute(`UPDATE "dashql"."dashql"."cloud_store" SET lock_owner = '00000000-0000-4000-8000-000000000001', lock_expires_at = now() - INTERVAL '1 minute'`);
        expect((await installCloudStore(clients[0], { migrations: [...CLOUD_MIGRATIONS, adding('a')] })).version).toBe(KNOWN + 1);
        expect(additions('a')).toBe(1);
        expect((await storeRow()).lock_owner).toBeNull();
    });

    it('counts every migration that ran and releases the lock when one fails', async () => {
        const failing: CloudQuery = async (sql, signal) => {
            if (sql.endsWith('ADD COLUMN "b" text')) throw new Error('broken');
            return await clients[0](sql, signal);
        };
        const migrations = [...CLOUD_MIGRATIONS, adding('a'), adding('b')];
        await expect(installCloudStore(failing, { migrations })).rejects.toThrow('broken');
        expect(await storeRow()).toMatchObject({ version: KNOWN + 1, lock_owner: null });
        expect((await installCloudStore(clients[1], { migrations })).version).toBe(KNOWN + 2);
        expect(additions('a')).toBe(1);
        expect(additions('b')).toBe(1);
    });

    it('runs a migration again that stopped halfway', async () => {
        await installCloudStore(clients[0]);
        await connections[0].execute(`ALTER TABLE "dashql"."dashql"."workbook_scripts" ADD COLUMN "a" text`);
        const migrations = [...CLOUD_MIGRATIONS, { description: 'Add a and b', columns: { workbook_scripts: adding('a').columns!.workbook_scripts.concat(adding('b').columns!.workbook_scripts) } }];
        expect((await installCloudStore(clients[0], { migrations })).version).toBe(KNOWN + 1);
        expect(additions('a')).toBe(0);
        expect(additions('b')).toBe(1);
        const required: CloudMigration = { description: 'Add c', columns: { workbook_scripts: [{ name: 'c', type: 'text', nullable: false }] } };
        await expect(installCloudStore(clients[0], { migrations: [...migrations, required] })).rejects.toThrow('only adds nullable columns');
    });

    it('keeps older clients reading and writing until a migration breaks them', async () => {
        const two = [...CLOUD_MIGRATIONS, adding('a')];
        await installCloudStore(clients[0], { migrations: two });
        // An older client uses tables that a newer one migrated
        expect((await openCloudStore(clients[1], 'write')).version).toBe(KNOWN + 1);

        const three = [...two, adding('b', 'writers')];
        expect(await installCloudStore(clients[0], { migrations: three })).toMatchObject({ version: KNOWN + 2, minReader: 0, minWriter: KNOWN + 2 });
        await expect(openCloudStore(clients[1], 'write', { migrations: two })).rejects.toThrow(CloudStoreVersionError);
        await openCloudStore(clients[1], 'read', { migrations: two });

        const four = [...three, adding('c', 'readers')];
        expect(await installCloudStore(clients[0], { migrations: four })).toMatchObject({ version: KNOWN + 3, minReader: KNOWN + 3, minWriter: KNOWN + 3 });
        await expect(openCloudStore(clients[1], 'read', { migrations: three })).rejects.toThrow('update DashQL to read');
    });

    it('lets readers read a cloud without the tables of DashQL and change nothing', async () => {
        const state = await openCloudStore(clients[0], 'read');
        expect(state).toMatchObject({ version: 0, columns: new Map() });
        expect(statements.every(sql => sql.startsWith('SELECT'))).toBe(true);
        await expect(connections[0].query(`SELECT count(*) FROM "dashql"."dashql"."cloud_store"`)).rejects.toThrow();
    });

    it('lets readers read the columns that exist instead of migrating or waiting', async () => {
        await installCloudStore(clients[0]);
        await connections[0].execute(`UPDATE "dashql"."dashql"."cloud_store" SET lock_owner = '7c9e6679-7425-40de-944b-e07fc1f90ae7', lock_expires_at = now() + INTERVAL '1 hour'`);
        statements = [];
        const state = await openCloudStore(clients[1], 'read', { migrations: [...CLOUD_MIGRATIONS, adding('a')], lockWaitMs: 0 });
        expect(state.version).toBe(CLOUD_MIGRATIONS.length);
        expect(state.columns.get('workbook_scripts')!.has('a')).toBe(false);
        expect(state.columns.get('workbook_scripts')!.has('text')).toBe(true);
        expect(statements.every(sql => sql.startsWith('SELECT'))).toBe(true);
    });

    it('derives the columns from the migrations that ran', () => {
        const migrations = [...CLOUD_MIGRATIONS, adding('a'), adding('b')];
        expect(cloudColumnsAfter(migrations, 0)).toEqual(new Map());
        expect(cloudColumnsAfter(migrations, KNOWN + 1).get('workbook_scripts')!.has('a')).toBe(true);
        expect(cloudColumnsAfter(migrations, KNOWN + 1).get('workbook_scripts')!.has('b')).toBe(false);
        expect(cloudColumnsAfter(migrations, KNOWN + 2).get('workbook_scripts')!.has('b')).toBe(true);
    });

    it('leaves creating and updating the tables to the installer', async () => {
        await expect(openCloudStore(clients[0], 'write')).rejects.toMatchObject({ name: 'CloudStoreSetupError', needs: 'install' });
        await installCloudStore(clients[0]);
        statements = [];
        const error = await openCloudStore(clients[0], 'write', { migrations: [...CLOUD_MIGRATIONS, adding('a')] }).catch(error => error);
        expect(error).toBeInstanceOf(CloudStoreSetupError);
        expect(error.needs).toBe('update');
        expect(statements.every(sql => sql.startsWith('SELECT'))).toBe(true);
        // A store row whose first migration never ran still needs the installer
        await connections[0].execute(`UPDATE "dashql"."dashql"."cloud_store" SET version = 0`);
        await expect(openCloudStore(clients[0], 'write')).rejects.toMatchObject({ needs: 'install' });
    });

    it('tells the installer what it finds and what it would run', async () => {
        expect(await inspectCloudStore(clients[0], { database: 'nowhere' })).toMatchObject({ state: 'unreachable', database: 'nowhere', pending: [] });
        const missing = await inspectCloudStore(clients[0]);
        expect(missing).toMatchObject({ state: 'missing', store: null, known: CLOUD_MIGRATIONS.length, canRead: true, canWrite: true, locked: false });
        expect(missing.pending.map(pending => pending.version)).toEqual(CLOUD_MIGRATIONS.map((_migration, index) => index + 1));
        expect(statements.every(sql => sql.startsWith('SELECT'))).toBe(true);

        await installCloudStore(clients[0]);
        expect(await inspectCloudStore(clients[0])).toMatchObject({ state: 'current', pending: [] });
        const migrations = [...CLOUD_MIGRATIONS, adding('a'), adding('b', 'writers')];
        const outdated = await inspectCloudStore(clients[0], { migrations });
        expect(outdated).toMatchObject({ state: 'outdated', store: { version: CLOUD_MIGRATIONS.length } });
        expect(outdated.pending.map(pending => [pending.version, pending.migration.description])).toEqual([[KNOWN + 1, 'Add a'], [KNOWN + 2, 'Add b']]);

        await connections[0].execute(`UPDATE "dashql"."dashql"."cloud_store" SET lock_owner = '7c9e6679-7425-40de-944b-e07fc1f90ae7', lock_expires_at = now() + INTERVAL '1 hour'`);
        expect(await inspectCloudStore(clients[0], { migrations })).toMatchObject({ state: 'outdated', locked: true });
        await connections[0].execute(`UPDATE "dashql"."dashql"."cloud_store" SET lock_owner = NULL, lock_expires_at = NULL`);

        await installCloudStore(clients[0], { migrations });
        expect(await inspectCloudStore(clients[1])).toMatchObject({ state: 'newer', canRead: true, canWrite: false });
    });

    it('reports the steps of the installer', async () => {
        const progress: CloudInstallProgress[] = [];
        await installCloudStore(clients[0], { onProgress: step => progress.push(step) });
        expect(progress).toEqual([
            { type: 'store' },
            ...CLOUD_MIGRATIONS.flatMap((_migration, index) => [{ type: 'migrating', version: index + 1 }, { type: 'migrated', version: index + 1 }]),
        ]);
        progress.length = 0;
        await installCloudStore(clients[0], { migrations: [...CLOUD_MIGRATIONS, adding('a')], onProgress: step => progress.push(step) });
        expect(progress).toEqual([{ type: 'migrating', version: KNOWN + 1 }, { type: 'migrated', version: KNOWN + 1 }]);
    });

    it('lets the installer of a client wait for the installer of another', async () => {
        await installCloudStore(clients[0]);
        await connections[0].execute(`UPDATE "dashql"."dashql"."cloud_store" SET lock_owner = '7c9e6679-7425-40de-944b-e07fc1f90ae7', lock_expires_at = now() + INTERVAL '1 hour'`);
        const progress: CloudInstallProgress[] = [];
        const waiting = installCloudStore(clients[1], { migrations: [...CLOUD_MIGRATIONS, adding('a')], lockPollMs: 10, onProgress: step => progress.push(step) });
        // The installer reads the store before it waits, on a loaded machine that takes longer than a few polls
        await vi.waitFor(() => expect(progress).toEqual([{ type: 'waiting' }]), { timeout: 10_000 });
        await connections[0].execute(`UPDATE "dashql"."dashql"."cloud_store" SET lock_owner = NULL, lock_expires_at = NULL`);
        expect((await waiting).version).toBe(KNOWN + 1);
        expect(progress).toEqual([{ type: 'waiting' }, { type: 'migrating', version: KNOWN + 1 }, { type: 'migrated', version: KNOWN + 1 }]);
    });
});
