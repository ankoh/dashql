import { describe, expect, it } from 'vitest';

import { MemoryFolder, OverlayFolder } from './migration_folder.js';
import { migrateWorkbookFolder, WORKBOOK_MIGRATION_STEPS, WorkbookMigrationResult, type WorkbookMigrationStep } from './workbook_migration.js';
import { WORKBOOK_FORMAT_VERSION } from './versions.js';
import { scriptsInSessionFile } from './workbook/v5_scripts_in_session_file.js';
import { sessionConnections } from './workbook/v6_session_connections.js';
import { connectionsOfScripts } from './workbook/v8_connections_of_scripts.js';
import { dbcomConnector } from './workbook/v10_dbcom_connector.js';
import { validateWorkbookData } from '../workbook_validation.js';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';

/// The last format version of the sessions, the next one calls them workbooks. The steps up to it are tested on the
/// sessions they were written for.
const LAST_SESSION_FORMAT_VERSION = 10;

/// A session folder as notebooks wrote it, before the catalog files had their prefix
function notebookFolder(): MemoryFolder {
    return new MemoryFolder([
        ['dashql-notebook.json', JSON.stringify({ formatVersion: 2, notebookId: SESSION_ID, notebookPath: 'opfs://notebooks/x', name: 'n' })],
        ['dashql-notebook-index.json', '{"scripts":[]}'],
        ['dashql-relations.sql', 'relations'],
        ['dashql-functions.sql', 'functions'],
    ]);
}

