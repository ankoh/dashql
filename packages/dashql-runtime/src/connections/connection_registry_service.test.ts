// The registry of connections of the runtime (ConnectionRegistryService) with the storage writer and the saving of
// connections (ConnectionPersistenceService): routing, what is persisted, the catalogs of refreshes and lookups, shared
// connections
import * as dashql from '@ankoh/dashql-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { publishCatalogBatchSync } from './catalog/catalog_batch.js';
import { generateRelationsFile, packCatalogTable, packRelationName, type RelationName } from './catalog/catalog_sql_generator.js';
import { CatalogUpdateTaskStatus, CatalogUpdateVariant, type CatalogUpdateTaskState } from './catalog/catalog_update_state.js';
import { CONNECTOR_INFOS, ConnectorType, HYPER_CONNECTOR } from './connector_info.js';
import { connectionStateDetailsOf, connectorOfParams, connectorParams } from './connector_descriptor.js';
import type { ConnectionParams } from './connection_params.js';
import { ConnectionPersistenceService, type ConnectionSaveResult } from './connection_persistence_service.js';
import { ConnectionRegistryService } from './connection_registry_service.js';
import {
    connectionEntryFromState,
    didPersistedConnectionChange,
    resolveWorkbookConnections,
    type ConnectionReferences,
    type ConnectionRegistry,
    type DynamicConnectionDispatch,
} from './connection_registry_state.js';
import {
    CATALOG_UPDATE_PARTIALLY_SUCCEEDED,
    CATALOG_UPDATE_SUCCEEDED,
    ConnectionHealth,
    createConnectionState,
    DELETE_CONNECTION,
    reduceConnectionState,
    restoreCatalogUpdates,
    SET_CONNECTION_DRAFT,
    UPDATE_CATALOG,
    type ConnectionState,
} from './connection_state.js';
import { TASK_UPDATE_SCHEDULER } from '../store/store.js';
import { groupConnectionFileWrites, StorageWriter, WRITE_CONNECTION_FILE } from '../storage/storage_writer.js';
import { fixedConnectionReferences } from '../testing/mocks/connection_references.js';
import { TestLogger } from '../testing/test_logger.js';
import { WorkbookTestBackend, TEST_CONNECTION_ID, TEST_WORKBOOK_ID, testWorkbook } from '../testing/workbook_test_backend.js';

/// Run a step of a test and wait for it
const step = async (run: () => unknown) => { await run(); };

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: dashql.DashQL;
beforeAll(async () => { dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });
afterEach(() => dql.resetUnsafe());

/// An active connection on the Rust connection of the core with a catalog as the files of a connection hold it
function catalogConnection(connectionId: string, params: ConnectionParams, catalog: {
    described?: boolean;
    relations?: string;
    functions?: string;
    gone?: RelationName[];
    running?: CatalogUpdateTaskState[];
} = {}): ConnectionState {
    const connector = connectorOfParams(params);
    const details = connectionStateDetailsOf(connector, connectorParams(connector, params));
    let state: ConnectionState = { ...createConnectionState(dql, connector.info, details, { active: true, params }), connectionId };
    if (catalog.relations != null) publishCatalogBatchSync(dql, state.catalog, [{ entryId: state.catalogRelationEntryId, text: catalog.relations }]);
    if (catalog.functions != null) state.catalogFunctionScript.replaceText(catalog.functions);
    if (catalog.gone != null) {
        state.catalog.replaceTables(state.catalogRelationEntryId, dashql.buffers.catalog.CatalogLayer.CONNECTION, { relations: catalog.gone.map(packRelationName), tables: [] });
    }
    if (catalog.described != null) restoreCatalogUpdates(state, catalog.described, null);
    for (const task of catalog.running ?? []) {
        state = reduceConnectionState(state, { type: UPDATE_CATALOG, value: [task.taskId, task] }, new TestLogger());
    }
    return state;
}

