// The catalog loader of the runtime (CatalogLoaderService over the loader of the Rust runtime): its queue of refreshes,
// the relations of executed statements, client functions, and what a connection that comes online gets described with.
// The queries go to a fake executor that the tests answer.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dashql from '@ankoh/dashql-core';
import type * as arrow from 'apache-arrow';

import { CatalogLoaderService } from './catalog_loader_service.js';
import { COMMIT_CONNECTION_PARAMS, HEALTH_CHECK_STARTED, HEALTH_CHECK_SUCCEEDED, RESET_CONNECTION, relationNames, type ConnectionAction } from '../connection_state.js';
import { CatalogUpdateTaskStatus, CatalogUpdateVariant, MAX_TOUCHED_ATTEMPTS } from './catalog_update_state.js';
import { ConnectorType } from '../connector_info.js';
import type { HyperConnectionParams } from '@ankoh/dashql-jsonschema/connection.js';
import { HYPER_CHANNEL_READY, HYPER_CHANNEL_SETUP_STARTED } from '../hyper/hyper_connection_state.js';
import type { HyperDatabaseChannel } from '../hyper/hyperdb_grpc_client.js';
import type { RelationName } from './catalog_sql_generator.js';
import type { QueryExecutionArgs, QueryExecutor } from '../query_execution_args.js';
import { QueryType } from '../../query/query_execution_state.js';
import { TestLogger } from '../../testing/test_logger.js';
import { tableFromArrays } from '../../testing/arrow_fixtures.js';
import type { CoreRuntime } from '../../core_runtime.js';
import { connectorState, testCoreRuntime } from '../../testing/mocks/connector_state.js';

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
    let runtime: CoreRuntime;
    let service: CatalogLoaderService;
    const queries: Array<{ args: QueryExecutionArgs; resolve: (table: arrow.Table | null) => void; reject: (error: unknown) => void }> = [];
    let dispatch: { mock: { calls: [dashql.Target, dashql.RuntimeAction][] } };
    const scriptsDispatch = vi.fn();

    /// Tell the loader that the connections changed, as the runtime does, and let it schedule
    async function handRegistry() {
        runtime.flush();
        service.follow();
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

    /// A runtime with the connection `database` of a connector and a loader on it, the queries go to the fake executor
    function setup(connectorType: ConnectorType, setupParams: object = {}) {
        runtime = testCoreRuntime(dql);
        connectorState(runtime, connectorType, setupParams, 'database');
        // Deliberately do not tell the loader on dispatch: the end of an update itself must wake the queue
        dispatch = vi.spyOn(runtime, 'dispatch') as unknown as typeof dispatch;
        const execute: QueryExecutor = (_connectionId, args) => [queries.length + 1, new Promise<arrow.Table | null>((resolve, reject) => {
            queries.push({ args, resolve, reject });
            args.abortSignal?.addEventListener('abort', () => reject(args.abortSignal!.reason), { once: true });
        })];
        runtime.execute = execute;
        service = new CatalogLoaderService({ logger: new TestLogger(), runtime, http: null, salesforce: null, onCatalogDidUpdate: scriptsDispatch });
        service.start();
    }
    async function teardown() {
        service.stop();
        for (const query of queries) query.reject(new DOMException('Test cleanup', 'AbortError'));
        await settle();
        runtime.destroy();
    }
    /// Apply an action to the connection of the runtime
    function act(action: ConnectionAction, connectionId = 'database') {
        expect(runtime.dispatchConnection(connectionId, action).ok).toBe(true);
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
        runtime.dispatch({ connection: 'database' }, { kind: 'restoreCatalogUpdates', value: { described, touchedRelations: touched == null ? undefined : relationNames(touched) } });
    }
    const updates = () => runtime.connection('database')!.catalogUpdates;
    /// The actions of a kind that were dispatched, the final status of an update narrows them
    const dispatched = (kind: dashql.RuntimeAction['kind'], status?: CatalogUpdateTaskStatus) => dispatch.mock.calls.filter(([, action]) =>
        action.kind === kind && (status == null || (action.kind === 'catalogUpdateFinished' && action.value.status === status)));

    beforeAll(async () => {
        dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
    });

    beforeEach(() => {
        queries.length = 0;
        scriptsDispatch.mockReset();
        setup(ConnectorType.HYPER);
    });

    afterEach(teardown);

    it('aborts a running refresh once, keeps a pending force, and starts its replacement after the cancellation', async () => {
        await handRegistry();
        await enqueue(false);
        expect(queries).toHaveLength(1);
        const task = runtime.handles.get<{ cancellation: AbortController }>(updates().tasksRunning[0].handle)!;
        const abort = vi.spyOn(task.cancellation, 'abort');

        await enqueue(true);
        // A request that isn't forced doesn't take the force back
        await enqueue(false);
        await handRegistry();
        expect(queries[0].args.abortSignal!.aborted).toBe(true);
        expect(queries[0].args.abortSignal!.reason.name).toBe('AbortError');
        expect(abort).toHaveBeenCalledTimes(1);
        expect(dispatched('catalogUpdateFinished', CatalogUpdateTaskStatus.CANCELLED)).toHaveLength(1);
        await vi.waitFor(() => expect(queries).toHaveLength(2));
        expect(queries[1].args.abortSignal!.aborted).toBe(false);
        expect(queries[1].args.metadata).toMatchObject({ issuer: 'Catalog Update', queryType: QueryType.CATALOG_QUERY_PG_ATTRIBUTE, userProvided: false });
        await handRegistry();
        expect(queries).toHaveLength(2);
        await answer(1, pgRows('orders'));
        expect(dispatched('catalogUpdateFinished', CatalogUpdateTaskStatus.SUCCEEDED)).toHaveLength(1);
        expect(scriptsDispatch).toHaveBeenCalledTimes(1);
        // The query is registered with the update, the relations and the bundled functions are in the catalog
        expect(dispatched('catalogUpdateRegisterQuery').map(([, action]) => (action as { value: { queryId: number } }).value.queryId)).toEqual([1, 2]);
        expect(runtime.runtime!.functionScriptText('database')).toContain('CREATE FUNCTION');
        expect(updates().described).toBe(true);
    });

    it('registers the client functions of a Salesforce connection and announces them', async () => {
        connectorState(runtime, ConnectorType.SALESFORCE_DATA_CLOUD, {}, 'salesforce');
        await handRegistry();
        await vi.waitFor(() => expect(scriptsDispatch).toHaveBeenCalledWith('salesforce'), { timeout: 5000 });
        const script = dql.createScript(runtime.catalog('salesforce')!);
        script.insertTextAt(0, 'call cdp.segment_list ();');
        script.analyze();
        expect(script.getAnalyzed().read().clientFunctionCallsLength()).toEqual(1);
        // Once
        await handRegistry();
        expect(scriptsDispatch).toHaveBeenCalledTimes(1);
    });

    it('describes a Database.com connection with the Hyper catalog of its attached database', async () => {
        await teardown();
        setup(ConnectorType.DBCOM, { databaseName: 'sales' });
        await handRegistry();
        await enqueue(true);
        expect(queries).toHaveLength(1);
        expect(queries[0].args.query).toContain('"lakehouse"."_hyper_catalog"');
        expect(queries[0].args.metadata.queryType).toBe(QueryType.CATALOG_QUERY_HYPER_CLOUD);
        await answer(0, tableFromArrays({
            schema_name: ['sales'], table_name: ['orders'], column_name: ['id'], ordinal_position: [1], data_type: ['bigint'],
        }));
        expect(dispatched('catalogUpdateFinished', CatalogUpdateTaskStatus.SUCCEEDED)).toHaveLength(1);
    });

    describe('the relations of executed statements', () => {
        const touch = () => {
            goOnline(HTTP);
            restore(true, [ORDERS]);
        };
        /// Lookups of the relations that failed, they come back every time
        const failLookups = (count: number) => {
            for (let i = 1; i <= count; ++i) {
                const handle = runtime.handles.register({ abort: () => { } });
                runtime.dispatch({ connection: 'database' }, {
                    kind: 'updateCatalog',
                    value: { taskId: 100 + i, handle, variant: CatalogUpdateVariant.RELATION_REFRESH, startedAt: Date.now(), touchedRelations: [ORDERS] },
                });
                runtime.dispatch({ connection: 'database' }, { kind: 'catalogUpdateFinished', value: { taskId: 100 + i, status: CatalogUpdateTaskStatus.FAILED, error: { message: 'down' } } });
            }
        };

        it('are asked about once the connection has room for another query', async () => {
            touch();
            const metadata = { queryType: QueryType.USER_PROVIDED, title: null, description: null, issuer: null, userProvided: true };
            const queryIds: number[] = [];
            for (let i = 0; i < 4; ++i) {
                const tracked = runtime.dispatch({ connection: 'database' }, { kind: 'trackQuery', value: { traceId: 0, text: 'select 1', metadata } });
                queryIds.push(tracked.id as number);
            }
            await handRegistry();
            expect(queries).toHaveLength(0);
            for (const queryId of queryIds) {
                runtime.dispatch({ connection: 'database' }, { kind: 'queryCancelled', value: { queryId, message: 'cancelled' } });
            }
            await handRegistry();
            await vi.waitFor(() => expect(queries).toHaveLength(1));
            expect(queries[0].args.query).toContain(`c.relname = 'orders'`);
            const started = dispatched('updateCatalog')[0][1] as { value: { variant: CatalogUpdateVariant; touchedRelations: RelationName[] } };
            expect(started.value.variant).toBe(CatalogUpdateVariant.RELATION_REFRESH);
            expect(started.value.touchedRelations).toEqual([ORDERS]);
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
        expect(dispatched('catalogUpdateFinished', CatalogUpdateTaskStatus.FAILED)).toHaveLength(1);
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
        expect(dispatched('catalogUpdateFinished', CatalogUpdateTaskStatus.SUCCEEDED)).toHaveLength(1);
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
        expect(dispatched('catalogUpdateFinished', CatalogUpdateTaskStatus.SUCCEEDED)).toHaveLength(1);
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
        act({ type: RESET_CONNECTION, value: null });
        await settle();
        expect(queries[0].args.abortSignal!.aborted).toBe(true);
        await settle();
        expect(dispatched('catalogUpdateFinished', CatalogUpdateTaskStatus.SUCCEEDED)).toHaveLength(0);
    });
});
