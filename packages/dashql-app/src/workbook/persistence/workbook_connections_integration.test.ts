import * as core from '@ankoh/dashql';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TestLogger } from '@ankoh/dashql/platform/testing/test_logger';
import { ConnectorType } from '@ankoh/dashql/platform/connections/connector_info';
import { CompositeStorageBackend } from '../../storage/composite_storage_backend.js';
import { WorkbookTestBackend, WorkbookTestRegistry } from '@ankoh/dashql/platform/testing/workbook_test_backend';
import type { ConnectionEntry, WorkbookData } from '@ankoh/dashql/platform/storage/storage_backend';
import { makeFsMock, resetFsStore } from '@ankoh/dashql/platform/testing/test_fs_mock';
import { storageVersions } from '@ankoh/dashql/platform/storage/storage_versions';
import { workbookConnectionIds, type ScriptData, type WorkbookScripts } from '@ankoh/dashql/platform/workbook/scripts/workbook_scripts';
import { createTestHyperDB } from '../../tests/hyperdb_test_client.js';
import type { HyperDB } from '../../platform/hyperdb/hyperdb_wasm.js';
import type { Runtime } from '@ankoh/dashql/runtime/runtime';
import type { StorageBackend } from '@ankoh/dashql/platform/storage/storage_backend';
import { createTestRuntime } from '@ankoh/dashql/runtime/testing/test_runtime';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

/// Integration tests for the connections of a workbook.
///
/// A script names its connection in the workbook file, the app resolves it to a connection of the
/// registry and analyzes the script in the catalog of that connection. These tests drive the real
/// core, the storage writer and the loader through the round trips that touch that mapping:
/// restoring, changing the connection of a script, reloading, exporting and importing. Every restore starts a new
/// runtime on the storage.

/// A storage backend that owns a workbook registry, the backend of the composite storage
class Registry extends WorkbookTestRegistry {}

const WORKBOOK_ID = '11111111-2222-4333-8444-555555555555';
const IMPORTED_WORKBOOK_ID = '22222222-3333-4444-8555-666666666666';
/// The embedded database of the workbook
const HYPER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const HYPER_PARAMS = { hyper: {} } as WorkbookData['connections'][number]['params'];
/// A second connection of the workbook
const TRINO_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const TRINO_PARAMS = { trino: { endpoint: 'https://trino.example' } } as WorkbookData['connections'][number]['params'];

/// A script of a seeded workbook: file name, connection id and text
type SeedScript = [string, string, string];

/// Store a workbook with both connections in the manifest
async function seedWorkbook(backend: WorkbookTestBackend, scripts: SeedScript[], connectionIds: string[] = [HYPER_ID, TRINO_ID]): Promise<void> {
    const params = new Map([[HYPER_ID, HYPER_PARAMS], [TRINO_ID, TRINO_PARAMS]]);
    backend.connections = [HYPER_ID, TRINO_ID].map(id => ({ id, params: params.get(id)! } as ConnectionEntry));
    await backend.saveWorkbookManifest(WORKBOOK_ID, {
        formatVersion: storageVersions().formatVersion as WorkbookData['formatVersion'],
        workbookId: WORKBOOK_ID,
        name: 'Connections',
        connections: connectionIds.map(connectionId => ({ connectionId, params: params.get(connectionId)! })),
        scripts: scripts.map(([name, connectionId]) => ({ name, connectionId })),
        attachments: [],
        metadata: {},
    });
    for (const [name, , sql] of scripts) {
        await backend.saveScript(WORKBOOK_ID, name, sql);
    }
}