/// The registry of connections with the storage writer and the saving of connections, as the app wires them
function createRegistry(backend: WorkbookTestBackend, references: ConnectionReferences) {
    const logger = new TestLogger();
    const writer = new StorageWriter(logger, backend);
    const service = new ConnectionRegistryService({ logger, storageWriter: writer, references }, TASK_UPDATE_SCHEDULER);
    const persistence = new ConnectionPersistenceService({
        storageWriter: writer,
        readConnections: () => service.store.current,
        references,
        dispatchConnection: service.dispatch,
    });
    return {
        service,
        writer,
        setRegistry: (update: (registry: ConnectionRegistry) => ConnectionRegistry) => service.store.update(update),
        dispatch: service.dispatch as DynamicConnectionDispatch,
        save: (): Promise<ConnectionSaveResult | null> => persistence.save(TEST_CONNECTION_ID),
        persistence,
        dispose: () => service.dispose(),
    };
}

function database(connectionId: string, health: ConnectionHealth): ConnectionState {
    return { connectionId: connectionId, connectionHealth: health } as ConnectionState;
}

function registry(): ConnectionRegistry {
    return {
        connections: new Map([
            ['local', database('local', ConnectionHealth.ONLINE)],
            ['remote', database('remote', ConnectionHealth.FAILED)],
        ]),
        connectionsByType: [],
    };
}

describe('workbook connection routing', () => {
    it('resolves the connections of a workbook in the order the scripts use them', () => {
        const connections = resolveWorkbookConnections(registry(), fixedConnectionReferences({ workbook: ['remote', 'local'] }), 'workbook');
        expect(connections?.map(database => database.connectionId)).toEqual(['remote', 'local']);
        expect(connections?.[0].connectionHealth).toBe(ConnectionHealth.FAILED);
    });

    it('does not fall back to local when a configured remote is missing', () => {
        const value = registry();
        value.connections.delete('remote');
        expect(resolveWorkbookConnections(value, fixedConnectionReferences({ workbook: ['remote'] }), 'workbook')).toBeNull();
        expect(resolveWorkbookConnections(value, fixedConnectionReferences({ workbook: ['local', 'remote'] }), 'workbook')).toBeNull();
    });
});

