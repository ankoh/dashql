import * as core from '@ankoh/dashql';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TestLogger } from '@ankoh/dashql/platform/testing/test_logger';
import { OPFSDirectoryMock } from '../../tests/opfs_mock.js';
import { fsStore, makeFsMock, resetFsStore } from '@ankoh/dashql/platform/testing/test_fs_mock';
import { migrateStorage as migrateStorageWithCore } from './storage_migration.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

const SESSION_A = '11111111-0000-4000-8000-00000000000a';
const SESSION_B = '11111111-0000-4000-8000-00000000000b';
const DB_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const DB_B = 'aaaaaaaa-0000-4000-8000-00000000000b';
const WASM = { hyper: { protocol: 'WASM' } };
const NATIVE_DIR = '/home/user/session';

/// The metadata of a notebook of format version 2
function notebook(notebookId: string, databaseId: string): string {
    return JSON.stringify({
        formatVersion: 2,
        notebookId,
        mainDatabase: { databaseId, params: WASM },
        attachedDatabases: [],
        metadata: {},
    });
}

// The steps are tested in the core (`storage_migration_test.rs`), these tests run them in the core over the storage
// root and the native folders of the app
describe('storage migration', () => {
    let dql: core.DashQL;
    // The versions of the core
    let STORAGE_VERSION = 0;
    let WORKBOOK_FORMAT_VERSION = 0;
    beforeAll(async () => {
        dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
        ({ storageVersion: STORAGE_VERSION, formatVersion: WORKBOOK_FORMAT_VERSION } = dql.storageVersions());
    });
    const migrateStorage = (logger: TestLogger, root: FileSystemDirectoryHandle) => migrateStorageWithCore(logger, async () => dql, root)
        .then(({ steps, workbooks }) => ({ steps, workbooks }));

    let files: Map<string, string | ArrayBuffer>;
    let dirs: Set<string>;
    let root: FileSystemDirectoryHandle;
    let claims: string[];
    const text = (path: string) => {
        const value = files.get(path);
        return typeof value === 'string' || value === undefined ? value : new TextDecoder().decode(value);
    };
    const json = (path: string) => JSON.parse(text(path)!);

    beforeEach(() => {
        files = new Map();
        dirs = new Set();
        root = new OPFSDirectoryMock('', files, dirs) as unknown as FileSystemDirectoryHandle;
        resetFsStore();
        claims = [];
        globalThis.dashqlElectron = {
            fs: makeFsMock(),
            claimWorkbookFolder: async (path: string) => { claims.push(path); return true; },
        } as unknown as DashQLElectronBridge;
    });

    afterEach(() => {
        delete globalThis.dashqlElectron;
    });

    it('migrates to the versions of the app', async () => {
        const outcome = await migrateStorageWithCore(new TestLogger(), async () => dql, root);
        expect(outcome).toEqual({ steps: 0, workbooks: 0, storageVersion: STORAGE_VERSION, formatVersion: WORKBOOK_FORMAT_VERSION });
    });

    it('stamps a fresh storage with the current version', async () => {
        expect(await migrateStorage(new TestLogger(), root)).toEqual({ steps: 0, workbooks: 0 });
        expect([...files.keys()]).toEqual(['dashql-manifest.json']);
        expect(json('dashql-manifest.json')).toEqual({ storageVersion: STORAGE_VERSION });
        expect(dirs.size).toBe(0);
    });

    it('brings a notebook storage to the current version', async () => {
        files.set('dashql-manifest.json', JSON.stringify({
            notebooks: [{ path: SESSION_A }, { path: SESSION_B, storageType: 'native', nativePath: NATIVE_DIR }],
            appSettings: { keywordCase: 'upper' },
        }));
        dirs.add('notebooks');
        dirs.add(`notebooks/${SESSION_A}`);
        dirs.add(`notebooks/${SESSION_A}/scripts`);
        files.set(`notebooks/${SESSION_A}/dashql-notebook.json`, notebook(SESSION_A, DB_A));
        files.set(`notebooks/${SESSION_A}/dashql-relations.sql`, 'CREATE TABLE a(id int);');
        files.set(`notebooks/${SESSION_A}/scripts/1_a.sql`, 'SELECT 1');
        fsStore.dirs.add(NATIVE_DIR);
        fsStore.files.set(`${NATIVE_DIR}/dashql-notebook.json`, notebook(SESSION_B, DB_B));

        const summary = await migrateStorage(new TestLogger(), root);
        expect(summary.steps).toBe(STORAGE_VERSION - 1);
        expect(summary.workbooks).toBeGreaterThan(0);
        // The native session folder is claimed before it is read
        expect(new Set(claims)).toEqual(new Set([NATIVE_DIR]));

        // The session tree lists the sessions and the manifest the consolidated connections
        expect(json('workbooktree/My Sessions/dashql-folder.json').workbooks).toEqual([{ path: SESSION_A }, { path: SESSION_B, storageType: 'native', nativePath: NATIVE_DIR }]);
        expect(json('workbooktree/dashql-folder.json').workbooks).toEqual([]);
        const manifest = json('dashql-manifest.json');
        expect(manifest.sessions).toBeUndefined();
        expect(manifest.notebooks).toBeUndefined();
        expect(manifest.appSettings).toEqual({ keywordCase: 'upper' });
        expect(manifest.storageVersion).toBe(STORAGE_VERSION);
        expect(manifest.connections.map((entry: { id: string }) => entry.id)).toEqual([DB_A]);
        expect(text(`connections/${DB_A}/dashql-catalog-relations.sql`)).toBe('CREATE TABLE a(id int);');

        // The OPFS session moved and is at the current format
        expect([...dirs].filter(dir => dir.startsWith('notebooks'))).toEqual([]);
        expect([...files.keys()].filter(file => file.startsWith('notebooks'))).toEqual([]);
        const sessionA = json(`workbooks/${SESSION_A}/dashql-workbook.json`);
        expect(sessionA.formatVersion).toBe(WORKBOOK_FORMAT_VERSION);
        expect(sessionA.workbookId).toBe(SESSION_A);
        expect(text(`workbooks/${SESSION_A}/dashql-catalog-relations.sql`)).toBeUndefined();
        expect(text(`workbooks/${SESSION_A}/scripts/1_a.sql`)).toBe('SELECT 1');
        expect([...dirs].filter(dir => dir.startsWith('sessions') || dir.startsWith('sessiontree'))).toEqual([]);

        // The native session references the consolidated connection
        expect(fsStore.files.has(`${NATIVE_DIR}/dashql-notebook.json`)).toBe(false);
        const sessionB = JSON.parse(fsStore.files.get(`${NATIVE_DIR}/dashql-workbook.json`)!);
        expect(sessionB.formatVersion).toBe(WORKBOOK_FORMAT_VERSION);
        expect(sessionB.workbookId).toBe(SESSION_B);
        expect(sessionB.connections.map((connection: { connectionId: string }) => connection.connectionId)).toEqual([DB_A]);

        // A migrated storage stays as it is
        const before = text('dashql-manifest.json');
        const beforeTree = text('workbooktree/My Sessions/dashql-folder.json');
        await migrateStorage(new TestLogger(), root);
        expect(text('dashql-manifest.json')).toBe(before);
        expect(text('workbooktree/My Sessions/dashql-folder.json')).toBe(beforeTree);
    });

    it('keeps the connections of a storage that has them already', async () => {
        const connections = [{ id: DB_B, params: WASM, createdAt: '2026-10-22T00:00:00.000Z' }];
        files.set('dashql-manifest.json', JSON.stringify({ notebooks: [{ path: SESSION_A }], connections }));
        dirs.add('notebooks');
        dirs.add(`notebooks/${SESSION_A}`);
        files.set(`notebooks/${SESSION_A}/dashql-notebook.json`, notebook(SESSION_A, DB_B));

        await migrateStorage(new TestLogger(), root);
        expect(json('dashql-manifest.json').connections).toEqual(connections);
        expect(json(`workbooks/${SESSION_A}/dashql-workbook.json`).workbookId).toBe(SESSION_A);
    });

    it('migrates the workbooks of a current storage', async () => {
        files.set('dashql-manifest.json', JSON.stringify({ connections: [], storageVersion: STORAGE_VERSION }));
        dirs.add('workbooktree');
        dirs.add('workbooktree/clients');
        files.set('workbooktree/clients/dashql-folder.json', JSON.stringify({ workbooks: [{ path: SESSION_A }] }));
        dirs.add('workbooks');
        dirs.add(`workbooks/${SESSION_A}`);
        files.set(`workbooks/${SESSION_A}/dashql-notebook.json`, notebook(SESSION_A, DB_A));

        expect(await migrateStorage(new TestLogger(), root)).toEqual({ steps: 0, workbooks: 1 });
        expect(json(`workbooks/${SESSION_A}/dashql-workbook.json`).formatVersion).toBe(WORKBOOK_FORMAT_VERSION);
        // A current storage has nothing left to migrate
        expect(await migrateStorage(new TestLogger(), root)).toEqual({ steps: 0, workbooks: 0 });
    });

    it('moves the sessions of the manifest into the folder My Sessions of the session tree', async () => {
        files.set('dashql-manifest.json', JSON.stringify({
            sessions: [{ path: SESSION_A, storageType: 'opfs' }, { path: SESSION_B, storageType: 'native', nativePath: NATIVE_DIR }],
            connections: [],
            appSettings: { keywordCase: 'upper' },
            storageVersion: 6,
        }));
        // An interrupted run registered a session in a folder already
        dirs.add('sessiontree');
        dirs.add('sessiontree/clients');
        files.set('sessiontree/clients/dashql-folder.json', JSON.stringify({ sessions: [{ path: SESSION_B, storageType: 'native', nativePath: NATIVE_DIR }] }));

        expect((await migrateStorage(new TestLogger(), root)).steps).toBe(STORAGE_VERSION - 6);
        expect(json('workbooktree/My Sessions/dashql-folder.json')).toEqual({ workbooks: [{ path: SESSION_A, storageType: 'opfs' }] });
        expect(json('workbooktree/clients/dashql-folder.json').workbooks).toEqual([{ path: SESSION_B, storageType: 'native', nativePath: NATIVE_DIR }]);
        expect(json('workbooktree/dashql-folder.json')).toEqual({ workbooks: [] });
        expect(json('dashql-manifest.json')).toEqual({ connections: [], appSettings: { keywordCase: 'upper' }, storageVersion: STORAGE_VERSION });
    });

    it('seeds connections without a catalog from the catalog copies of the sessions', async () => {
        /// A session of format version 6 on a connection
        const session = (sessionId: string, connectionId: string) => JSON.stringify({
            formatVersion: 6, sessionId, defaultConnectionId: connectionId,
            connections: [{ connectionId, params: WASM }], scripts: [], attachments: [], metadata: {},
        });
        files.set('dashql-manifest.json', JSON.stringify({
            sessions: [{ path: SESSION_A }, { path: SESSION_B, storageType: 'native', nativePath: NATIVE_DIR }],
            connections: [{ id: DB_A, params: WASM }, { id: DB_B, params: WASM }],
            storageVersion: 3,
        }));
        // The connection of the OPFS session has no catalog
        dirs.add('sessions');
        dirs.add(`sessions/${SESSION_A}`);
        files.set(`sessions/${SESSION_A}/dashql-session.json`, session(SESSION_A, DB_A));
        files.set(`sessions/${SESSION_A}/dashql-catalog-relations.sql`, 'CREATE TABLE a(id int);');
        files.set(`sessions/${SESSION_A}/dashql-catalog-changes.sql`, 'DROP TABLE a;');
        // The connection of the native session has a catalog already
        dirs.add('connections');
        dirs.add(`connections/${DB_B}`);
        files.set(`connections/${DB_B}/dashql-catalog-functions.sql`, 'CREATE FUNCTION kept() RETURNS int;');
        fsStore.dirs.add(NATIVE_DIR);
        fsStore.files.set(`${NATIVE_DIR}/dashql-session.json`, session(SESSION_B, DB_B));
        fsStore.files.set(`${NATIVE_DIR}/dashql-catalog-relations.sql`, 'CREATE TABLE b(id int);');

        await migrateStorage(new TestLogger(), root);

        expect(json('dashql-manifest.json').storageVersion).toBe(STORAGE_VERSION);
        expect(text(`connections/${DB_A}/dashql-catalog-relations.sql`)).toBe('CREATE TABLE a(id int);');
        expect(text(`connections/${DB_A}/dashql-catalog-changes.sql`)).toBe('DROP TABLE a;');
        expect(text(`connections/${DB_B}/dashql-catalog-relations.sql`)).toBeUndefined();
        expect(text(`connections/${DB_B}/dashql-catalog-functions.sql`)).toBe('CREATE FUNCTION kept() RETURNS int;');
        // The copies are removed from every session
        expect([...files.keys()].filter(file => file.startsWith('workbooks/'))).toEqual([`workbooks/${SESSION_A}/dashql-workbook.json`]);
        expect([...fsStore.files.keys()].filter(file => file.startsWith(NATIVE_DIR))).toEqual([`${NATIVE_DIR}/dashql-workbook.json`]);
        expect(json(`workbooks/${SESSION_A}/dashql-workbook.json`).formatVersion).toBe(WORKBOOK_FORMAT_VERSION);
    });

    it('drops the aliases of the connections', async () => {
        const createdAt = '2026-10-22T00:00:00.000Z';
        files.set('dashql-manifest.json', JSON.stringify({
            sessions: [],
            connections: [{ id: DB_A, params: WASM, aliases: [DB_B], createdAt }, { id: DB_B, params: WASM }],
            storageVersion: 5,
        }));

        await migrateStorage(new TestLogger(), root);

        const manifest = json('dashql-manifest.json');
        expect(manifest.storageVersion).toBe(STORAGE_VERSION);
        expect(manifest.connections).toEqual([{ id: DB_A, params: WASM, createdAt }, { id: DB_B, params: WASM }]);
    });

    it('moves the params of SIDB connections to the key dbcom', async () => {
        const params = { instanceUrl: 'https://example.my.salesforce.com', databaseName: 'sales' };
        files.set('dashql-manifest.json', JSON.stringify({
            connections: [{ id: DB_A, params: { sidb: params }, paramsDraft: { sidb: params } }, { id: DB_B, params: WASM }],
            storageVersion: 7,
        }));

        await migrateStorage(new TestLogger(), root);

        const manifest = json('dashql-manifest.json');
        expect(manifest.storageVersion).toBe(STORAGE_VERSION);
        expect(manifest.connections).toEqual([
            { id: DB_A, params: { dbcom: params }, paramsDraft: { dbcom: params } },
            { id: DB_B, params: WASM },
        ]);
    });

    it('moves the files of the shell to the shell folder', async () => {
        files.set('dashql-manifest.json', JSON.stringify({ sessions: [], connections: [], storageVersion: 4 }));
        dirs.add('dashql-shell');
        dirs.add('dashql-shell/nested');
        files.set('dashql-shell/salesforce-login-history.json', '{"version":1,"entries":[]}');
        files.set('dashql-shell/nested/notes.txt', 'nested');
        // A file that the shell folder has already is kept
        dirs.add('shell');
        files.set('shell/kept.txt', 'kept');

        await migrateStorage(new TestLogger(), root);

        expect(json('dashql-manifest.json').storageVersion).toBe(STORAGE_VERSION);
        expect(text('shell/salesforce-login-history.json')).toBe('{"version":1,"entries":[]}');
        expect(text('shell/nested/notes.txt')).toBe('nested');
        expect(text('shell/kept.txt')).toBe('kept');
        expect([...files.keys()].filter(file => file.startsWith('dashql-shell'))).toEqual([]);
        expect([...dirs].filter(dir => dir.startsWith('dashql-shell'))).toEqual([]);
    });

    it('refuses a storage of a newer version', async () => {
        const manifest = JSON.stringify({ sessions: [], storageVersion: STORAGE_VERSION + 1 });
        files.set('dashql-manifest.json', manifest);
        await expect(migrateStorage(new TestLogger(), root)).rejects.toThrow('newer version of DashQL');
        expect(text('dashql-manifest.json')).toBe(manifest);
    });

    it('renames the sessions as workbooks', async () => {
        files.set('dashql-manifest.json', JSON.stringify({ connections: [], appSettings: { agentSessions: [SESSION_A], keywordCase: 'upper' }, storageVersion: 8 }));
        dirs.add('sessiontree');
        dirs.add('sessiontree/clients');
        files.set('sessiontree/dashql-folder.json', JSON.stringify({ sessions: [] }));
        files.set('sessiontree/clients/dashql-folder.json', JSON.stringify({ sessions: [{ path: SESSION_A }] }));
        dirs.add('sessions');
        dirs.add(`sessions/${SESSION_A}`);
        dirs.add(`sessions/${SESSION_A}/scripts`);
        files.set(`sessions/${SESSION_A}/dashql-session.json`, JSON.stringify({
            formatVersion: 10, sessionId: SESSION_A, connections: [{ connectionId: DB_A, params: WASM }], scripts: [], attachments: [], metadata: {},
        }));
        files.set(`sessions/${SESSION_A}/scripts/1_a.sql`, 'SELECT 1');

        expect(await migrateStorage(new TestLogger(), root)).toEqual({ steps: 1, workbooks: 1 });

        expect([...dirs].filter(dir => dir.startsWith('sessions') || dir.startsWith('sessiontree'))).toEqual([]);
        expect(json('workbooktree/dashql-folder.json')).toEqual({ workbooks: [] });
        expect(json('workbooktree/clients/dashql-folder.json')).toEqual({ workbooks: [{ path: SESSION_A }] });
        expect(json(`workbooks/${SESSION_A}/dashql-workbook.json`)).toMatchObject({ formatVersion: WORKBOOK_FORMAT_VERSION, workbookId: SESSION_A });
        expect(text(`workbooks/${SESSION_A}/dashql-session.json`)).toBeUndefined();
        expect(text(`workbooks/${SESSION_A}/scripts/1_a.sql`)).toBe('SELECT 1');
        expect(json('dashql-manifest.json').appSettings).toEqual({ keywordCase: 'upper', agentWorkbooks: [SESSION_A] });
    });
});
