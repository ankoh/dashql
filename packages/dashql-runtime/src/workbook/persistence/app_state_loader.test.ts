import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dashql from '@ankoh/dashql-core';
import * as flatbuffers from 'flatbuffers';
import * as buffers from '@ankoh/dashql-core/buffers';
import type { BatchProcessor } from '../../connections/catalog/catalog_batch.js';
import type { BatchRequest } from '@ankoh/dashql-core';

import type { DashQL } from '@ankoh/dashql-core';
import { TestLogger } from '../../testing/test_logger.js';
import { ConnectorType } from '../../connections/connector_info.js';
import { destroyRestoredWorkbook, restoreAppState, restoreSingleWorkbook } from './app_state_loader.js';
import { destroyWorkbookScripts, isEphemeralWorkbook, workbookConnectionIds } from '../scripts/workbook_scripts.js';
import type { WorkbookRegistryBackend } from '../../storage/storage_backend.js';
import { StorageBackendType } from '../../storage/storage_backend.js';
import { WorkbookTestBackend, TEST_CONNECTION_ID, TEST_WORKBOOK_ID, testConnections, testWorkbook } from '../../testing/workbook_test_backend.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

describe('V2 app state loader', () => {
    let backend: WorkbookRegistryBackend;
    let connectionFiles: Map<string, string>;
    let core: DashQL;
    let processor: BatchProcessor;

    beforeAll(async () => {
        core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
    });
    afterEach(() => {
        vi.restoreAllMocks();
        core.resetUnsafe();
    });

    beforeEach(() => {
        // The real core, the tests watch what reaches the catalogs and the catalog scripts of the connections
        const createCatalog = core.createCatalog.bind(core);
        vi.spyOn(core, 'createCatalog').mockImplementation(() => {
            const catalog = createCatalog();
            vi.spyOn(catalog, 'replaceDescriptor');
            return catalog;
        });
        const createScript = core.createScript.bind(core);
        vi.spyOn(core, 'createScript').mockImplementation((catalog: dashql.DashQLCatalog) => {
            const script = createScript(catalog);
            vi.spyOn(script, 'replaceText');
            return script;
        });
        const builder = new flatbuffers.Builder();
        builder.finish(new buffers.catalog.CatalogDescriptorT().pack(builder));
        const descriptor = builder.asUint8Array();
        processor = vi.fn(async (request: BatchRequest) => ({ scripts: request.scripts.map(script => ({
            id: script.id, diagnostics: [], catalogDescriptor: descriptor,
        })) }));
        connectionFiles = new Map();
        backend = {
            getBackendType: () => StorageBackendType.OPFS,
            listWorkbooks: vi.fn(async () => [{ path: TEST_WORKBOOK_ID }]),
            loadAppSettings: vi.fn(async () => null), saveAppSettings: vi.fn(),
            loadWorkbook: vi.fn(async () => testWorkbook()), saveWorkbookManifest: vi.fn(), deleteWorkbook: vi.fn(),
            loadScripts: vi.fn(async () => [
                { name: '10_last.sql', sql: 'SELECT 10' },
                { name: '2_first.sql', sql: 'SELECT 2' },
            ]),
            loadScript: vi.fn(), saveScript: vi.fn(), deleteScript: vi.fn(), renameScript: vi.fn(),
            listDataFiles: vi.fn(async () => []), loadDataFile: vi.fn(), saveDataFile: vi.fn(),
            deleteDataFile: vi.fn(), renameDataFile: vi.fn(),
            loadWorkbookTree: vi.fn(), upsertWorkbookEntry: vi.fn(), removeWorkbookEntry: vi.fn(), moveWorkbook: vi.fn(),
            createFolder: vi.fn(), moveFolder: vi.fn(), deleteFolder: vi.fn(), deleteWorkbookFiles: vi.fn(),
            loadManifest: vi.fn(async () => ({})), updateConnections: vi.fn(),
            loadConnectionFile: vi.fn(async (connectionId: string, fileName: string) => connectionFiles.get(`${connectionId}/${fileName}`) ?? null),
            saveConnectionFile: vi.fn(), createConnectionFolder: vi.fn(), deleteConnectionFiles: vi.fn(),
        };
    });
    const relationsFile = `${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`;
    const functionsFile = `${TEST_CONNECTION_ID}/dashql-catalog-functions.sql`;

    it('restores one attached database and flat scripts with natural initial focus', async () => {
        const result = await restoreAppState(core, backend, new TestLogger(), () => {}, processor);
        expect(workbookConnectionIds(result.workbookScripts.get(TEST_WORKBOOK_ID)!)).toEqual([TEST_CONNECTION_ID]);
        expect(result.connectionStatesByType[ConnectorType.HYPER]).toEqual([TEST_CONNECTION_ID]);
        const scripts = result.workbookScripts.get(TEST_WORKBOOK_ID)!;
        // Files without an entry in the workbook file are appended in natural order
        expect(scripts.scriptOrder).toEqual(['2_first.sql', '10_last.sql']);
        expect(scripts.scripts[scripts.scriptRefs['2_first.sql'].scriptId].scriptSession.getText()).toBe('SELECT 2');
        expect(backend.saveWorkbookManifest).toHaveBeenCalledWith(TEST_WORKBOOK_ID, expect.objectContaining({
            scripts: [
                { name: '2_first.sql', connectionId: TEST_CONNECTION_ID },
                { name: '10_last.sql', connectionId: TEST_CONNECTION_ID },
            ],
        }));
    });

    it('restores the order and the connections of the workbook file', async () => {
        const remoteId = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb';
        vi.mocked(backend.loadWorkbook).mockResolvedValue(testWorkbook({
            ...testConnections(testWorkbook().connections[0], { connectionId: remoteId, params: { trino: { endpoint: 'https://trino.example' } } as any }),
            scripts: [
                { name: '10_last.sql', connectionId: remoteId },
                { name: '2_first.sql', connectionId: '99999999-9999-4999-8999-999999999999' },
            ],
        }));
        const result = await restoreAppState(core, backend, new TestLogger(), () => {}, processor);
        const scripts = result.workbookScripts.get(TEST_WORKBOOK_ID)!;
        expect(scripts.scriptOrder).toEqual(['10_last.sql', '2_first.sql']);
        expect(scripts.scripts[scripts.scriptRefs['10_last.sql'].scriptId].connection.connectionId).toBe(remoteId);
        // An unknown connection runs on the embedded database, the workbook file keeps the reference
        const first = scripts.scripts[scripts.scriptRefs['2_first.sql'].scriptId];
        expect(first.connection.connectionId).toBe(TEST_CONNECTION_ID);
        expect(first.unresolvedConnectionId).toBe('99999999-9999-4999-8999-999999999999');
        expect(result.workbookScriptsByConnection.get(remoteId)).toEqual([TEST_WORKBOOK_ID]);
        expect(result.workbookScriptsByConnection.get(TEST_CONNECTION_ID)).toEqual([TEST_WORKBOOK_ID]);
        expect(backend.saveWorkbookManifest).not.toHaveBeenCalledWith(TEST_WORKBOOK_ID, expect.objectContaining({
            scripts: expect.arrayContaining([{ name: '2_first.sql', connectionId: TEST_CONNECTION_ID }]),
        }));
    });

    it('restores local and remote databases and routes scripts to the explicit main catalog', async () => {
        const remoteId = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb';
        vi.mocked(backend.loadWorkbook).mockResolvedValue(testWorkbook({
            ...testConnections({ connectionId: remoteId, params: { trino: { endpoint: 'https://trino.example' } } as any } as any, { connectionId: TEST_CONNECTION_ID, params: { hyper: { protocol: 'WASM' } } as any }),
            scripts: [{ name: '2_first.sql', connectionId: TEST_CONNECTION_ID }],
        }));
        const result = await restoreAppState(core, backend, new TestLogger(), () => {}, processor);
        // The workbook uses the connections of its scripts, a copy that no script uses is not registered
        expect(workbookConnectionIds(result.workbookScripts.get(TEST_WORKBOOK_ID)!)).toEqual([TEST_CONNECTION_ID]);
        expect([...result.connectionStates.keys()]).toEqual([TEST_CONNECTION_ID]);
        expect(result.workbookScripts.get(TEST_WORKBOOK_ID)?.pendingConnection).toBeNull();
    });

    it('restores invalid drafts separately from committed settings without runtime OAuth state', async () => {
        const params = { salesforce: { instanceUrl: 'https://committed.example', appConsumerKey: 'key' } } as any;
        const paramsDraft = { salesforce: { instanceUrl: '', appConsumerKey: 'unfinished' } } as any;
        vi.mocked(backend.loadWorkbook).mockResolvedValue(testWorkbook({
            ...testConnections({ connectionId: TEST_CONNECTION_ID, params, paramsDraft } as any),
        }));
        const result = await restoreAppState(core, backend, new TestLogger(), () => {}, processor);
        const restored = result.connectionStates.get(TEST_CONNECTION_ID)!;
        expect(restored.params).toEqual(params);
        expect(restored.paramsDraft).toEqual(paramsDraft);
        expect(restored.details.value.proto.setupParams).toEqual(params.salesforce);
        expect('oauthState' in restored.details.value.proto).toBe(false);
    });

    it('restores partially typed raw draft rows after manifest serialization', async () => {
        const rows = [{ key: '', value: 'partial' }, { key: '', value: '' }];
        const manifest = testWorkbook(testConnections({
            connectionId: TEST_CONNECTION_ID,
            params: { hyper: { protocol: 'WASM', endpoint: '', tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' } } },
            paramsDraft: { hyper: { protocol: 'V3_HTTP', endpoint: 'unfinished', tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' }, draftRows: { metadata: rows, queryParameters: rows } } },
        } as any));
        vi.mocked(backend.loadWorkbook).mockResolvedValue(JSON.parse(JSON.stringify(manifest)));
        const result = await restoreAppState(core, backend, new TestLogger(), () => {}, processor);
        expect(result.connectionStates.get(TEST_CONNECTION_ID)?.paramsDraft).toEqual(manifest.connections[0].paramsDraft);
        expect(result.connectionStates.get(TEST_CONNECTION_ID)?.params).toEqual(manifest.connections[0].params);
    });

    it('runs the unlisted script files of a workbook without scripts on its first connection', async () => {
        const remoteId = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb';
        vi.mocked(backend.loadWorkbook).mockResolvedValue(testWorkbook({
            ...testConnections({ connectionId: TEST_CONNECTION_ID, params: { hyper: { protocol: 'WASM' } } as any } as any, { connectionId: remoteId, params: { trino: { endpoint: 'https://trino.example' } } as any }),
        }));
        const result = await restoreAppState(core, backend, new TestLogger(), () => {}, processor);
        const workbook = result.workbookScripts.get(TEST_WORKBOOK_ID)!;
        expect(Object.values(workbook.scripts).map(script => script.connection.connectionId)).toEqual([TEST_CONNECTION_ID, TEST_CONNECTION_ID]);
        expect(workbookConnectionIds(workbook)).toEqual([TEST_CONNECTION_ID]);
    });

    it('keeps an empty ephemeral workbook and promotes one that holds scripts', async () => {
        const workbook = testWorkbook();
        vi.mocked(backend.loadWorkbook).mockResolvedValue({ ...workbook, scripts: [], metadata: { ...workbook.metadata, ephemeral: true } });
        vi.mocked(backend.loadScripts).mockResolvedValue([]);
        const empty = await restoreAppState(core, backend, new TestLogger(), () => {}, processor);
        expect(isEphemeralWorkbook(empty.workbookScripts.get(TEST_WORKBOOK_ID)!)).toBe(true);
        expect(backend.saveWorkbookManifest).not.toHaveBeenCalled();

        // The app stopped after the script was written, before the promotion was
        vi.mocked(backend.loadWorkbook).mockResolvedValue({ ...workbook, metadata: { ...workbook.metadata, ephemeral: true } });
        vi.mocked(backend.loadScripts).mockResolvedValue([{ name: '1.sql', sql: 'SELECT 1' }]);
        const crashed = await restoreAppState(core, backend, new TestLogger(), () => {}, processor);
        expect(isEphemeralWorkbook(crashed.workbookScripts.get(TEST_WORKBOOK_ID)!)).toBe(false);
        const written = vi.mocked(backend.saveWorkbookManifest).mock.lastCall!;
        expect(written[0]).toBe(TEST_WORKBOOK_ID);
        expect('ephemeral' in written[1].metadata).toBe(false);
    });

    it('restores saved Salesforce relations and functions into the main catalog on reopen', async () => {
        const schemaSQL = 'CREATE TABLE "lakehouse"."public"."Account__dlm" ("Id__c" VARCHAR);';
        const functionsSQL = 'CREATE FUNCTION test() AS 1;';
        vi.mocked(backend.loadWorkbook).mockResolvedValue(testWorkbook({
            ...testConnections({
                connectionId: TEST_CONNECTION_ID,
                params: { salesforce: { instanceUrl: 'https://example.my.salesforce.com' } } as any,
            }),
        }));
        connectionFiles.set(relationsFile, schemaSQL);
        connectionFiles.set(functionsFile, functionsSQL);

        const result = await restoreAppState(core, backend, new TestLogger(), () => {}, processor);
        const connection = result.connectionStates.get(TEST_CONNECTION_ID)!;
        expect(connection.catalogFunctionScript.replaceText).toHaveBeenCalledWith(functionsSQL);
        expect(processor).toHaveBeenCalledWith({ scripts: [
            { id: connection.catalogRelationEntryId.toString(), text: schemaSQL, outputs: ['catalogDescriptor'] },
            { id: connection.catalogFunctionScript.catalog_entry_id.toString(), text: functionsSQL, outputs: ['catalogDescriptor'] },
        ] });
        expect(vi.mocked(connection.catalog.replaceDescriptor).mock.calls).toEqual([
            [connection.catalogRelationEntryId, expect.any(Number), expect.any(Uint8Array)],
            [connection.catalogFunctionScript.catalog_entry_id, expect.any(Number), expect.any(Uint8Array)],
        ]);
        expect(connection.catalogUpdates.described).toBe(true);
    });

    it('leaves restoration pending when batch processing fails', async () => {
        connectionFiles.set(relationsFile, 'CREATE TABLE restored(id int);');
        vi.mocked(processor).mockRejectedValue(new Error('worker failed'));
        const result = await restoreAppState(core, backend, new TestLogger(), () => {}, processor);
        const connection = result.connectionStates.get(TEST_CONNECTION_ID)!;
        expect(connection.catalog.replaceDescriptor).not.toHaveBeenCalled();
        expect(connection.catalogFunctionScript.replaceText).toHaveBeenCalledTimes(1);
        expect(connection.catalogUpdates.described).toBe(false);
        expect(result.workbookScripts.has(TEST_WORKBOOK_ID)).toBe(true);
    });

    it.each(['relations', 'functions'])('rolls back only the failed %s source when descriptor publication fails', async source => {
        connectionFiles.set(relationsFile, 'CREATE TABLE restored(id int);');
        connectionFiles.set(functionsFile, 'CREATE FUNCTION restored_fn() RETURNS int;');
        const replaceDescriptor = vi.fn<dashql.DashQLCatalog['replaceDescriptor']>(() => { throw new Error('publication failed'); });
        if (source === 'functions') replaceDescriptor.mockImplementationOnce(() => {});
        const createCatalog = vi.mocked(core.createCatalog).getMockImplementation()!;
        vi.mocked(core.createCatalog).mockImplementation(() => {
            const catalog = createCatalog();
            vi.mocked(catalog.replaceDescriptor).mockImplementation(replaceDescriptor);
            return catalog;
        });
        const result = await restoreAppState(core, backend, new TestLogger(), () => {}, processor);
        const connection = result.connectionStates.get(TEST_CONNECTION_ID)!;
        expect(connection.catalog.replaceDescriptor).toHaveBeenCalledTimes(source === 'relations' ? 1 : 2);
        expect(connection.catalogFunctionScript.replaceText).toHaveBeenCalledTimes(source === 'relations' ? 1 : 3);
        expect(connection.catalogFunctionScript.toString()).not.toContain('CREATE FUNCTION restored_fn');
        expect(connection.catalogUpdates.described).toBe(false);
    });

    it('strictly refuses V1 before connection, catalog, scripts, or index mutation', async () => {
        vi.mocked(backend.loadWorkbook).mockResolvedValue({ ...testWorkbook(), formatVersion: 1 } as any);
        const result = await restoreAppState(core, backend, new TestLogger(), () => {});
        expect(result.invalidWorkbooks.get(TEST_WORKBOOK_ID)?.error).toBe('unsupported_format_version');
        expect(result.connectionStates.size).toBe(0);
        expect(result.workbookScripts.size).toBe(0);
        expect(core.createCatalog).not.toHaveBeenCalled();
        expect(backend.loadScripts).not.toHaveBeenCalled();
        expect(backend.saveWorkbookManifest).not.toHaveBeenCalled();
    });

    it('surfaces an unreadable workbook without allowing it into live registries', async () => {
        vi.mocked(backend.loadWorkbook).mockRejectedValue(new Error('missing files'));
        const result = await restoreAppState(core, backend, new TestLogger(), () => {});
        expect(result.invalidWorkbooks.get(TEST_WORKBOOK_ID)?.error).toBe('workbook_unreadable');
        expect(result.connectionStates.size).toBe(0);
        expect(result.workbookScripts.size).toBe(0);
    });

    it('surfaces a workbook whose scripts fail to load as invalid', async () => {
        vi.mocked(backend.loadScripts).mockRejectedValue(new Error('unreadable scripts'));
        const result = await restoreAppState(core, backend, new TestLogger(), () => {});
        expect(result.workbookScripts.size).toBe(0);
        expect(result.invalidWorkbooks.get(TEST_WORKBOOK_ID)).toMatchObject({ workbookId: TEST_WORKBOOK_ID, error: 'workbook_not_restored' });
    });

    it('surfaces a workbook whose connection fails to restore as invalid and restores the next one', async () => {
        const second = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        vi.mocked(backend.listWorkbooks).mockResolvedValue([{ path: TEST_WORKBOOK_ID }, { path: second }]);
        vi.mocked(backend.loadWorkbook).mockImplementation(async id => ({ ...testWorkbook(), workbookId: id }));
        vi.mocked(core.createCatalog).mockImplementationOnce(() => { throw new Error('no catalog'); });
        const logger = new TestLogger();
        const result = await restoreAppState(core, backend, logger, () => {});
        expect(result.invalidWorkbooks.get(TEST_WORKBOOK_ID)).toMatchObject({ workbookId: TEST_WORKBOOK_ID, error: 'workbook_not_restored' });
        expect([...result.workbookScripts.keys()]).toEqual([second]);
        const warnings = [...Array(logger.buffer.length).keys()].map(i => logger.buffer.at(i)!)
            .filter(record => record.message === 'Failed to restore workbook');
        expect(warnings.map(record => record.keyValues.workbookId)).toEqual([TEST_WORKBOOK_ID]);
        expect(warnings[0].keyValues.error).toContain('no catalog');
    });
});

describe('real-core startup catalog restoration', () => {
    let dql: dashql.DashQL;
    beforeAll(async () => {
        dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
    });
    afterEach(() => {
        vi.restoreAllMocks();
        dql.resetUnsafe();
    });

    it('clears the catalog changes of older versions and asks about their relations', async () => {
        const backend = new WorkbookTestBackend();
        backend.workbooks.set(TEST_WORKBOOK_ID, testWorkbook({
            ...testConnections({ connectionId: TEST_CONNECTION_ID, params: { hyper: { protocol: 'V3_HTTP', endpoint: 'http://hyper.example' } } as any }),
        }));
        const schema = 'CREATE TABLE "hyper"."public"."kept"(id integer);';
        backend.connectionFiles.set(`${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`, schema);
        backend.connectionFiles.set(`${TEST_CONNECTION_ID}/dashql-catalog-changes.sql`, '-- Catalog changes of executed statements\n\nDROP TABLE "hyper"."public"."kept";\n');
        const processor = vi.fn(async (request: BatchRequest) => dql.processBatch(request));
        const restored = await restoreAppState(dql, backend, new TestLogger(), () => {}, processor);
        const main = restored.connectionStates.get(TEST_CONNECTION_ID)!;
        expect(main.catalog.flatten().read().catalogReader.tablesLength()).toBe(1);
        // No refresh: the connection is asked about the relation
        expect(main.catalogUpdates.described).toBe(true);
        expect(main.catalogUpdates.touchedRelations).toEqual([{ databaseName: 'hyper', schemaName: 'public', tableName: 'kept' }]);
        expect(backend.connectionFiles.get(`${TEST_CONNECTION_ID}/dashql-catalog-changes.sql`)).toBe('');
        // A launch without a connection doesn't lose them
        expect(JSON.parse(backend.connectionFiles.get(`${TEST_CONNECTION_ID}/dashql-catalog-state.json`)!).pending)
            .toEqual([{ databaseName: 'hyper', schemaName: 'public', tableName: 'kept' }]);
    });

    it('asks a Salesforce connection about nothing, it has no lookup', async () => {
        const backend = new WorkbookTestBackend();
        backend.workbooks.set(TEST_WORKBOOK_ID, testWorkbook({
            ...testConnections({ connectionId: TEST_CONNECTION_ID, params: { salesforce: { instanceUrl: 'https://example.my.salesforce.com' } } as any }),
        }));
        backend.connectionFiles.set(`${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`, 'CREATE TABLE "c"."s"."kept"(id integer);');
        backend.connectionFiles.set(`${TEST_CONNECTION_ID}/dashql-catalog-changes.sql`, 'CREATE TABLE "c"."s"."kept"(id integer);');
        backend.connectionFiles.set(`${TEST_CONNECTION_ID}/dashql-catalog-state.json`, JSON.stringify({ pending: [{ databaseName: 'c', schemaName: 's', tableName: 'kept' }], gone: [] }));
        const processor = vi.fn(async (request: BatchRequest) => dql.processBatch(request));
        const restored = await restoreAppState(dql, backend, new TestLogger(), () => {}, processor);
        expect(restored.connectionStates.get(TEST_CONNECTION_ID)!.catalogUpdates.touchedRelations).toEqual([]);
    });

    it('restores the relations it has to ask about and those that are gone', async () => {
        const backend = new WorkbookTestBackend();
        backend.workbooks.set(TEST_WORKBOOK_ID, testWorkbook({
            ...testConnections({ connectionId: TEST_CONNECTION_ID, params: { hyper: { protocol: 'V3_HTTP', endpoint: 'http://hyper.example' } } as any }),
        }));
        const pending = { databaseName: 'hyper', schemaName: '', tableName: 'asked' };
        const gone = { databaseName: 'hyper', schemaName: 'public', tableName: 'dropped' };
        backend.connectionFiles.set(`${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`, 'CREATE TABLE "hyper"."public"."kept"(id integer);');
        backend.connectionFiles.set(`${TEST_CONNECTION_ID}/dashql-catalog-state.json`, JSON.stringify({ pending: [pending], gone: [gone] }));
        const processor = vi.fn(async (request: BatchRequest) => dql.processBatch(request));
        const restored = await restoreAppState(dql, backend, new TestLogger(), () => {}, processor);
        const main = restored.connectionStates.get(TEST_CONNECTION_ID)!;
        expect(main.catalogUpdates.touchedRelations).toEqual([pending]);
        expect(main.catalog.absentRelations().map(name => name.tableName)).toEqual(['dropped']);
        expect(main.catalog.flatten().read().catalogReader.tablesLength()).toBe(1);
    });

    it('reads nothing from a catalog state that it can not read', async () => {
        const backend = new WorkbookTestBackend();
        backend.workbooks.set(TEST_WORKBOOK_ID, testWorkbook({
            ...testConnections({ connectionId: TEST_CONNECTION_ID, params: { hyper: { protocol: 'V3_HTTP', endpoint: 'http://hyper.example' } } as any }),
        }));
        backend.connectionFiles.set(`${TEST_CONNECTION_ID}/dashql-catalog-state.json`, 'not json');
        const processor = vi.fn(async (request: BatchRequest) => dql.processBatch(request));
        const restored = await restoreAppState(dql, backend, new TestLogger(), () => {}, processor);
        expect(restored.connectionStates.get(TEST_CONNECTION_ID)!.catalogUpdates.touchedRelations).toEqual([]);
    });

    it('drops the persisted relations and changes of an embedded connection that only a workbook knows', async () => {
        const backend = new WorkbookTestBackend();
        backend.workbooks.set(TEST_WORKBOOK_ID, testWorkbook({
            ...testConnections({ connectionId: TEST_CONNECTION_ID, params: { hyper: { protocol: 'WASM' } } as any }),
        }));
        const functions = 'CREATE FUNCTION "hyper"."public"."kept_function"(value integer) RETURNS bigint;';
        backend.connectionFiles.set(`${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`, 'CREATE TABLE "hyper"."public"."gone"(id integer);');
        backend.connectionFiles.set(`${TEST_CONNECTION_ID}/dashql-catalog-changes.sql`, '-- Catalog changes of executed statements\n\nCREATE TABLE "hyper"."public"."created" ("a" unknown);\n');
        backend.connectionFiles.set(`${TEST_CONNECTION_ID}/dashql-catalog-functions.sql`, functions);
        const processor = vi.fn(async (request: BatchRequest) => dql.processBatch(request));
        const restored = await restoreAppState(dql, backend, new TestLogger(), () => {}, processor);
        const main = restored.connectionStates.get(TEST_CONNECTION_ID)!;

        expect(main.catalog.flatten().read().catalogReader.tablesLength()).toBe(0);
        expect(main.catalogFunctionScript.toString()).toBe(functions);
        // The catalog is refreshed on connect instead
        expect(main.catalogUpdates.described).toBe(false);
        expect(backend.connectionFiles.get(`${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`)).toBe('');
        expect(backend.connectionFiles.get(`${TEST_CONNECTION_ID}/dashql-catalog-changes.sql`)).toBe('');
        expect(backend.connectionFiles.get(`${TEST_CONNECTION_ID}/dashql-catalog-functions.sql`)).toBe(functions);
        destroyRestoredWorkbook({ workbookId: TEST_WORKBOOK_ID, databases: [main],
            workbookScripts: restored.workbookScripts.get(TEST_WORKBOOK_ID)! });
    });

    it('drops and clears the persisted relations and changes of an embedded connection', async () => {
        const backend = new WorkbookTestBackend();
        const params = { hyper: { protocol: 'WASM' } } as any;
        backend.connections = [{ id: TEST_CONNECTION_ID, params }];
        backend.workbooks.set(TEST_WORKBOOK_ID, testWorkbook({ ...testConnections({ connectionId: TEST_CONNECTION_ID, params } as any) }));
        const functions = 'CREATE FUNCTION "hyper"."public"."kept_function"(value integer) RETURNS bigint;';
        backend.connectionFiles.set(`${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`, 'CREATE TABLE "hyper"."public"."gone"(id integer);');
        backend.connectionFiles.set(`${TEST_CONNECTION_ID}/dashql-catalog-changes.sql`, '-- Catalog changes of executed statements\n\nCREATE TABLE "hyper"."public"."created" ("a" unknown);\n');
        backend.connectionFiles.set(`${TEST_CONNECTION_ID}/dashql-catalog-functions.sql`, functions);
        const processor = vi.fn(async (request: BatchRequest) => dql.processBatch(request));
        const restored = await restoreAppState(dql, backend, new TestLogger(), () => {}, processor);
        const main = restored.connectionStates.get(TEST_CONNECTION_ID)!;

        expect(main.catalog.flatten().read().catalogReader.tablesLength()).toBe(0);
        expect(main.catalogFunctionScript.toString()).toBe(functions);
        expect(main.catalogUpdates.described).toBe(false);
        expect(backend.connectionFiles.get(`${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`)).toBe('');
        expect(backend.connectionFiles.get(`${TEST_CONNECTION_ID}/dashql-catalog-changes.sql`)).toBe('');
        expect(backend.connectionFiles.get(`${TEST_CONNECTION_ID}/dashql-catalog-functions.sql`)).toBe(functions);
        destroyRestoredWorkbook({ workbookId: TEST_WORKBOOK_ID, databases: [main],
            workbookScripts: restored.workbookScripts.get(TEST_WORKBOOK_ID)! });
    });

    it('routes restored relations/functions to the main catalog using receiver source identities ', async () => {
        const backend = new WorkbookTestBackend();
        const remoteId = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb';
        backend.workbooks.set(TEST_WORKBOOK_ID, testWorkbook({
            ...testConnections({ connectionId: remoteId, params: { trino: { endpoint: 'https://trino.example' } } as any } as any, { connectionId: TEST_CONNECTION_ID, params: { hyper: { protocol: 'WASM' } } as any }),
            scripts: [{ name: '01_query.sql', connectionId: remoteId }, { name: '02_local.sql', connectionId: TEST_CONNECTION_ID }],
        }));
        const schema = 'CREATE TABLE db.public.restored_items(id integer, name text);';
        const functions = 'CREATE FUNCTION db.public.restored_function(first integer, second numeric(12, 3)) RETURNS bigint;';
        backend.connectionFiles.set(`${remoteId}/dashql-catalog-relations.sql`, schema);
        backend.connectionFiles.set(`${remoteId}/dashql-catalog-functions.sql`, functions);
        backend.scripts.set(TEST_WORKBOOK_ID, new Map([['01_query.sql', 'SELECT id FROM db.public.restored_items;'], ['02_local.sql', 'SELECT 1;']]));
        const processor = vi.fn(async (request: BatchRequest) => dql.processBatch(request));
        const restored = await restoreAppState(dql, backend, new TestLogger(), () => {}, processor);
        const main = restored.connectionStates.get(remoteId)!;
        const attached = restored.connectionStates.get(TEST_CONNECTION_ID)!;
        const workbook = restored.workbookScripts.get(TEST_WORKBOOK_ID)!;
        expect(main.catalogFunctionScript.toString()).toBe(functions);
        expect(processor).toHaveBeenCalledTimes(1);
        expect(workbook.scripts[workbook.scriptRefs['01_query.sql'].scriptId].connection.catalog).toBe(main.catalog);
        const entries = main.catalog.describeEntries().unpack().entries as dashql.buffers.catalog.CatalogEntryT[];
        expect(entries.map(entry => entry.catalogEntryId).sort((a, b) => a - b)).toEqual([
            main.catalogRelationEntryId, main.catalogFunctionScript.catalog_entry_id,
        ].sort((a, b) => a - b));
        expect(entries.every(entry => entry.catalogEntryType === dashql.buffers.catalog.CatalogEntryType.DESCRIPTOR_POOL)).toBe(true);
        expect(main.catalog.flatten().read().catalogReader.tablesLength()).toBe(1);
        expect(attached.catalog.flatten().read().catalogReader.tablesLength()).toBe(0);
        expect(main.catalogUpdates.described).toBe(true);
        const query = dql.createScript(main.catalog);
        query.replaceText('SELECT id FROM db.public.restored_items;');
        query.analyze();
        expect(query.getAnalyzed().unpack().tableReferences[0].resolvedTable.catalogTableId)
            .toBe(dashql.ExternalObjectID.create(main.catalogRelationEntryId, 0));
        query.replaceText('SELECT restored_fun');
        query.analyze();
        query.moveCursor('SELECT restored_fun'.length);
        const completion = query.completeAtCursor(50).unpack();
        const candidate = completion.candidates.find((candidate: dashql.buffers.completion.CompletionCandidateT) => candidate.completionText === 'restored_function()');
        expect(candidate).toBeDefined();
        expect(candidate.catalogObjects[0].objectType).toBe(dashql.buffers.completion.CompletionCandidateObjectType.FUNCTION);
        expect(candidate.catalogObjects[0].qualifiedName).toEqual(['db', 'public', 'restored_function']);
        query.destroy();
        destroyRestoredWorkbook({ workbookId: TEST_WORKBOOK_ID, databases: [main, attached],
            workbookScripts: workbook });
    });
});

describe('global connections', () => {
    const OTHER_WORKBOOK_ID = '22222222-3333-4444-8555-666666666666';
    const OTHER_CONNECTION_ID = '33333333-4444-4555-8666-777777777777';
    const trino = (endpoint: string) => ({ trino: { endpoint, auth: { authType: 'AUTH_BASIC' } } }) as any;
    let dql: dashql.DashQL;
    beforeAll(async () => {
        dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
    });
    afterEach(() => {
        vi.restoreAllMocks();
        dql.resetUnsafe();
    });
    function seed(backend: WorkbookTestBackend, workbookId: string, connectionId: string, params: object, paramsDraft?: object) {
        backend.workbooks.set(workbookId, testWorkbook({
            workbookId,
            ...testConnections({ connectionId, params, ...(paramsDraft ? { paramsDraft } : {}) } as any),
        }));
    }

    it('lets the app manifest win over stale workbook copies', async () => {
        const backend = new WorkbookTestBackend();
        backend.connections = [{ id: TEST_CONNECTION_ID, params: trino('https://saved') }];
        seed(backend, TEST_WORKBOOK_ID, TEST_CONNECTION_ID, trino('https://stale'));
        seed(backend, OTHER_WORKBOOK_ID, TEST_CONNECTION_ID, trino('https://stale'));
        const restored = await restoreAppState(dql, backend, new TestLogger(), () => {});

        expect([...restored.connectionStates.keys()]).toEqual([TEST_CONNECTION_ID]);
        expect(restored.connectionStates.get(TEST_CONNECTION_ID)!.params).toEqual(trino('https://saved'));
        for (const workbookId of [TEST_WORKBOOK_ID, OTHER_WORKBOOK_ID]) {
            expect(backend.workbooks.get(workbookId)!.connections).toEqual([{ connectionId: TEST_CONNECTION_ID, params: trino('https://saved') }]);
        }
        for (const workbook of restored.workbookScripts.values()) destroyWorkbookScripts(workbook);
    });

    it('registers connections that only a workbook knows', async () => {
        const backend = new WorkbookTestBackend();
        backend.connections = [];
        seed(backend, TEST_WORKBOOK_ID, TEST_CONNECTION_ID, trino('https://unknown'));
        // E.g. an imported workbook seeded the catalog of the connection
        backend.connectionFiles.set(`${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`, 'CREATE TABLE db.public.seeded(id integer);');
        const processor = vi.fn(async (request: BatchRequest) => dql.processBatch(request));
        const restored = await restoreAppState(dql, backend, new TestLogger(), () => {}, processor);

        const connection = restored.connectionStates.get(TEST_CONNECTION_ID)!;
        expect(connection.params).toEqual(trino('https://unknown'));
        expect(backend.connections).toMatchObject([{ id: TEST_CONNECTION_ID, params: trino('https://unknown') }]);
        expect(connection.catalog.flatten().read().catalogReader.tablesLength()).toBe(1);
        expect(connection.catalogUpdates.described).toBe(true);
        for (const workbook of restored.workbookScripts.values()) destroyWorkbookScripts(workbook);
    });

    it('moves the name of an imported connection into the app manifest', async () => {
        const backend = new WorkbookTestBackend();
        backend.connections = [{ id: OTHER_CONNECTION_ID, params: trino('https://known'), name: 'Mine' }];
        backend.workbooks.set(TEST_WORKBOOK_ID, testWorkbook({
            ...testConnections(
                { connectionId: TEST_CONNECTION_ID, params: trino('https://unknown'), name: 'Production' },
                { connectionId: OTHER_CONNECTION_ID, params: trino('https://known'), name: 'Theirs' },
            ),
            scripts: [
                { name: '01_new.sql', connectionId: TEST_CONNECTION_ID },
                { name: '02_known.sql', connectionId: OTHER_CONNECTION_ID },
            ],
        }));
        backend.scripts.set(TEST_WORKBOOK_ID, new Map([['01_new.sql', 'SELECT 1'], ['02_known.sql', 'SELECT 2']]));
        const restored = await restoreAppState(dql, backend, new TestLogger(), () => {});

        // A new connection is registered with its name, a known connection keeps its own
        expect(restored.connectionStates.get(TEST_CONNECTION_ID)!.name).toBe('Production');
        expect(restored.connectionStates.get(OTHER_CONNECTION_ID)!.name).toBe('Mine');
        expect(backend.connections).toMatchObject([
            { id: OTHER_CONNECTION_ID, name: 'Mine' },
            { id: TEST_CONNECTION_ID, name: 'Production' },
        ]);
        // The workbook copies drop the names
        expect(backend.workbooks.get(TEST_WORKBOOK_ID)!.connections.map(connection => 'name' in connection)).toEqual([false, false]);
        for (const workbook of restored.workbookScripts.values()) destroyWorkbookScripts(workbook);
    });

    it('restores an imported workbook against the live connections and registers the unknown ones', async () => {
        const backend = new WorkbookTestBackend();
        backend.connections = [{ id: OTHER_CONNECTION_ID, params: trino('https://known') }];
        const live = await restoreAppState(dql, backend, new TestLogger(), () => {});
        backend.workbooks.set(TEST_WORKBOOK_ID, testWorkbook({
            ...testConnections(
                { connectionId: OTHER_CONNECTION_ID, params: trino('https://known') },
                { connectionId: TEST_CONNECTION_ID, params: trino('https://new') },
            ),
            scripts: [
                { name: '01_known.sql', connectionId: OTHER_CONNECTION_ID },
                { name: '02_new.sql', connectionId: TEST_CONNECTION_ID },
            ],
        }));
        backend.scripts.set(TEST_WORKBOOK_ID, new Map([['01_known.sql', 'SELECT 1'], ['02_new.sql', 'SELECT 2']]));

        const restored = await restoreSingleWorkbook(dql, backend, new TestLogger(), TEST_WORKBOOK_ID, { connections: live.connectionStates });
        expect(restored.workbookId).toBe(TEST_WORKBOOK_ID);
        expect(restored.databases.map(database => database.connectionId)).toEqual([TEST_CONNECTION_ID]);
        expect(workbookConnectionIds(restored.workbookScripts)).toEqual([OTHER_CONNECTION_ID, TEST_CONNECTION_ID]);
        destroyRestoredWorkbook(restored);
        for (const workbook of live.workbookScripts.values()) destroyWorkbookScripts(workbook);
    });

    it('rejects an imported workbook that is not stored', async () => {
        const backend = new WorkbookTestBackend();
        backend.connections = [];
        await expect(restoreSingleWorkbook(dql, backend, new TestLogger(), TEST_WORKBOOK_ID, { connections: new Map() })).rejects.toThrow();
    });
});

