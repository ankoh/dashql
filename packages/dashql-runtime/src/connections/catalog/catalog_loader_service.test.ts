// The catalog loader of the runtime (CatalogLoaderService over the loader of the Rust runtime): its queue of refreshes,
// the relations of executed statements, client functions, and what a connection that comes online gets described with.
// The queries go to a fake executor that the tests answer.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dashql from '@ankoh/dashql-core';
import type * as arrow from 'apache-arrow';

import { CatalogLoaderService, type CatalogLoaderDependencies } from './catalog_loader_service.js';
import type { ConnectionRegistry, DynamicConnectionDispatch } from '../connection_registry_state.js';
import { CATALOG_UPDATE_CANCELLED, CATALOG_UPDATE_FAILED, CATALOG_UPDATE_REGISTER_QUERY, CATALOG_UPDATE_SUCCEEDED, COMMIT_CONNECTION_PARAMS,
    createConnectionState, HEALTH_CHECK_STARTED, HEALTH_CHECK_SUCCEEDED, reduceConnectionState, RESET_CONNECTION, restoreCatalogUpdates,
    UPDATE_CATALOG, type ConnectionAction, type ConnectionState } from '../connection_state.js';
import { CatalogUpdateTaskStatus, CatalogUpdateVariant, MAX_TOUCHED_ATTEMPTS } from './catalog_update_state.js';
import { CONNECTOR_INFOS, ConnectorType } from '../connector_info.js';
import { createConnectionStateDetails } from '../connection_state_details.js';
import type { HyperConnectionParams } from '@ankoh/dashql-jsonschema/connection.js';
import { HYPER_CHANNEL_READY, HYPER_CHANNEL_SETUP_STARTED } from '../hyper/hyper_connection_state.js';
import type { HyperDatabaseChannel } from '../hyper/hyperdb_grpc_client.js';
import type { RelationName } from './catalog_sql_generator.js';
import type { QueryExecutionArgs, QueryExecutor } from '../query_execution_args.js';
import { createQueryExecutionState, EXECUTE_QUERY, QUERY_CANCELLED, QueryType } from '../../query/query_execution_state.js';
import { LoggableException } from '../../platform/logger/logger.js';
import { TestLogger } from '../../testing/test_logger.js';
import { tableFromArrays } from '../../testing/arrow_fixtures.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: dashql.DashQL;

const HTTP = { protocol: 'V3_HTTP', endpoint: 'http://hyper.example' } as HyperConnectionParams;
const ORDERS = { databaseName: 'hyper', schemaName: '', tableName: 'orders' };

/// Let the loader and its tasks run
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/// The rows of pg_attribute of a table
const pgRows = (table: string) => tableFromArrays({
    table_schema: ['public'],
    table_name: [table],
    column_name: ['id'],
    ordinal_position: [1],
    data_type: ['int8'],
});

