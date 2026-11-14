import * as core from '@ankoh/dashql-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TestLogger } from '@ankoh/dashql-runtime/testing/test_logger';
import type { ConnectionReferences, ConnectionRegistry } from '../../connections/connection_registry.js';
import { workbookConnectionReferences } from '../scripts/workbook_scripts_registry.js';
import { ConnectorType } from '@ankoh/dashql-runtime/connections/connector_info';
import { CompositeStorageBackend } from '../../storage/composite_storage_backend.js';
import { writePortableWorkbookFresh } from '../../storage/workbook_import_transaction.js';
import { WorkbookTestBackend, WorkbookTestRegistry } from '@ankoh/dashql-runtime/testing/workbook_test_backend';
import type { ConnectionEntry, WorkbookData } from '@ankoh/dashql-runtime/storage/storage_backend';
import { StorageWriter } from '@ankoh/dashql-runtime/storage/storage_writer';
import { makeFsMock, resetFsStore } from '@ankoh/dashql-runtime/testing/test_fs_mock';
import { WORKBOOK_FORMAT_VERSION } from '@ankoh/dashql-runtime/storage/migration/versions';
import { ANALYZE_OUTDATED_SCRIPT, analyzeScriptData, reduceWorkbookScripts, REORDER_SCRIPTS, scriptConnectionOf, workbookConnectionIds, SET_SCRIPT_CONNECTION, type WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import { restoreAppState, type RestoredAppState } from '@ankoh/dashql-runtime/workbook/persistence/app_state_loader';
import { applyConnectionImportPlan, planConnectionImport, type ConnectionImportChoice } from './workbook_connection_import.js';
import { exportWorkbookAsSharedZip } from './workbook_export.js';
import { readWorkbookBundleFromZip } from './workbook_import.js';
import { createTestHyperDB } from '../../tests/hyperdb_test_client.js';
import type { HyperDB } from '../../platform/hyperdb/hyperdb_wasm.js';
import { readStoredWorkbookScripts } from './native_workbook_sync_react.js';
import { workbookScriptsResolutionChanged } from '@ankoh/dashql-runtime/workbook/persistence/workbook_script_connections';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

/// Integration tests for the connections of a workbook.
///
/// A script names its connection in the workbook file, the app resolves it to a connection of the
/// registry and analyzes the script in the catalog of that connection. These tests drive the real
/// core, the storage writer and the loader through the round trips that touch that mapping:
/// restoring, changing the connection of a script, reloading, exporting and importing.

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
        formatVersion: WORKBOOK_FORMAT_VERSION,
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
    const logger = new TestLogger();

    beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });
    afterEach(() => { dql.resetUnsafe(); });

    const restore = (backend: WorkbookTestBackend | CompositeStorageBackend) => restoreAppState(dql, backend, logger, () => {});

    /// The restored scripts of the workbook
    const workbookOf = (restored: RestoredAppState, workbookId: string = WORKBOOK_ID): WorkbookScripts => {
        const workbook = restored.workbookScripts.get(workbookId);
        if (workbook == null) throw new Error(`Workbook ${workbookId} was not restored`);
        return workbook;
    };
    const scriptOf = (workbook: WorkbookScripts, fileName: string) => workbook.scripts[workbook.scriptRefs[fileName].scriptId];

    /// Load every script into the catalog of its connection like a workbook run does and return the
    /// number of table references of a script that its catalog does not resolve
    const unresolvedReferences = (workbook: WorkbookScripts, fileName: string): number => {
        for (const name of workbook.scriptOrder) analyzeScriptData(scriptOf(workbook, name), logger);
        const script = scriptOf(workbook, fileName);
        script.scriptSession.analyze();
        return dql.planSession({
            connections: [{ id: script.connection.connectionId, local: false, catalog: script.connection.catalog }],
            scripts: [{ name: '', connection: 0, session: script.scriptSession }],
        }).unpack().unresolvedReferences.length;
    };

    /// Run a script on another connection the way the connection picker of the feed does
    const pickConnection = (workbook: WorkbookScripts, restored: RestoredAppState, writer: StorageWriter, fileName: string, connectionId: string): WorkbookScripts =>
        reduceWorkbookScripts(workbook, {
            type: SET_SCRIPT_CONNECTION,
            value: { fileName, connection: scriptConnectionOf(restored.connectionStates.get(connectionId)!) },
        }, writer, logger);

    /// The connection registry of a restored app state
    const connectionRegistryOf = (restored: RestoredAppState): ConnectionRegistry => ({
        connections: restored.connectionStates,
        connectionsByType: restored.connectionStatesByType,
    });
    /// The connections that the workbooks of a restored app state use
    const referencesOf = (restored: RestoredAppState): ConnectionReferences => workbookConnectionReferences({
        current: { workbookScriptsMap: restored.workbookScripts, workbookScriptsByConnection: restored.workbookScriptsByConnection, invalidWorkbooks: restored.invalidWorkbooks },
        subscribe: () => () => { },
    });

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
            expect(scriptOf(workbook, 'remote.sql').connection.catalog).toBe(restored.connectionStates.get(TRINO_ID)!.catalog);
            expect(scriptOf(workbook, 'local.sql').connection.catalog).toBe(restored.connectionStates.get(HYPER_ID)!.catalog);
            // Only the scripts of the same connection see the table
            expect(unresolvedReferences(workbook, 'local.sql')).toBe(0);
            expect(unresolvedReferences(workbook, 'remote.sql')).toBe(1);
            expect(restored.workbookScriptsByConnection.get(TRINO_ID)).toEqual([WORKBOOK_ID]);
        });

        it('attaches a known connection that a script uses but the workbook file misses', async () => {
            const backend = new WorkbookTestBackend();
            await seedWorkbook(backend, [['remote.sql', TRINO_ID, 'select 1']], [HYPER_ID]);
            const restored = await restore(backend);

            expect(scriptOf(workbookOf(restored), 'remote.sql').connection.connectionId).toBe(TRINO_ID);
            // The connection that no script uses is left out
            expect(backend.workbooks.get(WORKBOOK_ID)!.connections.map(connection => connection.connectionId)).toEqual([TRINO_ID]);
        });

        it('registers a connection that only the workbook file knows', async () => {
            const backend = new WorkbookTestBackend();
            await seedWorkbook(backend, [['remote.sql', TRINO_ID, 'select 1']]);
            backend.connections = backend.connections!.filter(entry => entry.id !== TRINO_ID);
            const restored = await restore(backend);

            expect(scriptOf(workbookOf(restored), 'remote.sql').connection.connectionId).toBe(TRINO_ID);
            expect(restored.connectionStates.get(TRINO_ID)?.connectorInfo.connectorType).toBe(ConnectorType.TRINO);
            expect(backend.connections!.map(entry => entry.id)).toEqual([HYPER_ID, TRINO_ID]);
        });

        it('drops the copies of connections that no script uses', async () => {
            const backend = new WorkbookTestBackend();
            await seedWorkbook(backend, [['query.sql', HYPER_ID, 'select 1']]);
            const restored = await restore(backend);

            expect(workbookConnectionIds(workbookOf(restored))).toEqual([HYPER_ID]);
            expect(backend.workbooks.get(WORKBOOK_ID)!.connections.map(connection => connection.connectionId)).toEqual([HYPER_ID]);
            // The connection itself stays a connection of the app
            expect(restored.connectionStates.has(TRINO_ID)).toBe(true);
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
            let workbook = workbookOf(restored);
            expect(unresolvedReferences(workbook, 'query.sql')).toBe(1);

            const writer = new StorageWriter(logger, backend);
            const moved = scriptOf(workbook, 'query.sql').scriptKey;
            workbook = pickConnection(workbook, restored, writer, 'query.sql', HYPER_ID);
            // The script keeps its key and now resolves the table of its new catalog
            expect(scriptOf(workbook, 'query.sql').scriptKey).toBe(moved);
            expect(scriptOf(workbook, 'query.sql').connection.connectionId).toBe(HYPER_ID);
            expect(unresolvedReferences(workbook, 'query.sql')).toBe(0);
            await writer.flush();
            expect(backend.workbooks.get(WORKBOOK_ID)!.scripts).toEqual([
                { name: 'define.sql', connectionId: HYPER_ID },
                { name: 'query.sql', connectionId: HYPER_ID },
            ]);

            restored = await restore(backend);
            workbook = workbookOf(restored);
            expect(scriptOf(workbook, 'query.sql').connection.connectionId).toBe(HYPER_ID);
            expect(unresolvedReferences(workbook, 'query.sql')).toBe(0);
        });

        it('takes the declarations of a moved script out of the catalog it leaves', async () => {
            const backend = new WorkbookTestBackend();
            await seedWorkbook(backend, [
                ['define.sql', HYPER_ID, 'create table items (id int)'],
                ['local.sql', HYPER_ID, 'select id from items'],
                ['remote.sql', TRINO_ID, 'select id from items'],
            ]);
            const restored = await restore(backend);
            let workbook = workbookOf(restored);
            const writer = new StorageWriter(logger, backend);
            for (const name of workbook.scriptOrder) {
                workbook = reduceWorkbookScripts(workbook, { type: ANALYZE_OUTDATED_SCRIPT, value: scriptOf(workbook, name).scriptKey }, writer, logger);
            }
            expect(unresolvedReferences(workbook, 'local.sql')).toBe(0);
            expect(scriptOf(workbook, 'local.sql').analysisOutdated).toBe(false);
            expect(scriptOf(workbook, 'remote.sql').analysisOutdated).toBe(false);

            workbook = pickConnection(workbook, restored, writer, 'define.sql', TRINO_ID);
            expect(scriptOf(workbook, 'local.sql').analysisOutdated).toBe(true);
            expect(scriptOf(workbook, 'remote.sql').analysisOutdated).toBe(true);
            expect(unresolvedReferences(workbook, 'local.sql')).toBe(1);
            expect(unresolvedReferences(workbook, 'remote.sql')).toBe(0);
            await writer.flush();
        });

        it('attaches a newly picked connection to the workbook file before the scripts reference it', async () => {
            const backend = new WorkbookTestBackend();
            await seedWorkbook(backend, [['query.sql', HYPER_ID, 'select 1']], [HYPER_ID]);
            const restored = await restore(backend);
            const writer = new StorageWriter(logger, backend);
            pickConnection(workbookOf(restored), restored, writer, 'query.sql', TRINO_ID);
            await writer.flush();

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
            let workbook = workbookOf(restored);
            const query = scriptOf(workbook, 'query.sql');
            expect(query.connection.connectionId).toBe(HYPER_ID);
            expect(query.unresolvedConnectionId).toBe(unknownId);
            expect(backend.workbooks.get(WORKBOOK_ID)!.scripts[0]).toEqual({ name: 'query.sql', connectionId: unknownId });

            // Other changes of the script list keep the reference
            const writer = new StorageWriter(logger, backend);
            workbook = reduceWorkbookScripts(workbook, { type: REORDER_SCRIPTS, value: ['other.sql', 'query.sql'] }, writer, logger);
            await writer.flush();
            expect(backend.workbooks.get(WORKBOOK_ID)!.scripts).toEqual([
                { name: 'other.sql', connectionId: HYPER_ID },
                { name: 'query.sql', connectionId: unknownId },
            ]);
            expect(backend.workbooks.get(WORKBOOK_ID)!.connections.map(connection => connection.connectionId)).toEqual([HYPER_ID]);

            // Picking a connection replaces it
            pickConnection(workbook, restored, writer, 'query.sql', TRINO_ID);
            await writer.flush();
            expect(backend.workbooks.get(WORKBOOK_ID)!.scripts[1]).toEqual({ name: 'query.sql', connectionId: TRINO_ID });
        });

        it('releases a connection after its last script moved away', async () => {
            const backend = new WorkbookTestBackend();
            await seedWorkbook(backend, [['query.sql', TRINO_ID, 'select 1']]);
            let restored = await restore(backend);
            expect(referencesOf(restored).workbooksOf(TRINO_ID)).toEqual([WORKBOOK_ID]);

            const writer = new StorageWriter(logger, backend);
            const workbook = pickConnection(workbookOf(restored), restored, writer, 'query.sql', HYPER_ID);
            // The references follow the scripts right away
            expect(workbookConnectionIds(workbook)).not.toContain(TRINO_ID);
            await writer.flush();
            expect(backend.workbooks.get(WORKBOOK_ID)!.connections.map(connection => connection.connectionId)).toEqual([HYPER_ID]);

            restored = await restore(backend);
            expect(referencesOf(restored).workbooksOf(TRINO_ID)).toEqual([]);
        });
    });

    describe('reloading a native folder', () => {
        it('keeps a script on a connection that a pulled workbook file brings along', async () => {
            const backend = new WorkbookTestBackend();
            await seedWorkbook(backend, [['query.sql', HYPER_ID, 'select 1']]);
            backend.connections = backend.connections!.filter(entry => entry.id !== TRINO_ID);
            const restored = await restore(backend);
            expect(restored.connectionStates.has(TRINO_ID)).toBe(false);

            // A pull adds a script on a connection that the app doesn't know
            const pulled: WorkbookData = {
                ...backend.workbooks.get(WORKBOOK_ID)!,
                connections: [{ connectionId: HYPER_ID, params: HYPER_PARAMS }, { connectionId: TRINO_ID, params: TRINO_PARAMS }],
                scripts: [{ name: 'query.sql', connectionId: HYPER_ID }, { name: 'remote.sql', connectionId: TRINO_ID }],
            };
            const stored = readStoredWorkbookScripts(connectionRegistryOf(restored), pulled, [
                { name: 'query.sql', sql: 'select 1' },
                { name: 'remote.sql', sql: 'select 2' },
            ])!;
            expect(stored.created.map(connection => connection.connectionId)).toEqual([TRINO_ID]);
            expect(stored.snapshot.scripts.map(script => [script.name, script.connection.connectionId])).toEqual([
                ['query.sql', HYPER_ID],
                ['remote.sql', TRINO_ID],
            ]);
            // The workbook file stays as it was pulled
            expect(workbookScriptsResolutionChanged(pulled, stored.workbook)).toBe(false);
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
        const exportAndRead = async () => readWorkbookBundleFromZip(await exportWorkbookAsSharedZip(backend, { database, core: dql }, WORKBOOK_ID, new Map()), database);

        it('gives the connections fresh ids and keeps every script on its connection', async () => {
            const bundle = await exportAndRead();
            const { workbook } = bundle;
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
            const bundle = await exportAndRead();
            const entries = registry.connections!;
            const plan = planConnectionImport(bundle.workbook, entries);
            // The embedded database is the one of the app, the user is asked about the other connection
            expect(plan.map(item => item.decision.kind)).toEqual(['link', 'ask']);
            const choices = new Map<string, ConnectionImportChoice>(plan.map(item => [item.ref.connectionId, { kind: 'separate' }]));
            const workbook = applyConnectionImportPlan(bundle.workbook, plan, choices, entries).workbook;
            await writePortableWorkbookFresh(backend, { ...bundle, workbook }, IMPORTED_WORKBOOK_ID);

            const restored = await restore(backend);
            const imported = workbookOf(restored, IMPORTED_WORKBOOK_ID);
            expect(scriptOf(imported, 'define.sql').connection.connectionId).toBe(HYPER_ID);
            const remote = scriptOf(imported, 'remote.sql').connection.connectionId;
            expect(remote).not.toBe(TRINO_ID);
            expect(restored.connectionStates.get(remote)?.connectorInfo.connectorType).toBe(ConnectorType.TRINO);
            expect(restored.connectionStates.get(remote)?.catalog).not.toBe(restored.connectionStates.get(TRINO_ID)!.catalog);
        });

        it('imports a shared workbook that links its connections to the connections of the app', async () => {
            const bundle = await exportAndRead();
            const entries = registry.connections!;
            const plan = planConnectionImport(bundle.workbook, entries);
            const choices = new Map<string, ConnectionImportChoice>(plan.map(item => [
                item.ref.connectionId,
                { kind: 'link', connectionId: item.decision.kind === 'ask' ? item.decision.candidates[0].id : '' },
            ]));
            const workbook = applyConnectionImportPlan(bundle.workbook, plan, choices, entries).workbook;
            expect(workbook.scripts).toEqual([
                { name: 'define.sql', connectionId: HYPER_ID },
                { name: 'remote.sql', connectionId: TRINO_ID },
            ]);
            await writePortableWorkbookFresh(backend, { ...bundle, workbook }, IMPORTED_WORKBOOK_ID);

            const restored = await restore(backend);
            const imported = workbookOf(restored, IMPORTED_WORKBOOK_ID);
            // Both workbooks share the connections of the app
            expect(scriptOf(imported, 'remote.sql').connection.catalog).toBe(restored.connectionStates.get(TRINO_ID)!.catalog);
            expect(referencesOf(restored).workbooksOf(TRINO_ID)).toEqual([WORKBOOK_ID, IMPORTED_WORKBOOK_ID]);
        });
    });
});
