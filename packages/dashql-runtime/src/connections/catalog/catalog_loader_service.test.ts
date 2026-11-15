// The catalog loader of the runtime (CatalogLoaderService): its queue of refreshes, the relations of executed statements,
// client functions, and what a connection that comes online gets described with
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dashql from '@ankoh/dashql-core';

import { CatalogLoaderService, type CatalogLoaderDependencies } from './catalog_loader_service.js';
import type { ConnectionRegistry, DynamicConnectionDispatch } from '../connection_registry_state.js';
import { CATALOG_UPDATE_CANCELLED, CATALOG_UPDATE_FAILED, CATALOG_UPDATE_SUCCEEDED, COMMIT_CONNECTION_PARAMS,
    createConnectionState, HEALTH_CHECK_SUCCEEDED, reduceConnectionState, restoreCatalogUpdates,
    UPDATE_CATALOG, ConnectionHealth, type ConnectionAction, type ConnectionState, type CatalogAction } from '../connection_state.js';
import { CatalogUpdateTaskStatus, CatalogUpdateVariant, MAX_TOUCHED_ATTEMPTS } from './catalog_update_state.js';
import { CONNECTOR_INFOS, ConnectorType, HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, DBCOM_CONNECTOR } from '../connector_info.js';
import type { ConnectionStateDetailsVariant } from '../connection_state_details.js';
import type { HyperConnectionParams } from '@ankoh/dashql-jsonschema/connection.js';
import { HYPER_CHANNEL_READY, HYPER_CHANNEL_SETUP_STARTED } from '../hyper/hyper_connection_state.js';
import type { HyperDatabaseChannel } from '../hyper/hyperdb_grpc_client.js';
import type { RelationName } from './catalog_sql_generator.js';
import type { QueryExecutor } from '../query_execution_args.js';
import { createQueryExecutionState, EXECUTE_QUERY, QUERY_CANCELLED, QueryType } from '../../query/query_execution_state.js';
import { LoggableException } from '../../platform/logger/logger.js';
import { TestLogger } from '../../testing/test_logger.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: dashql.DashQL;

const HTTP = { protocol: 'V3_HTTP', endpoint: 'http://hyper.example' } as HyperConnectionParams;

/// Run a step of a test and wait for it
const step = async (run: () => unknown) => { await run(); };