describe('workbook manifest persistence', () => {
    const state = (active: boolean, endpoint: string): ConnectionState => ({
        active,
        params: { hyper: { protocol: 'V3_HTTP', endpoint, tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' } } },
        details: {
            type: HYPER_CONNECTOR,
            value: {
                proto: {
                    setupParams: {
                        protocol: 'HTTP',
                        endpoint,
                        tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
                    },
                },
            },
        },
    } as unknown as ConnectionState);

    it('ignores transient connection state changes', () => {
        const prev = state(true, 'https://db.example.com');
        const next = { ...prev, snapshotQueriesActiveFinished: 2 };
        expect(didPersistedConnectionChange(prev, next)).toBe(false);
    });

    it('persists activation and connection parameter changes', () => {
        expect(didPersistedConnectionChange(
            state(false, 'https://db.example.com'),
            state(true, 'https://db.example.com'),
        )).toBe(true);
        expect(didPersistedConnectionChange(
            state(true, 'https://db.example.com'),
            state(true, 'https://other.example.com'),
        )).toBe(true);
    });

    it('persists the name in the app manifest entry', () => {
        const prev = state(true, 'https://db.example.com');
        const next = { ...prev, name: 'Production' };
        expect(didPersistedConnectionChange(prev, next)).toBe(true);
        expect(connectionEntryFromState(next).name).toBe('Production');
        expect('name' in connectionEntryFromState(prev)).toBe(false);
    });

    it('persists the choice whether the connection caches query results in the app manifest entry', () => {
        const prev = state(true, 'https://db.example.com');
        const next = { ...prev, cacheQueryResults: false };
        expect(didPersistedConnectionChange(prev, next)).toBe(true);
        expect(connectionEntryFromState(next).cacheQueryResults).toBe(false);
        // A connection without a choice keeps the default of its connector
        expect('cacheQueryResults' in connectionEntryFromState(prev)).toBe(false);
    });
});

describe('catalog refresh persistence', () => {
    it.each(['succeeded', 'partially succeeded'] as const)('saves a %s Salesforce catalog without rewriting the manifest', async outcome => {
        const backend = new WorkbookTestBackend();
        backend.workbooks.set(TEST_WORKBOOK_ID, testWorkbook({
            connections: [{ connectionId: TEST_CONNECTION_ID, params: { salesforce: { instanceUrl: 'https://example.my.salesforce.com' } } as any }],
        }));
        const descriptor = new dashql.buffers.catalog.CatalogDescriptorT([packCatalogTable({
            databaseName: 'lakehouse', schemaName: 'public', tableName: 'Account__dlm', columns: [{ name: 'Id__c', ordinalPosition: 1, dataType: 'varchar' }],
        })], []);
        const schemaSQL = generateRelationsFile(descriptor);
        const functionsSQL = 'CREATE FUNCTION test() AS 1;';
        const connection = catalogConnection(TEST_CONNECTION_ID, { salesforce: { instanceUrl: 'https://example.my.salesforce.com' } } as any, {
            described: true,
            relations: schemaSQL,
            functions: functionsSQL,
            gone: [{ databaseName: 'lakehouse', schemaName: 'public', tableName: 'Gone__dlm' }],
        });
        const { setRegistry, dispatch, writer, service, dispose } = createRegistry(backend, fixedConnectionReferences({ [TEST_WORKBOOK_ID]: [TEST_CONNECTION_ID] }));
        try {
            await step(async () => setRegistry(reg => {
                reg.connections.set(TEST_CONNECTION_ID, connection);
                return { ...reg };
            }));
            expect(service.store.current.connections.get(TEST_CONNECTION_ID)).toBe(connection);
            const task = {
                taskId: 1, taskVariant: CatalogUpdateVariant.FULL_CATALOG_REFRESH,
                status: CatalogUpdateTaskStatus.STARTED, cancellation: new AbortController(),
                queries: [], error: null, startedAt: new Date(), finishedAt: null,            };
            step(() => {
                dispatch(TEST_CONNECTION_ID, { type: UPDATE_CATALOG, value: [1, task] });
                dispatch(TEST_CONNECTION_ID, outcome === 'succeeded'
                    ? { type: CATALOG_UPDATE_SUCCEEDED, value: [1] }
                    : { type: CATALOG_UPDATE_PARTIALLY_SUCCEEDED, value: [1, new Error('partial metadata')] });
            });
            await step(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
            expect(service.store.current.connections.get(TEST_CONNECTION_ID)?.catalogUpdates.tasksFinished.has(1)).toBe(true);
            // The connection owns the catalog, workbooks don't keep a copy
            expect(writer.getPendingKeysForWorkbook(TEST_WORKBOOK_ID)).toEqual([]);
            await writer.flush();
            expect(backend.calls).not.toContain(`manifest:${TEST_WORKBOOK_ID}`);
            expect(backend.connectionFiles.get(`${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`)).toBe(schemaSQL);
            expect(backend.connectionFiles.get(`${TEST_CONNECTION_ID}/dashql-catalog-functions.sql`)).toBe(functionsSQL);
            expect(JSON.parse(backend.connectionFiles.get(`${TEST_CONNECTION_ID}/dashql-catalog-state.json`)!)).toEqual({
                pending: [], gone: [{ databaseName: 'lakehouse', schemaName: 'public', tableName: 'Gone__dlm' }],
            });
        } finally {
            dispose();
        }
    });

    /// The files that a lookup leaves behind when it finishes
    async function filesAfterLookup(described: boolean, changed: boolean): Promise<WorkbookTestBackend> {
        const backend = new WorkbookTestBackend();
        backend.workbooks.set(TEST_WORKBOOK_ID, testWorkbook());
        const task = {
            taskId: 4, taskVariant: CatalogUpdateVariant.RELATION_REFRESH,
            status: CatalogUpdateTaskStatus.STARTED, cancellation: new AbortController(),
            queries: [], error: null, startedAt: new Date(), finishedAt: null,
        };
        const connection = catalogConnection(TEST_CONNECTION_ID, { hyper: { protocol: 'V3_HTTP', endpoint: 'http://hyper.example' } } as any, {
            described,
            relations: '',
            functions: 'unchanged',
            running: [task],
        });
        const { setRegistry, dispatch, writer, service, dispose } = createRegistry(backend, fixedConnectionReferences({ [TEST_WORKBOOK_ID]: [TEST_CONNECTION_ID] }));
        try {
            step(() => setRegistry(reg => {
                reg.connections.set(TEST_CONNECTION_ID, connection);
                return { ...reg };
            }));
            step(() => dispatch(TEST_CONNECTION_ID, { type: CATALOG_UPDATE_SUCCEEDED, value: [4, changed] }));
            await step(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
            await writer.flush();
            return backend;
        } finally {
            dispose();
        }
    }

    it('saves no relations before a refresh described the connection', async () => {
        const backend = await filesAfterLookup(false, true);
        expect(backend.connectionFiles.has(`${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`)).toBe(false);
        expect(backend.connectionFiles.has(`${TEST_CONNECTION_ID}/dashql-catalog-functions.sql`)).toBe(false);
        expect(JSON.parse(backend.connectionFiles.get(`${TEST_CONNECTION_ID}/dashql-catalog-state.json`)!)).toEqual({ pending: [], gone: [] });
    });

    it('saves the relations after a lookup that changed them, and never the functions', async () => {
        const backend = await filesAfterLookup(true, true);
        expect(backend.connectionFiles.has(`${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`)).toBe(true);
        expect(backend.connectionFiles.has(`${TEST_CONNECTION_ID}/dashql-catalog-functions.sql`)).toBe(false);
    });

    it('saves no relations after a lookup that changed nothing', async () => {
        const backend = await filesAfterLookup(true, false);
        expect(backend.connectionFiles.has(`${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`)).toBe(false);
        expect(backend.connectionFiles.has(`${TEST_CONNECTION_ID}/dashql-catalog-functions.sql`)).toBe(false);
        expect(backend.connectionFiles.has(`${TEST_CONNECTION_ID}/dashql-catalog-state.json`)).toBe(true);
    });

    it('saves only the functions when the embedded database refreshes', async () => {
        const backend = new WorkbookTestBackend();
        backend.workbooks.set(TEST_WORKBOOK_ID, testWorkbook());
        const functionsSQL = 'CREATE FUNCTION test() AS 1;';
        const task = {
            taskId: 3, taskVariant: CatalogUpdateVariant.FULL_CATALOG_REFRESH,
            status: CatalogUpdateTaskStatus.STARTED, cancellation: new AbortController(),
            queries: [], error: null, startedAt: new Date(), finishedAt: null,        };
        const embedded = catalogConnection(TEST_CONNECTION_ID, { hyper: { protocol: 'WASM' } } as any, {
            described: false,
            functions: functionsSQL,
            running: [task],
        });
        expect(embedded.catalogUpdates.currentFullRefresh).toBe(3);
        const { setRegistry, dispatch, writer, service, dispose } = createRegistry(backend, fixedConnectionReferences({ [TEST_WORKBOOK_ID]: [TEST_CONNECTION_ID] }));
        try {
            step(() => setRegistry(reg => {
                reg.connections.set(TEST_CONNECTION_ID, embedded);
                return { ...reg };
            }));
            step(() => dispatch(TEST_CONNECTION_ID, { type: CATALOG_UPDATE_SUCCEEDED, value: [3] }));
            await step(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
            await writer.flush();
            expect([...backend.connectionFiles.keys()]).toEqual([`${TEST_CONNECTION_ID}/dashql-catalog-functions.sql`]);
        } finally {
            dispose();
        }
    });

    it('writes the catalog of an attached connection into the files of that connection', async () => {
        const backend = new WorkbookTestBackend();
        backend.workbooks.set(TEST_WORKBOOK_ID, testWorkbook());
        const attachedId = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb';
        const functions = 'CREATE FUNCTION attached() AS 1;';
        const task = {
            taskId: 2, taskVariant: CatalogUpdateVariant.FULL_CATALOG_REFRESH,
            status: CatalogUpdateTaskStatus.STARTED, cancellation: new AbortController(),
            queries: [], error: null, startedAt: new Date(), finishedAt: null,        };
        // A catalog without relations, like one that a reset cleared meanwhile
        const attached = catalogConnection(attachedId, { salesforce: {} } as any, { described: true, functions, running: [task] });
        const { setRegistry, dispatch, writer, service, dispose } = createRegistry(backend, fixedConnectionReferences({ [TEST_WORKBOOK_ID]: [TEST_CONNECTION_ID, attachedId] }));
        try {
            step(() => setRegistry(reg => {
                reg.connections.set(attachedId, attached);
                return { ...reg };
            }));
            step(() => dispatch(attachedId, { type: CATALOG_UPDATE_SUCCEEDED, value: [2] }));
            await step(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
            expect(writer.getPendingKeysForWorkbook(TEST_WORKBOOK_ID)).toEqual([]);
            await writer.flush();
            expect([...backend.connectionFiles.keys()].every(key => key.startsWith(`${attachedId}/`))).toBe(true);
            // A catalog that a reset cleared meanwhile doesn't replace what is on disk
            expect(backend.connectionFiles.has(`${attachedId}/dashql-catalog-relations.sql`)).toBe(false);
            expect(backend.connectionFiles.get(`${attachedId}/dashql-catalog-functions.sql`)).toBe(functions);
        } finally {
            dispose();
        }
    });
});

describe('shared connection persistence', () => {
    const OTHER_WORKBOOK_ID = '22222222-3333-4444-8555-666666666666';
    const MISSING_WORKBOOK_ID = '33333333-4444-4555-8666-777777777777';
    const trino = (endpoint: string) => ({ trino: { endpoint, catalogName: '', auth: { authType: 'AUTH_BASIC' } } }) as any;

    /// Dispatch to the connection and let the batched registry update apply
    async function dispatchAndSettle(harness: { dispatch: DynamicConnectionDispatch }, action: Parameters<DynamicConnectionDispatch>[1]) {
        await step(async () => {
            harness.dispatch(TEST_CONNECTION_ID, action);
            await new Promise<void>(resolve => setTimeout(resolve, 0));
        });
    }

    async function setupRegistry(workbookIds: string[], params: ConnectionParams = trino('https://old')) {
        const backend = new WorkbookTestBackend();
        for (const workbookId of [TEST_WORKBOOK_ID, OTHER_WORKBOOK_ID]) {
            backend.workbooks.set(workbookId, testWorkbook({ workbookId, connections: [{ connectionId: TEST_CONNECTION_ID, params: trino('https://old') }] }));
        }
        const connection = catalogConnection(TEST_CONNECTION_ID, params);
        expect(connection.connectionHealth).toBe(ConnectionHealth.NOT_STARTED);
        const created = createRegistry(backend, fixedConnectionReferences(Object.fromEntries(workbookIds.map(workbookId => [workbookId, [TEST_CONNECTION_ID]]))));
        const harness = {
            get registry() { return created.service.store.current; },
            dispatch: created.dispatch,
            writer: created.writer,
            save: created.save,
            persistence: created.persistence,
        };
        await step(async () => created.setRegistry(reg => {
            reg.connections.set(TEST_CONNECTION_ID, connection);
            return { ...reg };
        }));
        return { backend, harness, unmount: created.dispose };
    }

    it('keeps drafts in the app manifest and saves them into every workbook', async () => {
        const { backend, harness, unmount } = await setupRegistry([TEST_WORKBOOK_ID, OTHER_WORKBOOK_ID]);
        try {
            await dispatchAndSettle(harness, { type: SET_CONNECTION_DRAFT, value: trino('https://new') });
            await harness.writer.flush();
            expect(backend.connections).toEqual([{ id: TEST_CONNECTION_ID, params: trino('https://old'), paramsDraft: trino('https://new') }]);
            expect(backend.calls.filter(call => call.startsWith('manifest:'))).toEqual([]);

            let result!: ConnectionSaveResult | null;
            await step(async () => {
                result = await harness.save();
                await new Promise<void>(resolve => setTimeout(resolve, 0));
            });
            expect(result!.manifest).toEqual({ status: 'written' });
            expect(result!.workbooks.map(n => [n.workbookId, n.result.status])).toEqual([
                [TEST_WORKBOOK_ID, 'written'],
                [OTHER_WORKBOOK_ID, 'written'],
            ]);
            expect(backend.connections).toEqual([{ id: TEST_CONNECTION_ID, params: trino('https://new') }]);
            for (const workbookId of [TEST_WORKBOOK_ID, OTHER_WORKBOOK_ID]) {
                expect(backend.workbooks.get(workbookId)!.connections).toEqual([{ connectionId: TEST_CONNECTION_ID, params: trino('https://new') }]);
            }
            const saved = harness.registry.connections.get(TEST_CONNECTION_ID)!;
            expect(saved.params).toEqual(trino('https://new'));
            expect(saved.paramsDraft).toBeUndefined();
        } finally {
            unmount();
        }
    });

    it('reports workbooks whose copies could not be written', async () => {
        const { backend, harness, unmount } = await setupRegistry([TEST_WORKBOOK_ID, MISSING_WORKBOOK_ID]);
        try {
            await dispatchAndSettle(harness, { type: SET_CONNECTION_DRAFT, value: trino('https://new') });
            let result!: ConnectionSaveResult | null;
            await step(async () => {
                result = await harness.save();
                await new Promise<void>(resolve => setTimeout(resolve, 0));
            });
            expect(result!.manifest.status).toBe('written');
            expect(result!.workbooks.map(n => [n.workbookId, n.result.status])).toEqual([
                [TEST_WORKBOOK_ID, 'written'],
                [MISSING_WORKBOOK_ID, 'failed'],
            ]);
            expect(backend.workbooks.has(MISSING_WORKBOOK_ID)).toBe(false);
        } finally {
            unmount();
        }
    });

    it('stops saving when a retry finds the connection gone', async () => {
        const { harness, unmount } = await setupRegistry([TEST_WORKBOOK_ID, MISSING_WORKBOOK_ID]);
        try {
            await dispatchAndSettle(harness, { type: SET_CONNECTION_DRAFT, value: trino('https://new') });
            await step(async () => { await harness.save(); });
            harness.registry.connections.delete(TEST_CONNECTION_ID);
            expect(await harness.persistence.retry(TEST_CONNECTION_ID, [MISSING_WORKBOOK_ID])).toBeNull();
            expect(harness.persistence.states.current.get(TEST_CONNECTION_ID)?.saving).toBe(false);
        } finally {
            unmount();
        }
    });

    it('refuses to delete the embedded Hyper that no workbook uses', async () => {
        const { harness, unmount } = await setupRegistry([], { hyper: { protocol: 'WASM' } } as any);
        try {
            await dispatchAndSettle(harness, { type: DELETE_CONNECTION, value: null });
            expect(harness.registry.connections.has(TEST_CONNECTION_ID)).toBe(true);
        } finally {
            unmount();
        }
    });

    it('does not recreate the folder of a connection that was deleted with a write pending', async () => {
        const backend = new WorkbookTestBackend();
        const writer = new StorageWriter(new TestLogger(), backend);
        const written = writer.write(
            groupConnectionFileWrites(TEST_CONNECTION_ID, 'dashql-catalog-state.json'),
            { type: WRITE_CONNECTION_FILE, value: [TEST_CONNECTION_ID, 'dashql-catalog-state.json', '{}'] },
            60_000,
        );
        writer.cancelPendingConnectionFileWrites(TEST_CONNECTION_ID);
        await expect(written).resolves.toBe(false);
        await writer.flush();
        expect(backend.connectionFiles.has(`${TEST_CONNECTION_ID}/dashql-catalog-state.json`)).toBe(false);
    });

    it('refuses to delete connections that workbooks use', async () => {
        const { harness, unmount } = await setupRegistry([TEST_WORKBOOK_ID]);
        try {
            await dispatchAndSettle(harness, { type: DELETE_CONNECTION, value: null });
            expect(harness.registry.connections.has(TEST_CONNECTION_ID)).toBe(true);
        } finally {
            unmount();
        }
    });
});