describe('CatalogLoaderService', () => {
    let registry: ConnectionRegistry;
    let service: CatalogLoaderService;
    const queries: Array<{ args: QueryExecutionArgs; resolve: (table: arrow.Table | null) => void; reject: (error: unknown) => void }> = [];
    const dispatch = vi.fn<DynamicConnectionDispatch>();
    const scriptsDispatch = vi.fn();

    /// Hand the loader the current registry, as the runtime does when it changes, and let it schedule
    async function handRegistry() {
        registry = { ...registry };
        service.setRegistry(registry);
        await settle();
    }
    async function enqueue(force: boolean) {
        service.enqueue('database', force);
        await settle();
    }
    async function answer(index: number, table: arrow.Table | null) {
        queries[index].resolve(table);
        await settle();
        await settle();
    }

    function connectionOf(connectorType: ConnectorType, setupParams: object = {}): ConnectionState {
        const details = createConnectionStateDetails(connectorType);
        (details.value.proto as { setupParams?: object }).setupParams = setupParams;
        return { ...createConnectionState(dql, CONNECTOR_INFOS[connectorType], details), connectionId: 'database' };
    }
    /// Apply an action to the connection of the registry
    function act(action: ConnectionAction, connectionId = 'database') {
        registry.connections.set(connectionId, reduceConnectionState(registry.connections.get(connectionId)!, action, new TestLogger()));
    }
    function connect(params: HyperConnectionParams) {
        act({ type: COMMIT_CONNECTION_PARAMS, value: { hyper: params } });
        act({ type: HYPER_CHANNEL_SETUP_STARTED, value: params });
        act({ type: HYPER_CHANNEL_READY, value: [{ close: vi.fn() } as unknown as HyperDatabaseChannel, params] });
    }
    function goOnline(params: HyperConnectionParams) {
        connect(params);
        act({ type: HEALTH_CHECK_SUCCEEDED, value: null });
    }
    function restore(described: boolean, touched: RelationName[] | null = null) {
        registry.connections.set('database', restoreCatalogUpdates(registry.connections.get('database')!, described, touched));
    }
    const updates = () => registry.connections.get('database')!.catalogUpdates;
    const dispatched = (type: symbol) => dispatch.mock.calls.filter(([, action]) => action.type === type);

    beforeAll(async () => {
        dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
    });

    beforeEach(() => {
        queries.length = 0;
        dispatch.mockReset();
        scriptsDispatch.mockReset();
        registry = { connections: new Map([['database', connectionOf(ConnectorType.HYPER)]]), connectionsByType: [] };
        // Deliberately do not hand over a new registry on dispatch: the end of an update itself must wake the queue
        dispatch.mockImplementation((id, action) => {
            registry.connections.set(id!, reduceConnectionState(registry.connections.get(id!)!, action, new TestLogger()));
        });
        const execute: QueryExecutor = (_connectionId, args) => [queries.length + 1, new Promise<arrow.Table | null>((resolve, reject) => {
            queries.push({ args, resolve, reject });
            args.abortSignal?.addEventListener('abort', () => reject(args.abortSignal!.reason), { once: true });
        })];
        const dependencies: CatalogLoaderDependencies = {
            logger: new TestLogger(),
            dispatchConnection: dispatch,
            execute,
            http: null,
            salesforce: null,
            onCatalogDidUpdate: scriptsDispatch,
        };
        service = new CatalogLoaderService(dependencies);
        service.start();
    });

    afterEach(async () => {
        service.stop();
        for (const query of queries) query.reject(new DOMException('Test cleanup', 'AbortError'));
        await settle();
        dql.resetUnsafe();
    });

    it('aborts a running refresh once, keeps a pending force, and starts its replacement after the cancellation', async () => {
        await handRegistry();
        await enqueue(false);
        expect(queries).toHaveLength(1);
        const task = updates().tasksRunning.values().next().value!;
        const abort = vi.spyOn(task.cancellation, 'abort');

        await enqueue(true);
        // A request that isn't forced doesn't take the force back
        await enqueue(false);
        await handRegistry();
        expect(queries[0].args.abortSignal!.aborted).toBe(true);
        expect(queries[0].args.abortSignal!.reason.name).toBe('AbortError');
        expect(abort).toHaveBeenCalledTimes(1);
        expect(dispatched(CATALOG_UPDATE_CANCELLED)).toHaveLength(1);
        await vi.waitFor(() => expect(queries).toHaveLength(2));
        expect(queries[1].args.abortSignal!.aborted).toBe(false);
        expect(queries[1].args.metadata).toMatchObject({ issuer: 'Catalog Update', queryType: QueryType.CATALOG_QUERY_PG_ATTRIBUTE, userProvided: false });
        await handRegistry();
        expect(queries).toHaveLength(2);
        await answer(1, pgRows('orders'));
        expect(dispatched(CATALOG_UPDATE_SUCCEEDED)).toHaveLength(1);
        expect(scriptsDispatch).toHaveBeenCalledTimes(1);
        // The query is registered with the update, the relations and the bundled functions are in the catalog
        expect(dispatched(CATALOG_UPDATE_REGISTER_QUERY).map(([, action]) => (action.value as number[])[1])).toEqual([1, 2]);
        expect(registry.connections.get('database')!.catalogFunctionScript.toString()).toContain('CREATE FUNCTION');
        expect(updates().described).toBe(true);
    });

    it('registers the client functions of a Salesforce connection and announces them', async () => {
        const salesforce = { ...connectionOf(ConnectorType.SALESFORCE_DATA_CLOUD), connectionId: 'salesforce' };
        registry.connections.set('salesforce', salesforce);
        await handRegistry();
        await vi.waitFor(() => expect(scriptsDispatch).toHaveBeenCalledWith('salesforce'), { timeout: 5000 });
        const script = dql.createScript(salesforce.catalog);
        script.insertTextAt(0, 'call cdp.segment_list ();');
        script.analyze();
        expect(script.getAnalyzed().read().clientFunctionCallsLength()).toEqual(1);
        // Once
        await handRegistry();
        expect(scriptsDispatch).toHaveBeenCalledTimes(1);
    });

    it('describes a Database.com connection with the Hyper catalog of its attached database', async () => {
        registry.connections.set('database', connectionOf(ConnectorType.DBCOM, { databaseName: 'sales' }));
        await handRegistry();
        await enqueue(true);
        expect(queries).toHaveLength(1);
        expect(queries[0].args.query).toContain('"lakehouse"."_hyper_catalog"');
        expect(queries[0].args.metadata.queryType).toBe(QueryType.CATALOG_QUERY_HYPER_CLOUD);
        await answer(0, tableFromArrays({
            schema_name: ['sales'], table_name: ['orders'], column_name: ['id'], ordinal_position: [1], data_type: ['bigint'],
        }));
        expect(dispatched(CATALOG_UPDATE_SUCCEEDED)).toHaveLength(1);
    });

    describe('the relations of executed statements', () => {
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

        it('are asked about once the connection has room for another query', async () => {
            touch();
            const metadata = { queryType: QueryType.USER_PROVIDED, title: null, description: null, issuer: null, userProvided: true };
            for (const queryId of [1, 2, 3, 4]) {
                act({ type: EXECUTE_QUERY, value: [queryId, createQueryExecutionState(queryId, 0, 'select 1', metadata, new AbortController())] });
            }
            await handRegistry();
            expect(queries).toHaveLength(0);
            for (const queryId of [1, 2, 3, 4]) {
                act({ type: QUERY_CANCELLED, value: [queryId, new LoggableException('cancelled'), null] });
            }
            await handRegistry();
            await vi.waitFor(() => expect(queries).toHaveLength(1));
            expect(queries[0].args.query).toContain(`c.relname = 'orders'`);
            const started = dispatched(UPDATE_CATALOG)[0][1] as { value: [number, { taskVariant: CatalogUpdateVariant; touchedRelations: RelationName[] }] };
            expect(started.value[1].taskVariant).toBe(CatalogUpdateVariant.RELATION_REFRESH);
            expect(started.value[1].touchedRelations).toEqual([ORDERS]);
            await answer(0, pgRows('orders'));
            expect(scriptsDispatch).toHaveBeenCalledTimes(1);
            expect(updates().touchedRelations).toEqual([]);
        });

        it('wait for a running refresh that may have read them too early', async () => {
            await handRegistry();
            await enqueue(false);
            expect(queries).toHaveLength(1);
            expect(queries[0].args.query).not.toContain('orders');
            touch();
            await handRegistry();
            expect(queries).toHaveLength(1);
            await answer(0, pgRows('customers'));
            await vi.waitFor(() => expect(queries).toHaveLength(2));
            expect(queries[1].args.query).toContain(`c.relname = 'orders'`);
        });

        it('are asked about again when the update failed', async () => {
            touch();
            await handRegistry();
            await vi.waitFor(() => expect(queries).toHaveLength(1));
            queries[0].reject(new Error('down'));
            await settle();
            await settle();
            expect(updates().touchedRelations).toEqual([ORDERS]);
            expect(updates().touchedFailures).toBe(1);
            // Not right away
            await handRegistry();
            expect(queries).toHaveLength(1);
            await vi.waitFor(() => expect(queries).toHaveLength(2), { timeout: 5000 });
            expect(queries[1].args.query).toContain(`c.relname = 'orders'`);
            await answer(1, pgRows('orders'));
            expect(updates().touchedFailures).toBe(0);
        });

        it('stop being asked about when the attempts are used up', async () => {
            touch();
            failLookups(MAX_TOUCHED_ATTEMPTS);
            expect(updates().touchedFailures).toBe(MAX_TOUCHED_ATTEMPTS);
            await handRegistry();
            await settle();
            expect(queries).toHaveLength(0);
        });
    });

    it('tries a request once more after a failure, without another registry or request', async () => {
        await handRegistry();
        await enqueue(true);
        await enqueue(false);
        expect(queries).toHaveLength(1);
        queries[0].reject(new Error('metadata unavailable'));
        await settle();
        expect(dispatched(CATALOG_UPDATE_FAILED)).toHaveLength(1);
        expect(scriptsDispatch).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(queries).toHaveLength(2));
        await answer(1, pgRows('orders'));
        await handRegistry();
        expect(queries).toHaveLength(2);
    });

    it('runs a forced refresh ahead of a lookup that keeps coming back', async () => {
        goOnline(HTTP);
        restore(true, [ORDERS]);
        await handRegistry();
        await vi.waitFor(() => expect(queries).toHaveLength(1));
        expect(queries[0].args.query).toContain(`c.relname = 'orders'`);

        // The forced refresh cancels the lookup, which gives its relation back
        await enqueue(true);
        expect(queries[0].args.abortSignal!.aborted).toBe(true);
        await vi.waitFor(() => expect(queries).toHaveLength(2));
        expect(queries[1].args.query).not.toContain('orders');

        // The lookup follows the refresh
        await answer(1, pgRows('customers'));
        await vi.waitFor(() => expect(queries).toHaveLength(3));
        expect(queries[2].args.query).toContain(`c.relname = 'orders'`);
    });

    it('consumes a queued request after a refresh without cancelling a later forced refresh', async () => {
        await handRegistry();
        await enqueue(true);
        await enqueue(false);
        await answer(0, pgRows('orders'));
        expect(dispatched(CATALOG_UPDATE_SUCCEEDED)).toHaveLength(1);
        expect(queries).toHaveLength(1);
        expect(scriptsDispatch).toHaveBeenCalledTimes(1);
        await handRegistry();
        expect(queries).toHaveLength(1);

        await enqueue(true);
        await handRegistry();
        expect(queries).toHaveLength(2);
        expect(queries[1].args.abortSignal!.aborted).toBe(false);
        await answer(1, pgRows('orders'));
        expect(scriptsDispatch).toHaveBeenCalledTimes(2);
    });

    it('refreshes the catalog of an embedded database whenever it comes online', async () => {
        goOnline({ protocol: 'WASM' } as HyperConnectionParams);
        await handRegistry();
        await vi.waitFor(() => expect(queries).toHaveLength(1));
        await answer(0, pgRows('orders'));
        // The embedded database reads its functions from pg_proc
        expect(queries).toHaveLength(2);
        expect(queries[1].args.metadata.queryType).toBe(QueryType.CATALOG_QUERY_PG_PROC);
        await answer(1, null);
        expect(dispatched(CATALOG_UPDATE_SUCCEEDED)).toHaveLength(1);
        await handRegistry();
        expect(queries).toHaveLength(2);

        // A reconnect describes the database again
        act({ type: HEALTH_CHECK_STARTED, value: null });
        await handRegistry();
        act({ type: HEALTH_CHECK_SUCCEEDED, value: null });
        await handRegistry();
        await vi.waitFor(() => expect(queries).toHaveLength(3));
    });

    it('keeps the restored catalog of a durable connection when it comes online', async () => {
        goOnline(HTTP);
        restore(true);
        await handRegistry();
        await settle();
        expect(queries).toHaveLength(0);
    });

    it('asks a restored catalog only about what it has not answered yet', async () => {
        connect(HTTP);
        restore(true, [ORDERS]);
        await handRegistry();
        await settle();
        expect(queries).toHaveLength(0);
        act({ type: HEALTH_CHECK_SUCCEEDED, value: null });
        await handRegistry();
        await vi.waitFor(() => expect(queries).toHaveLength(1));
        expect(queries[0].args.query).toContain(`c.relname = 'orders'`);
    });

    it('describes the catalog of a durable connection without one when it comes online', async () => {
        goOnline(HTTP);
        await handRegistry();
        await vi.waitFor(() => expect(queries).toHaveLength(1));
    });

    it('cancels an update when its connection is reset and publishes nothing', async () => {
        await handRegistry();
        await enqueue(true);
        expect(queries).toHaveLength(1);
        dispatch('database', { type: RESET_CONNECTION, value: null });
        await settle();
        expect(queries[0].args.abortSignal!.aborted).toBe(true);
        await settle();
        expect(dispatched(CATALOG_UPDATE_SUCCEEDED)).toHaveLength(0);
    });
});