describe('CatalogLoaderService queue', () => {
    let registry: ConnectionRegistry;
    let service: CatalogLoaderService | null = null;
    let enqueue: CatalogLoaderService['enqueue'];
    let dependencies: CatalogLoaderDependencies;
    const updates: Array<{ signal: AbortSignal; resolve: () => void; reject: (error: Error) => void }> = [];
    const dispatch = vi.fn<DynamicConnectionDispatch>();
    const scriptsDispatch = vi.fn();
    const updateHyperCatalog = vi.fn<CatalogLoaderDependencies['updateHyperCatalog']>();

    /// Hand the loader the current registry, as the runtime does when it changes, and let it schedule
    async function handRegistry() {
        if (service == null) {
            service = new CatalogLoaderService(dependencies);
            service.start();
            enqueue = service.enqueue;
        }
        service.setRegistry(registry);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
    }

    async function settleUpdate(settle: () => void) {
        await step(async () => {
            settle();
            // The update finishes in microtasks, then the loader reconsiders its queue in one more microtask and may
            // start the next update. A task turn lets all of them run.
            await new Promise<void>(resolve => setTimeout(resolve, 0));
        });
    }

    /// A connection on the Rust connection of the core
    function connectionOf(type: symbol, connectorType: ConnectorType, setupParams: object): ConnectionState {
        const details = { type, value: { proto: { setupParams } } } as unknown as ConnectionStateDetailsVariant;
        return { ...createConnectionState(dql, CONNECTOR_INFOS[connectorType], details), connectionId: 'database' };
    }
    /// Apply an action to the connection of the registry
    function act(action: ConnectionAction) {
        registry.connections.set('database', reduceConnectionState(registry.connections.get('database')!, action, new TestLogger()));
        registry = { ...registry };
    }
    /// Set up the connection with params up to the health check
    function connect(params: HyperConnectionParams) {
        act({ type: COMMIT_CONNECTION_PARAMS, value: { hyper: params } });
        act({ type: HYPER_CHANNEL_SETUP_STARTED, value: params });
        act({ type: HYPER_CHANNEL_READY, value: [{ close: vi.fn() } as unknown as HyperDatabaseChannel, params] });
    }
    /// Bring the connection online with params
    function goOnline(params: HyperConnectionParams) {
        connect(params);
        act({ type: HEALTH_CHECK_SUCCEEDED, value: null });
    }
    /// Restore the catalog updates as the files of a catalog hold them
    function restore(described: boolean, touched: RelationName[] | null = null) {
        restoreCatalogUpdates(registry.connections.get('database')!, described, touched);
        registry = { ...registry };
    }

    beforeAll(async () => {
        dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
    });

    beforeEach(() => {
        service = null;
        updates.length = 0;
        dispatch.mockReset();
        scriptsDispatch.mockReset();
        updateHyperCatalog.mockReset();
        const connection = connectionOf(HYPER_CONNECTOR, ConnectorType.HYPER, {});
        registry = {
            connections: new Map([['database', connection]]),
            connectionsByType: [],
        };
        // Deliberately do not hand over a new registry on dispatch: completion itself must wake the queue.
        dispatch.mockImplementation((id, action) => {
            registry.connections.set(id!, reduceConnectionState(
                registry.connections.get(id!)!, action as CatalogAction, new TestLogger(),
            ));
        });
        updateHyperCatalog.mockImplementation((...args) => new Promise((resolve, reject) => {
            updates.push({
                signal: args[11],
                resolve: () => resolve({ updatedDatabases: ['database'], failures: [] }),
                reject,
            });
        }));
        dependencies = {
            logger: new TestLogger(),
            dispatchConnection: dispatch,
            execute: vi.fn() as unknown as QueryExecutor,
            salesforce: null as unknown as CatalogLoaderDependencies['salesforce'],
            updateHyperCatalog,
            onCatalogDidUpdate: scriptsDispatch,
        };
    });

    afterEach(async () => {
        service?.stop();
        for (const update of updates) update.reject(new DOMException('Test cleanup', 'AbortError'));
        vi.restoreAllMocks();
        // The rejected updates settle before the connections go
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        dql.resetUnsafe();
    });

    it('aborts a running refresh once, preserves pending force, and starts its replacement after cancellation settles', async () => {
        await handRegistry();
        await step(async () => enqueue('database', false));
        expect(updateHyperCatalog).toHaveBeenCalledTimes(1);
        const first = updates[0];
        const task = registry.connections.get('database')!.catalogUpdates.tasksRunning.values().next().value!;
        const abort = vi.spyOn(task.cancellation, 'abort');

        await step(async () => enqueue('database', true));
        expect(first.signal.aborted).toBe(true);
        expect(first.signal.reason.name).toBe('AbortError');
        expect(updateHyperCatalog).toHaveBeenCalledTimes(1);
        // An auto request cannot downgrade force while cancellation is still pending.
        await step(async () => enqueue('database', false));
        registry = { ...registry };
        await handRegistry();
        expect(abort).toHaveBeenCalledTimes(1);
        expect(updateHyperCatalog).toHaveBeenCalledTimes(1);

        await settleUpdate(() => first.reject(first.signal.reason));
        expect(updateHyperCatalog).toHaveBeenCalledTimes(2);
        expect(updates[1].signal.aborted).toBe(false);
        expect(dispatch.mock.calls.some(([, action]) => action.type === CATALOG_UPDATE_CANCELLED)).toBe(true);
        registry = { ...registry };
        await handRegistry();
        expect(updates[1].signal.aborted).toBe(false);
        expect(updateHyperCatalog).toHaveBeenCalledTimes(2);
        await settleUpdate(() => updates[1].resolve());
        expect(scriptsDispatch).toHaveBeenCalledTimes(1);
    });

    it('registers the client functions of a connection and announces them', async () => {
        const registerClientFunctions = vi.fn(() => 'cdp');
        registry.connections.set('salesforce', {
            connectionId: 'salesforce',
            connectorInfo: {},
            details: { type: SALESFORCE_DATA_CLOUD_CONNECTOR, value: { proto: { setupParams: {} } } },
            catalog: { registerClientFunctions, version: () => 0 },
            catalogUpdates: { tasksRunning: new Map(), touchedRelations: [] },
            queriesActive: new Map(),
        } as unknown as ConnectionState);
        await handRegistry();
        await vi.waitFor(() => expect(registerClientFunctions).toHaveBeenCalledTimes(1), { timeout: 5000 });
        await vi.waitFor(() => expect(scriptsDispatch).toHaveBeenCalledWith('salesforce'));
    });

    it('describes a Database.com connection with the Hyper catalog of its attached database', async () => {
        registry.connections.set('database', connectionOf(DBCOM_CONNECTOR, ConnectorType.DBCOM, { databaseName: 'sales' }));
        await handRegistry();
        await step(async () => enqueue('database', true));
        expect(updateHyperCatalog).toHaveBeenCalledTimes(1);
        expect(updateHyperCatalog.mock.calls[0][4]).toEqual([{ path: 'hyper.cloud:sales', alias: 'lakehouse' }]);
        expect(updateHyperCatalog.mock.calls[0][10]).toBe(false);
        await settleUpdate(() => updates[0].resolve());
        expect(dispatch.mock.calls.some(([, action]) => action.type === CATALOG_UPDATE_SUCCEEDED)).toBe(true);
    });

    describe('the relations of executed statements', () => {
        const ORDERS = { databaseName: 'hyper', schemaName: '', tableName: 'orders' };
        const touch = () => {
            goOnline(HTTP);
            restore(true, [ORDERS]);
        };
        /// Lookups of the relations that failed, they come back every time
        const failLookups = (count: number) => {
            for (let i = 1; i <= count; ++i) {
                act({ type: UPDATE_CATALOG, value: [100 + i, {
                    taskId: 100 + i,
                    taskVariant: CatalogUpdateVariant.RELATION_REFRESH,
                    status: CatalogUpdateTaskStatus.STARTED,
                    cancellation: new AbortController(),
                    queries: [],
                    error: null,
                    startedAt: new Date(),
                    finishedAt: null,
                    touchedRelations: [ORDERS],
                }] });
                act({ type: CATALOG_UPDATE_FAILED, value: [100 + i, new Error('down')] });
            }
        };
        const relationsOfCall = (call: number) => updateHyperCatalog.mock.calls[call][13];

        it('are asked about once the connection has room for another query', async () => {
            touch();
            const metadata = { queryType: QueryType.USER_PROVIDED, title: null, description: null, issuer: null, userProvided: true };
            for (const queryId of [1, 2, 3, 4]) {
                act({ type: EXECUTE_QUERY, value: [queryId, createQueryExecutionState(queryId, 0, 'select 1', metadata, new AbortController())] });
            }
            await handRegistry();
            expect(updateHyperCatalog).not.toHaveBeenCalled();
            for (const queryId of [1, 2, 3, 4]) {
                act({ type: QUERY_CANCELLED, value: [queryId, new LoggableException('cancelled'), null] });
            }
            await handRegistry();
            await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(1));
            expect(relationsOfCall(0)).toEqual([ORDERS]);
            const started = dispatch.mock.calls.find(([, action]) => action.type === UPDATE_CATALOG)![1] as { value: [number, { taskVariant: CatalogUpdateVariant }] };
            expect(started.value[1].taskVariant).toBe(CatalogUpdateVariant.RELATION_REFRESH);
            await settleUpdate(() => updates[0].resolve());
            expect(scriptsDispatch).toHaveBeenCalledTimes(1);
        });

        it('wait for a running refresh that may have read them too early', async () => {
            await handRegistry();
            await step(async () => enqueue('database', false));
            expect(updateHyperCatalog).toHaveBeenCalledTimes(1);
            expect(relationsOfCall(0)).toBeNull();
            touch();
            await handRegistry();
            expect(updateHyperCatalog).toHaveBeenCalledTimes(1);
            await settleUpdate(() => updates[0].resolve());
            await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(2));
            expect(relationsOfCall(1)).toEqual([ORDERS]);
            await settleUpdate(() => updates[1].resolve());
        });

        it('are asked about again when the update failed', async () => {
            touch();
            await handRegistry();
            await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(1));
            await settleUpdate(() => updates[0].reject(new Error('down')));
            expect(registry.connections.get('database')!.catalogUpdates.touchedRelations).toEqual([ORDERS]);
            expect(registry.connections.get('database')!.catalogUpdates.touchedFailures).toBe(1);
            // Not right away
            registry = { ...registry };
            await handRegistry();
            expect(updateHyperCatalog).toHaveBeenCalledTimes(1);
            registry = { ...registry };
            await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(2), { timeout: 5000 });
            expect(relationsOfCall(1)).toEqual([ORDERS]);
            await settleUpdate(() => updates[1].resolve());
            expect(registry.connections.get('database')!.catalogUpdates.touchedFailures).toBe(0);
        });

        it('stop being asked about when the attempts are used up', async () => {
            touch();
            failLookups(MAX_TOUCHED_ATTEMPTS);
            expect(registry.connections.get('database')!.catalogUpdates.touchedFailures).toBe(MAX_TOUCHED_ATTEMPTS);
            await handRegistry();
            await step(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
            expect(updateHyperCatalog).not.toHaveBeenCalled();
        });
    });

    it('tries an auto request once more after a failure, without a registry rerender or another enqueue', async () => {
        await handRegistry();
        await step(async () => enqueue('database', true));
        await step(async () => enqueue('database', false));
        expect(updates[0].signal.aborted).toBe(false);
        expect(updateHyperCatalog).toHaveBeenCalledTimes(1);
        await settleUpdate(() => updates[0].reject(new Error('metadata unavailable')));
        expect(dispatch.mock.calls.some(([, action]) => action.type === CATALOG_UPDATE_FAILED)).toBe(true);
        expect(scriptsDispatch).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(2));
        await settleUpdate(() => updates[1].resolve());
        registry = { ...registry };
        await handRegistry();
        expect(updateHyperCatalog).toHaveBeenCalledTimes(2);
    });

    it('runs a forced refresh ahead of a lookup that keeps coming back', async () => {
        const ORDERS = { databaseName: 'hyper', schemaName: '', tableName: 'orders' };
        goOnline(HTTP);
        restore(true, [ORDERS]);
        await handRegistry();
        await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(1));
        expect(updateHyperCatalog.mock.calls[0][13]).toEqual([ORDERS]);

        // The forced refresh cancels the lookup, which gives its relation back
        await step(async () => enqueue('database', true));
        expect(updates[0].signal.aborted).toBe(true);
        await settleUpdate(() => updates[0].reject(new DOMException('cancelled', 'AbortError')));
        await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(2));
        expect(updateHyperCatalog.mock.calls[1][13]).toBeNull();

        // The lookup follows the refresh
        await settleUpdate(() => updates[1].resolve());
        await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(3));
        expect(updateHyperCatalog.mock.calls[2][13]).toEqual([ORDERS]);
        await settleUpdate(() => updates[2].resolve());
    });

    it('consumes a queued auto request after success without cancelling a later forced refresh', async () => {
        await handRegistry();
        await step(async () => enqueue('database', true));
        await step(async () => enqueue('database', false));
        await settleUpdate(() => updates[0].resolve());
        expect(dispatch.mock.calls.some(([, action]) => action.type === CATALOG_UPDATE_SUCCEEDED)).toBe(true);
        expect(updateHyperCatalog).toHaveBeenCalledTimes(1);
        expect(scriptsDispatch).toHaveBeenCalledTimes(1);
        registry = { ...registry };
        await handRegistry();
        expect(updateHyperCatalog).toHaveBeenCalledTimes(1);

        await step(async () => enqueue('database', true));
        registry = { ...registry };
        await handRegistry();
        expect(updateHyperCatalog).toHaveBeenCalledTimes(2);
        expect(updates[1].signal.aborted).toBe(false);
        await settleUpdate(() => updates[1].resolve());
        expect(scriptsDispatch).toHaveBeenCalledTimes(2);
    });
    it('refreshes the catalog of an embedded database whenever it comes online', async () => {
        goOnline({ protocol: 'WASM' } as HyperConnectionParams);
        // The request is enqueued by an effect, its update starts with a later render
        await handRegistry();
        await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(1));
        await settleUpdate(() => updates[0].resolve());
        registry = { ...registry };
        await handRegistry();
        expect(updateHyperCatalog).toHaveBeenCalledTimes(1);

        // A reconnect describes the database again
        const online = registry.connections.get('database')!;
        registry.connections.set('database', { ...online, connectionHealth: ConnectionHealth.CONNECTING });
        registry = { ...registry };
        await handRegistry();
        registry.connections.set('database', online);
        registry = { ...registry };
        await handRegistry();
        await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(2));
    });

    it('keeps the restored catalog of a durable connection when it comes online', async () => {
        goOnline(HTTP);
        restore(true);
        await handRegistry();
        await step(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
        expect(updateHyperCatalog).not.toHaveBeenCalled();
    });

    it('asks a restored catalog only about what it has not answered yet', async () => {
        const ORDERS = { databaseName: 'hyper', schemaName: '', tableName: 'orders' };
        connect(HTTP);
        restore(true, [ORDERS]);
        expect(registry.connections.get('database')!.connectionHealth).toBe(ConnectionHealth.CONNECTING);
        await handRegistry();
        await step(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
        expect(updateHyperCatalog).not.toHaveBeenCalled();
        act({ type: HEALTH_CHECK_SUCCEEDED, value: null });
        await handRegistry();
        await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(1));
        expect(updateHyperCatalog.mock.calls[0][13]).toEqual([ORDERS]);
        await settleUpdate(() => updates[0].resolve());
    });

    it('describes the catalog of a durable connection without one when it comes online', async () => {
        goOnline(HTTP);
        await handRegistry();
        await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(1));
    });
});