describe('session migration', () => {
    it('ends with the current format version', () => {
        expect(WORKBOOK_MIGRATION_STEPS.map(step => step.version))
            .toEqual(Array.from({ length: WORKBOOK_FORMAT_VERSION - 2 }, (_, i) => i + 3));
    });

    it('brings a notebook folder to the current format', async () => {
        const folder = notebookFolder();
        expect(await migrateWorkbookFolder(folder)).toBe(WorkbookMigrationResult.Migrated);
        // The catalog copies are gone, the catalog belongs to the connection
        expect([...folder.files.keys()]).toEqual(['dashql-workbook.json']);
        const metadata = JSON.parse(folder.files.get('dashql-workbook.json')!);
        expect(metadata).toEqual({
            formatVersion: WORKBOOK_FORMAT_VERSION, workbookId: SESSION_ID, workbookPath: 'opfs://notebooks/x', name: 'n',
            scripts: [], attachments: [], connections: [],
        });
        expect(Object.keys(metadata)).toEqual([
            'formatVersion', 'workbookId', 'workbookPath', 'name', 'scripts', 'attachments', 'connections',
        ]);

        // A migrated folder stays as it is
        const before = new Map(folder.files);
        expect(await migrateWorkbookFolder(folder)).toBe(WorkbookMigrationResult.Current);
        expect(folder.files).toEqual(before);
    });

    it('stops at a target version', async () => {
        const folder = notebookFolder();
        expect(await migrateWorkbookFolder(folder, 3)).toBe(WorkbookMigrationResult.Migrated);
        expect(JSON.parse(folder.files.get('dashql-notebook.json')!).formatVersion).toBe(3);
        expect(folder.files.has('dashql-catalog-relations.sql')).toBe(true);
        expect(folder.files.has('dashql-session.json')).toBe(false);
    });

    it.each([
        ['missing metadata', [], WorkbookMigrationResult.Missing],
        ['metadata without a version', [['dashql-session.json', '{}']], WorkbookMigrationResult.Unsupported],
        ['metadata of version 1', [['dashql-notebook.json', '{"formatVersion":1}']], WorkbookMigrationResult.Unsupported],
        ['invalid metadata', [['dashql-session.json', '{']], WorkbookMigrationResult.Unsupported],
        ['metadata of a newer version', [['dashql-session.json', `{"formatVersion":${WORKBOOK_FORMAT_VERSION + 1}}`]], WorkbookMigrationResult.Newer],
    ] as Array<[string, Array<[string, string]>, WorkbookMigrationResult]>)('leaves a folder with %s untouched', async (_label, files, result) => {
        const folder = new MemoryFolder([...files, ['dashql-relations.sql', 'relations']]);
        const before = new Map(folder.files);
        expect(await migrateWorkbookFolder(folder)).toBe(result);
        expect(folder.files).toEqual(before);
    });

    it('repeats an interrupted step', async () => {
        let attempts = 0;
        const steps: WorkbookMigrationStep[] = [
            { version: 3, description: 'first', migrate: async folder => { await folder.writeText('a', 'a'); } },
            {
                version: 4, description: 'second', migrate: async folder => {
                    if (++attempts === 1) throw new Error('interrupted');
                    await folder.writeText('b', 'b');
                },
            },
        ];
        const folder = new MemoryFolder([['dashql-session.json', '{"formatVersion":2}']]);
        await expect(migrateWorkbookFolder(folder, 4, steps)).rejects.toThrow('interrupted');
        expect(JSON.parse(folder.files.get('dashql-session.json')!).formatVersion).toBe(3);
        expect(await migrateWorkbookFolder(folder, 4, steps)).toBe(WorkbookMigrationResult.Migrated);
        expect(JSON.parse(folder.files.get('dashql-session.json')!).formatVersion).toBe(4);
        expect(folder.files.get('b')).toBe('b');
    });

    it('lists the main and the attached databases as connections in place of the main database', async () => {
        const main = { databaseId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', params: { hyper: {} } };
        const attached = { databaseId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', params: { trino: {} }, paramsDraft: { trino: { endpoint: 'x' } } };
        const folder = new MemoryFolder([
            ['dashql-session.json', JSON.stringify({ formatVersion: 4, sessionId: SESSION_ID, name: 'n', mainDatabase: main, attachedDatabases: [attached], metadata: {} })],
        ]);
        expect(await migrateWorkbookFolder(folder, LAST_SESSION_FORMAT_VERSION)).toBe(WorkbookMigrationResult.Migrated);
        const metadata = JSON.parse(folder.files.get('dashql-session.json')!);
        // A session without scripts keeps the main database, its first script runs on it
        expect(metadata).toEqual({
            formatVersion: LAST_SESSION_FORMAT_VERSION, sessionId: SESSION_ID, name: 'n',
            connections: [{ connectionId: main.databaseId, params: main.params }],
            metadata: {}, scripts: [], attachments: [],
        });
        expect(Object.keys(metadata)).toEqual([
            'formatVersion', 'sessionId', 'name', 'connections', 'metadata', 'scripts', 'attachments',
        ]);
    });

    it('turns the databases of a version 5 session into connections, the scripts follow them', async () => {
        const main = { databaseId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', params: { hyper: {} } };
        const attached = { databaseId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', params: { trino: {} } };
        const folder = new MemoryFolder([
            ['dashql-session.json', JSON.stringify({
                formatVersion: 5, sessionId: SESSION_ID, mainDatabase: main, attachedDatabases: [attached],
                scripts: [{ name: 'b.sql', databaseId: attached.databaseId }, { name: 'a.sql', databaseId: main.databaseId }],
                attachments: [], metadata: {},
            })],
        ]);
        expect(await migrateWorkbookFolder(folder, LAST_SESSION_FORMAT_VERSION)).toBe(WorkbookMigrationResult.Migrated);
        const metadata = JSON.parse(folder.files.get('dashql-session.json')!);
        expect(metadata).toEqual({
            formatVersion: LAST_SESSION_FORMAT_VERSION, sessionId: SESSION_ID,
            connections: [
                { connectionId: attached.databaseId, params: attached.params },
                { connectionId: main.databaseId, params: main.params },
            ],
            scripts: [{ name: 'b.sql', connectionId: attached.databaseId }, { name: 'a.sql', connectionId: main.databaseId }],
            attachments: [], metadata: {},
        });
        // Repeating the steps changes nothing
        const before = folder.files.get('dashql-session.json');
        await sessionConnections.migrate(folder);
        await connectionsOfScripts.migrate(folder);
        expect(folder.files.get('dashql-session.json')).toBe(before);
    });

    it('drops the default connection and the connections that no script uses', async () => {
        const wasm = { connectionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', params: { hyper: { protocol: 'WASM' } } };
        const trino = { connectionId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', params: { trino: {} } };
        const folder = new MemoryFolder([
            ['dashql-session.json', JSON.stringify({
                formatVersion: 7, sessionId: SESSION_ID, defaultConnectionId: wasm.connectionId, connections: [wasm, trino],
                scripts: [{ name: 'a.sql', connectionId: trino.connectionId }], attachments: [], metadata: {},
            })],
        ]);
        expect(await migrateWorkbookFolder(folder, LAST_SESSION_FORMAT_VERSION)).toBe(WorkbookMigrationResult.Migrated);
        expect(JSON.parse(folder.files.get('dashql-session.json')!)).toEqual({
            formatVersion: LAST_SESSION_FORMAT_VERSION, sessionId: SESSION_ID, connections: [trino],
            scripts: [{ name: 'a.sql', connectionId: trino.connectionId }], attachments: [], metadata: {},
        });
    });

    it('moves the params of SIDB connections to the key dbcom', async () => {
        const params = { instanceUrl: 'https://example.my.salesforce.com', databaseName: 'sales' };
        const trino = { connectionId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', params: { trino: { endpoint: 'http://localhost:8080' } } };
        const folder = new MemoryFolder([
            ['dashql-session.json', JSON.stringify({
                formatVersion: 9, sessionId: SESSION_ID, scripts: [], attachments: [], metadata: {},
                connections: [
                    { connectionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', params: { sidb: params }, paramsDraft: { sidb: { ...params, databaseName: 'draft' } } },
                    trino,
                ],
            })],
        ]);
        expect(await migrateWorkbookFolder(folder, LAST_SESSION_FORMAT_VERSION)).toBe(WorkbookMigrationResult.Migrated);
        const metadata = JSON.parse(folder.files.get('dashql-session.json')!);
        expect(metadata.formatVersion).toBe(LAST_SESSION_FORMAT_VERSION);
        expect(metadata.connections).toEqual([
            { connectionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', params: { dbcom: params }, paramsDraft: { dbcom: { ...params, databaseName: 'draft' } } },
            trino,
        ]);
        // The connections are valid ones of a workbook
        const { sessionId, ...rest } = metadata;
        expect(validateWorkbookData({ ...rest, formatVersion: WORKBOOK_FORMAT_VERSION, workbookId: sessionId })).toEqual({ ok: true });

        // Repeating the step after an interruption changes nothing
        await dbcomConnector.migrate(folder);
        expect(JSON.parse(folder.files.get('dashql-session.json')!).connections).toEqual(metadata.connections);
    });

    it('moves the index into the session metadata with the default connection', async () => {
        const connectionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const folder = new MemoryFolder([
            ['dashql-session.json', JSON.stringify({ formatVersion: 4, sessionId: SESSION_ID, mainDatabase: { databaseId: connectionId } })],
            ['dashql-session-index.json', JSON.stringify({ scripts: [{ name: '10_b.sql' }, { name: '2_a.sql' }], data: [{ name: 'x.csv' }] })],
        ]);
        expect(await migrateWorkbookFolder(folder, LAST_SESSION_FORMAT_VERSION)).toBe(WorkbookMigrationResult.Migrated);
        expect(folder.files.has('dashql-session-index.json')).toBe(false);
        const metadata = JSON.parse(folder.files.get('dashql-session.json')!);
        expect(metadata.formatVersion).toBe(LAST_SESSION_FORMAT_VERSION);
        expect(metadata.scripts).toEqual([{ name: '10_b.sql', connectionId }, { name: '2_a.sql', connectionId }]);
        expect(metadata.attachments).toEqual([{ name: 'x.csv' }]);

        // Repeating the step after an interruption keeps the moved list and only removes the index
        folder.files.set('dashql-session-index.json', '{"scripts":[]}');
        await scriptsInSessionFile.migrate(folder);
        expect(folder.files.has('dashql-session-index.json')).toBe(false);
        expect(JSON.parse(folder.files.get('dashql-session.json')!).scripts).toEqual(metadata.scripts);
    });

    it.each([
        ['without an index', null],
        ['with a broken index', '{'],
    ])('lists no scripts of a folder %s', async (_label, index) => {
        const folder = new MemoryFolder([
            ['dashql-session.json', JSON.stringify({ formatVersion: 4, sessionId: SESSION_ID, mainDatabase: { databaseId: 'x' } })],
            ...(index == null ? [] : [['dashql-session-index.json', index] as [string, string]]),
        ]);
        expect(await migrateWorkbookFolder(folder, LAST_SESSION_FORMAT_VERSION)).toBe(WorkbookMigrationResult.Migrated);
        expect(folder.files.has('dashql-session-index.json')).toBe(false);
        expect(JSON.parse(folder.files.get('dashql-session.json')!)).toMatchObject({ scripts: [], attachments: [] });
    });

    it('migrates an overlay without touching its base', async () => {
        const base = notebookFolder();
        const before = new Map(base.files);
        const overlay = new OverlayFolder(base);
        expect(await migrateWorkbookFolder(overlay, LAST_SESSION_FORMAT_VERSION)).toBe(WorkbookMigrationResult.Migrated);
        expect(base.files).toEqual(before);
        expect(await overlay.exists('dashql-notebook.json')).toBe(false);
        expect(JSON.parse((await overlay.readText('dashql-session.json'))!).sessionId).toBe(SESSION_ID);
        expect(await overlay.readText('dashql-catalog-functions.sql')).toBeNull();
    });

    it('removes the catalog copies of a version 6 session', async () => {
        const folder = new MemoryFolder([
            ['dashql-session.json', JSON.stringify({ formatVersion: 6, sessionId: SESSION_ID, defaultConnectionId: 'x', connections: [] })],
            ['dashql-catalog-relations.sql', 'relations'],
            ['dashql-catalog-functions.sql', 'functions'],
            ['dashql-catalog-changes.sql', 'changes'],
        ]);
        expect(await migrateWorkbookFolder(folder, 7)).toBe(WorkbookMigrationResult.Migrated);
        expect([...folder.files.keys()]).toEqual(['dashql-session.json']);
        expect(JSON.parse(folder.files.get('dashql-session.json')!).formatVersion).toBe(7);
    });

    it('removes the settings of a version 8 session, connections decide about caching', async () => {
        const session = { sessionId: SESSION_ID, connections: [], scripts: [{ name: 'a.sql', connectionId: 'x' }], attachments: [], metadata: {} };
        const folder = new MemoryFolder([
            ['dashql-session.json', JSON.stringify({ formatVersion: 8, ...session, settings: { cacheQueryResults: true } })],
        ]);
        expect(await migrateWorkbookFolder(folder, LAST_SESSION_FORMAT_VERSION)).toBe(WorkbookMigrationResult.Migrated);
        expect(JSON.parse(folder.files.get('dashql-session.json')!)).toEqual({ formatVersion: LAST_SESSION_FORMAT_VERSION, ...session });
    });

    it('renames a session as workbook', async () => {
        const session = { connections: [{ connectionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', params: { hyper: {} } }], scripts: [], attachments: [], metadata: {}, name: 'n' };
        const folder = new MemoryFolder([
            ['dashql-session.json', JSON.stringify({ formatVersion: 10, sessionId: SESSION_ID, sessionPath: 'opfs://sessions/x', ...session })],
            ['dashql-catalog-relations.sql', 'relations'],
        ]);
        expect(await migrateWorkbookFolder(folder)).toBe(WorkbookMigrationResult.Migrated);
        expect([...folder.files.keys()].sort()).toEqual(['dashql-catalog-relations.sql', 'dashql-workbook.json']);
        expect(JSON.parse(folder.files.get('dashql-workbook.json')!)).toEqual({
            formatVersion: WORKBOOK_FORMAT_VERSION, workbookId: SESSION_ID, workbookPath: 'opfs://sessions/x', ...session,
        });
        expect(validateWorkbookData(JSON.parse(folder.files.get('dashql-workbook.json')!)).ok).toBe(true);
    });
});