describe('Workbook connections', () => {
    let dql: core.DashQL;

    beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });
    afterEach(() => { dql.resetUnsafe(); });

    /// A runtime that restored the storage, every restoration starts a new app
    interface RestoredApp {
        runtime: Runtime;
    }
    const restore = async (backend: StorageBackend): Promise<RestoredApp> => {
        const testRuntime = await createTestRuntime({ storage: backend });
        await testRuntime.restore();
        return { runtime: testRuntime };
    };

    /// The restored workbook
    const workbookOf = (restored: RestoredApp, workbookId: string = WORKBOOK_ID): WorkbookScripts => {
        const workbook = restored.runtime.store.get('workbook', workbookId);
        if (workbook == null) throw new Error(`Workbook ${workbookId} was not restored`);
        return workbook;
    };
    const scriptOf = (restored: RestoredApp, fileName: string, workbookId: string = WORKBOOK_ID): ScriptData =>
        restored.runtime.store.get('script', workbookOf(restored, workbookId).scriptRefs[fileName].scriptId)!;

    /// Analyze every script like a workbook run does, the workbook publishes it into the catalog of its connection, and
    /// return the number of table references of a script that its catalog does not resolve
    const unresolvedReferences = (restored: RestoredApp, fileName: string): number => {
        for (const name of workbookOf(restored).scriptOrder) {
            const scriptKey = scriptOf(restored, name).scriptKey;
            restored.runtime.dispatch({ workbook: WORKBOOK_ID }, { kind: 'analyzeOutdatedScript', value: { scriptKey } });
        }
        restored.runtime.flush();
        const script = scriptOf(restored, fileName);
        script.scriptSession.analyze();
        return dql.planSession({
            connections: [{ id: script.connectionId, local: false, catalog: restored.runtime.catalog(script.connectionId)! }],
            scripts: [{ name: '', connection: 0, session: script.scriptSession }],
        }).unpack().unresolvedReferences.length;
    };

    /// Run a script on another connection the way the connection picker of the feed does
    const pickConnection = (restored: RestoredApp, fileName: string, connectionId: string): void => {
        restored.runtime.dispatch({ workbook: WORKBOOK_ID }, { kind: 'setScriptConnection', value: { fileName, connectionId } });
        restored.runtime.flush();
    };

    /// The workbooks that use a connection
    const workbooksOf = (restored: RestoredApp, connectionId: string): string[] => restored.runtime.connection(connectionId)?.workbooks ?? [];

    describe('restoring', () => {
        it('analyzes every script in the catalog of its own connection', async () => {
            const backend = new WorkbookTestBackend();
            await seedWorkbook(backend, [
                ['define.sql', HYPER_ID, 'create table items (id int)'],
                ['remote.sql', TRINO_ID, 'select id from items'],
                ['local.sql', HYPER_ID, 'select id from items'],
            ]);
            const restored = await restore(backend);
            const workbook = workbookOf(restored);

            expect(workbook.scriptOrder).toEqual(['define.sql', 'remote.sql', 'local.sql']);
            expect(scriptOf(restored, 'remote.sql').connectionId).toBe(TRINO_ID);
            expect(scriptOf(restored, 'local.sql').connectionId).toBe(HYPER_ID);
            // Only the scripts of the same connection see the table
            expect(unresolvedReferences(restored, 'local.sql')).toBe(0);
            expect(unresolvedReferences(restored, 'remote.sql')).toBe(1);
            expect(workbooksOf(restored, TRINO_ID)).toEqual([WORKBOOK_ID]);
        });

        it('attaches a known connection that a script uses but the workbook file misses', async () => {
            const backend = new WorkbookTestBackend();
            await seedWorkbook(backend, [['remote.sql', TRINO_ID, 'select 1']], [HYPER_ID]);
            const restored = await restore(backend);

            expect(scriptOf(restored, 'remote.sql').connectionId).toBe(TRINO_ID);
            // The connection that no script uses is left out
            expect(backend.workbooks.get(WORKBOOK_ID)!.connections.map(connection => connection.connectionId)).toEqual([TRINO_ID]);
        });

        it('registers a connection that only the workbook file knows', async () => {
            const backend = new WorkbookTestBackend();
            await seedWorkbook(backend, [['remote.sql', TRINO_ID, 'select 1']]);
            backend.connections = backend.connections!.filter(entry => entry.id !== TRINO_ID);
            const restored = await restore(backend);

            expect(scriptOf(restored, 'remote.sql').connectionId).toBe(TRINO_ID);
            expect(restored.runtime.connection(TRINO_ID)?.connectorType).toBe(ConnectorType.TRINO);
            expect(backend.connections!.map(entry => entry.id)).toEqual([HYPER_ID, TRINO_ID]);
        });

        it('drops the copies of connections that no script uses', async () => {
            const backend = new WorkbookTestBackend();
            await seedWorkbook(backend, [['query.sql', HYPER_ID, 'select 1']]);
            const restored = await restore(backend);

            expect(workbookConnectionIds(workbookOf(restored))).toEqual([HYPER_ID]);
            expect(backend.workbooks.get(WORKBOOK_ID)!.connections.map(connection => connection.connectionId)).toEqual([HYPER_ID]);
            // The connection itself stays a connection of the app
            expect(restored.runtime.connection(TRINO_ID)).not.toBeNull();
        });
    });

    describe('changing the connection of a script', () => {
        it('moves the script between catalogs and keeps it there across a reload', async () => {
            const backend = new WorkbookTestBackend();
            await seedWorkbook(backend, [
                ['define.sql', HYPER_ID, 'create table items (id int)'],
                ['query.sql', TRINO_ID, 'select id from items'],
            ], [HYPER_ID]);
            // The workbook file misses the trino connection, the loader attaches it
            let restored = await restore(backend);
            expect(unresolvedReferences(restored, 'query.sql')).toBe(1);

            const moved = scriptOf(restored, 'query.sql').scriptKey;
            pickConnection(restored, 'query.sql', HYPER_ID);
            // The script keeps its key and now resolves the table of its new catalog
            expect(scriptOf(restored, 'query.sql').scriptKey).toBe(moved);
            expect(scriptOf(restored, 'query.sql').connectionId).toBe(HYPER_ID);
            expect(unresolvedReferences(restored, 'query.sql')).toBe(0);
            await restored.runtime.storage.flush();
            expect(backend.workbooks.get(WORKBOOK_ID)!.scripts).toEqual([
                { name: 'define.sql', connectionId: HYPER_ID },
                { name: 'query.sql', connectionId: HYPER_ID },
            ]);

            restored = await restore(backend);
            expect(scriptOf(restored, 'query.sql').connectionId).toBe(HYPER_ID);
            expect(unresolvedReferences(restored, 'query.sql')).toBe(0);
        });

        it('takes the declarations of a moved script out of the catalog it leaves', async () => {
            const backend = new WorkbookTestBackend();
            await seedWorkbook(backend, [
                ['define.sql', HYPER_ID, 'create table items (id int)'],
                ['local.sql', HYPER_ID, 'select id from items'],
                ['remote.sql', TRINO_ID, 'select id from items'],
            ]);
            const restored = await restore(backend);
            for (const name of workbookOf(restored).scriptOrder) {
                restored.runtime.dispatch({ workbook: WORKBOOK_ID }, { kind: 'analyzeOutdatedScript', value: { scriptKey: scriptOf(restored, name).scriptKey } });
            }
            restored.runtime.flush();
            expect(unresolvedReferences(restored, 'local.sql')).toBe(0);
            expect(scriptOf(restored, 'local.sql').analysisOutdated).toBe(false);
            expect(scriptOf(restored, 'remote.sql').analysisOutdated).toBe(false);

            pickConnection(restored, 'define.sql', TRINO_ID);
            expect(scriptOf(restored, 'local.sql').analysisOutdated).toBe(true);
            expect(scriptOf(restored, 'remote.sql').analysisOutdated).toBe(true);
            expect(unresolvedReferences(restored, 'local.sql')).toBe(1);
            expect(unresolvedReferences(restored, 'remote.sql')).toBe(0);
            await restored.runtime.storage.flush();
        });

        it('attaches a newly picked connection to the workbook file before the scripts reference it', async () => {
            const backend = new WorkbookTestBackend();
            await seedWorkbook(backend, [['query.sql', HYPER_ID, 'select 1']], [HYPER_ID]);
            const restored = await restore(backend);
            pickConnection(restored, 'query.sql', TRINO_ID);
            await restored.runtime.storage.flush();

            const stored = backend.workbooks.get(WORKBOOK_ID)!;
            // The workbook holds the connections of its scripts only
            expect(stored.connections).toEqual([{ connectionId: TRINO_ID, params: TRINO_PARAMS }]);
            expect(stored.scripts).toEqual([{ name: 'query.sql', connectionId: TRINO_ID }]);
        });

        it('keeps the reference to a connection that the app can not resolve', async () => {
            const backend = new WorkbookTestBackend();
            const unknownId = 'dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb';
            // A hand-edited workbook file names a connection without a copy
            await seedWorkbook(backend, [['query.sql', unknownId, 'select 1'], ['other.sql', HYPER_ID, 'select 2']], [HYPER_ID]);
            const restored = await restore(backend);
            const query = scriptOf(restored, 'query.sql');
            expect(query.connectionId).toBe(HYPER_ID);
            expect(query.unresolvedConnectionId).toBe(unknownId);
            expect(backend.workbooks.get(WORKBOOK_ID)!.scripts[0]).toEqual({ name: 'query.sql', connectionId: unknownId });

            // Other changes of the script list keep the reference
            restored.runtime.dispatch({ workbook: WORKBOOK_ID }, { kind: 'reorderScripts', value: { order: ['other.sql', 'query.sql'] } });
            await restored.runtime.storage.flush();
            expect(backend.workbooks.get(WORKBOOK_ID)!.scripts).toEqual([
                { name: 'other.sql', connectionId: HYPER_ID },
                { name: 'query.sql', connectionId: unknownId },
            ]);
            expect(backend.workbooks.get(WORKBOOK_ID)!.connections.map(connection => connection.connectionId)).toEqual([HYPER_ID]);

            // Picking a connection replaces it
            pickConnection(restored, 'query.sql', TRINO_ID);
            await restored.runtime.storage.flush();
            expect(backend.workbooks.get(WORKBOOK_ID)!.scripts[1]).toEqual({ name: 'query.sql', connectionId: TRINO_ID });
        });

        it('releases a connection after its last script moved away', async () => {
            const backend = new WorkbookTestBackend();
            await seedWorkbook(backend, [['query.sql', TRINO_ID, 'select 1']]);
            let restored = await restore(backend);
            expect(workbooksOf(restored, TRINO_ID)).toEqual([WORKBOOK_ID]);

            pickConnection(restored, 'query.sql', HYPER_ID);
            // The references follow the scripts right away
            expect(workbookConnectionIds(workbookOf(restored))).not.toContain(TRINO_ID);
            await restored.runtime.storage.flush();
            expect(backend.workbooks.get(WORKBOOK_ID)!.connections.map(connection => connection.connectionId)).toEqual([HYPER_ID]);

            restored = await restore(backend);
            expect(workbooksOf(restored, TRINO_ID)).toEqual([]);
        });
    });

    describe('sharing', () => {
        let registry: Registry;
        let backend: CompositeStorageBackend;

        beforeEach(async () => {
            resetFsStore();
            globalThis.dashqlElectron = { fs: makeFsMock() } as unknown as DashQLElectronBridge;
            registry = new Registry();
            backend = new CompositeStorageBackend(registry, new TestLogger());
            await backend.initialize();
            await seedWorkbook(registry, [
                ['define.sql', HYPER_ID, 'create table items (id int)'],
                ['remote.sql', TRINO_ID, 'select 42'],
            ]);
            await backend.refreshLocations();
        });

        afterEach(() => {
            delete globalThis.dashqlElectron;
        });

        /// Export the seeded workbook the way the share dialog does and read it back like an import
        let database: HyperDB;
        let disposeDatabase: (() => Promise<void>) | null = null;
        beforeAll(async () => {
            ({ database, dispose: disposeDatabase } = await createTestHyperDB('dashql-workbook-connections'));
        }, 60_000);
        afterAll(async () => {
            await disposeDatabase?.();
        });
        /// The app that exports the seeded workbook and reads the export, nothing is imported yet
        const exportAndRead = async () => {
            const app = await createTestRuntime({ storage: backend, archiveDatabase: async () => database });
            await app.restore();
            const runtime = app;
            const { archive } = await runtime.exportArchive(WORKBOOK_ID, { withCatalog: true });
            return { runtime, preview: await runtime.readImport({ archive }) };
        };

        it('gives the connections fresh ids and keeps every script on its connection', async () => {
            const { preview } = await exportAndRead();
            const workbook = preview.workbook as WorkbookData;
            expect(workbook.workbookId).not.toBe(WORKBOOK_ID);
            const ids = workbook.connections.map(connection => connection.connectionId);
            expect(ids).not.toContain(HYPER_ID);
            expect(ids).not.toContain(TRINO_ID);
            // The connector of the connection a script references, the export normalizes the params
            const connectorOf = (connectionId: string) => Object.keys(workbook.connections.find(connection => connection.connectionId === connectionId)?.params ?? {});
            expect(workbook.scripts.map(script => [script.name, connectorOf(script.connectionId)])).toEqual([
                ['define.sql', ['hyper']],
                ['remote.sql', ['trino']],
            ]);
        });

        it('imports a shared workbook with connections of its own', async () => {
            const { runtime, preview } = await exportAndRead();
            // The embedded database is the one of the app, the user is asked about the other connection
            expect(preview.questions.map(question => question.candidates.map(candidate => candidate.id))).toEqual([[TRINO_ID]]);
            const connections = Object.fromEntries(preview.questions.map(question => [question.connectionId, { kind: 'separate' as const }]));
            await runtime.commitImport(preview.importId, { connections, workbookId: IMPORTED_WORKBOOK_ID, restore: false });
            await runtime.storage.flush();

            const restored = await restore(backend);
            expect(scriptOf(restored, 'define.sql', IMPORTED_WORKBOOK_ID).connectionId).toBe(HYPER_ID);
            const remote = scriptOf(restored, 'remote.sql', IMPORTED_WORKBOOK_ID).connectionId;
            expect(remote).not.toBe(TRINO_ID);
            expect(restored.runtime.connection(remote)?.connectorType).toBe(ConnectorType.TRINO);
            expect(restored.runtime.catalog(remote)).not.toBe(restored.runtime.catalog(TRINO_ID));
        });

        it('imports a shared workbook that links its connections to the connections of the app', async () => {
            const { runtime, preview } = await exportAndRead();
            const connections = Object.fromEntries(preview.questions.map(question => [
                question.connectionId,
                { kind: 'link' as const, connectionId: question.candidates[0].id },
            ]));
            await runtime.commitImport(preview.importId, { connections, workbookId: IMPORTED_WORKBOOK_ID, restore: false });
            expect(registry.workbooks.get(IMPORTED_WORKBOOK_ID)!.scripts).toEqual([
                { name: 'define.sql', connectionId: HYPER_ID },
                { name: 'remote.sql', connectionId: TRINO_ID },
            ]);
            await runtime.storage.flush();

            const restored = await restore(backend);
            // Both workbooks share the connections of the app
            expect(scriptOf(restored, 'remote.sql', IMPORTED_WORKBOOK_ID).connectionId).toBe(TRINO_ID);
            expect(workbooksOf(restored, TRINO_ID)).toEqual([WORKBOOK_ID, IMPORTED_WORKBOOK_ID]);
        });
    });
});
