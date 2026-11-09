import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as dashql from '@ankoh/dashql-core';
import {
    RELATIONS_TOUCHED,
    CATALOG_UPDATE_FAILED,
    CATALOG_UPDATE_CANCELLED,
    CATALOG_UPDATE_SUCCEEDED,
    ConnectionStatus,
    createConnectionState,
    DELETE_CONNECTION,
    RESET_CONNECTION,
    reduceConnectionState,
    RENAME_CONNECTION,
    SET_CONNECTION_QUERY_RESULT_CACHING,
    SWITCH_CONNECTOR_TYPE,
    UPDATE_CATALOG,
    connectionCachesQueryResults,
    type ConnectionState,
} from './connection_state.js';
import { TestLogger } from '../platform/logger/test_logger.js';
import { CONNECTOR_INFOS, ConnectorType, TRINO_CONNECTOR } from './connector_info.js';
import { createConnectionStateDetails } from './connection_state_details.js';
import { beginCatalogBatch, publishCatalogBatch, publishCatalogBatchSync } from './catalog/catalog_batch.js';
import { CatalogUpdateTaskStatus, CatalogUpdateVariant, isCatalogOutOfDate, MAX_TOUCHED_ATTEMPTS } from './catalog/catalog_update_state.js';
import { createQueryExecutionState, QueryType } from '../query/query_execution_state.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: dashql.DashQL;

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => {
    vi.restoreAllMocks();
    dql.resetUnsafe();
});

function state(): ConnectionState {
    return { ...createConnectionState(dql, CONNECTOR_INFOS[ConnectorType.HYPER], createConnectionStateDetails(ConnectorType.HYPER)), connectionId: 'test' };
}

/// Publish the catalog scripts of a connection
function publishCatalog(database: ConnectionState, relations: string, functions: string | null = null): void {
    publishCatalogBatchSync(dql, database.catalog, [
        { entryId: database.catalogRelationEntryId, text: relations },
        ...(functions == null ? [] : [{ script: database.catalogFunctionScript, text: functions }]),
    ]);
}

describe('attached database descriptor catalogs', () => {
    it.each([RESET_CONNECTION, DELETE_CONNECTION] as const)('promptly aborts pending publishers before clearing running tasks on %s', async type => {
        const database = state();
        const controllers = [new AbortController(), new AbortController()];
        const aborts = controllers.map(controller => vi.spyOn(controller, 'abort'));
        const cleanup = vi.spyOn(database.catalog, type === RESET_CONNECTION ? 'clear' : 'destroy');
        for (const [taskId, cancellation] of controllers.entries()) {
            database.catalogUpdates.tasksRunning.set(taskId, {
                taskId,
                taskVariant: CatalogUpdateVariant.FULL_CATALOG_REFRESH,
                status: CatalogUpdateTaskStatus.STARTED,
                cancellation,
                queries: [],
                error: null,
                startedAt: new Date(),
                finishedAt: null,
            });
        }
        const publication = publishCatalogBatch(dql, database.catalog, [{
            entryId: database.catalogRelationEntryId,
            text: 'CREATE TABLE pending(id int);',
        }], {
            abortSignal: controllers[0].signal,
            processor: () => new Promise(() => {}),
        });
        const outcome = publication.then(() => 'published', error => error.name);
        const next = reduceConnectionState(database, { type, value: null }, {} as any);
        expect(controllers.every(controller => controller.signal.aborted)).toBe(true);
        for (const abort of aborts) {
            expect(abort.mock.invocationCallOrder[0]).toBeLessThan(cleanup.mock.invocationCallOrder[0]);
        }
        expect(next.catalogUpdates.tasksRunning.size).toBe(0);
        expect(next.catalogUpdates.currentFullRefresh).toBeNull();
        expect(await Promise.race([outcome, (async () => {
            for (let i = 0; i < 10; ++i) await Promise.resolve();
            return 'still pending';
        })()])).toBe('AbortError');
    });

    it.each([RESET_CONNECTION, DELETE_CONNECTION] as const)('cancels the running queries on %s', type => {
        const database = state();
        const cancellation = new AbortController();
        const query = createQueryExecutionState(1, 1, 'SELECT 1', { queryType: QueryType.USER_PROVIDED, title: null, description: null, issuer: null, userProvided: true }, cancellation);
        database.queriesActive.set(1, query);
        database.queriesActiveOrdered.push(1);
        const next = reduceConnectionState(database, { type, value: null }, {} as any);
        expect(cancellation.signal.aborted).toBe(true);
        expect(cancellation.signal.reason.name).toBe('AbortError');
        expect(next.queriesActive.size).toBe(0);
        expect(next.queriesActiveOrdered).toEqual([]);
    });

    it('drops both descriptors before destroying the function script', () => {
        const database = state();
        publishCatalog(database, 'CREATE TABLE stored(id int);', 'CREATE FUNCTION stored_fn() RETURNS bigint;');
        const drops = vi.spyOn(database.catalog, 'dropDescriptor');
        const destroyFunctions = vi.spyOn(database.catalogFunctionScript, 'destroy');
        reduceConnectionState(database, { type: DELETE_CONNECTION, value: null }, {} as any);
        expect(drops.mock.calls).toEqual([
            [database.catalogRelationEntryId],
            [database.catalogFunctionScript.catalog_entry_id],
        ]);
        expect(destroyFunctions).toHaveBeenCalledTimes(1);
    });
});

function name(schemaName: string | null, tableName: string): dashql.buffers.analyzer.QualifiedTableNameT {
    return new dashql.buffers.analyzer.QualifiedTableNameT(0, null, schemaName, tableName);
}

describe('what executed statements touched', () => {
    const logger = new TestLogger();
    const touch = (database: ConnectionState, relations: dashql.buffers.analyzer.QualifiedTableNameT[]) =>
        reduceConnectionState(database, { type: RELATIONS_TOUCHED, value: relations }, logger);
    const start = (database: ConnectionState, id: number, taskVariant: CatalogUpdateVariant) => reduceConnectionState(database, {
        type: UPDATE_CATALOG,
        value: [id, {
            taskId: id,
            taskVariant,
            status: CatalogUpdateTaskStatus.STARTED,
            cancellation: new AbortController(),
            queries: [],
            error: null,
            startedAt: new Date(),
            finishedAt: null,
            touchedRelations: database.catalogUpdates.touchedRelations,
        }],
    }, logger);
    const A = { databaseName: 'hyper', schemaName: '', tableName: 'a' };

    it('leave the schema to the connection and name every relation once', () => {
        let database = touch(state(), [name(null, 'a'), name('other', 'b')]);
        database = touch(database, [name(null, 'a')]);
        expect(database.catalogUpdates.touchedRelations).toEqual([A, { databaseName: 'hyper', schemaName: 'other', tableName: 'b' }]);
    });

    it('are taken by a catalog update that succeeds', () => {
        let database = start(touch(state(), [name(null, 'a')]), 1, CatalogUpdateVariant.RELATION_REFRESH);
        expect(database.catalogUpdates.touchedRelations).toEqual([]);
        // An update of relations is no full refresh
        expect(database.catalogUpdates.currentFullRefresh).toBeNull();
        database = reduceConnectionState(database, { type: CATALOG_UPDATE_SUCCEEDED, value: [1] }, logger);
        expect(database.catalogUpdates.touchedRelations).toEqual([]);
        expect(database.catalogUpdates.described).toBe(false);
    });

    it('have no database without a default, the statement can not have touched anything', () => {
        const database = state();
        const details = { ...database, details: { type: TRINO_CONNECTOR, value: { proto: {} } } } as unknown as ConnectionState;
        const next = touch(details, [name(null, 'a')]);
        expect(next.catalogUpdates.touchedRelations).toEqual([]);
    });

    it('come back when the update fails, until the catalog counts as out of date', () => {
        let database = touch(state(), [name(null, 'a')]);
        for (let attempt = 1; attempt <= MAX_TOUCHED_ATTEMPTS; ++attempt) {
            expect(isCatalogOutOfDate(database)).toBe(false);
            database = start(database, attempt, CatalogUpdateVariant.RELATION_REFRESH);
            database = reduceConnectionState(database, { type: CATALOG_UPDATE_FAILED, value: [attempt, new Error('down')] }, logger);
            expect(database.catalogUpdates.touchedRelations).toEqual([A]);
            expect(database.catalogUpdates.touchedFailures).toBe(attempt);
        }
        expect(isCatalogOutOfDate(database)).toBe(true);
        // The next statement tries again, as does an update that succeeds
        database = touch(database, [name(null, 'b')]);
        expect(isCatalogOutOfDate(database)).toBe(false);
    });

    it('come back without counting as a failure when the update is cancelled', () => {
        let database = start(touch(state(), [name(null, 'a')]), 1, CatalogUpdateVariant.RELATION_REFRESH);
        database = reduceConnectionState(database, { type: CATALOG_UPDATE_CANCELLED, value: [1, new Error('cancelled')] }, logger);
        expect(database.catalogUpdates.touchedRelations).toEqual([A]);
        expect(database.catalogUpdates.touchedFailures).toBe(0);
    });
});

describe('connection names', () => {
    it('trims the name, keeps the state for the same name and clears it with a blank name', () => {
        const logger = new TestLogger();
        const unnamed = state();
        const named = reduceConnectionState(unnamed, { type: RENAME_CONNECTION, value: '  Production  ' }, logger);
        expect(named.name).toBe('Production');
        expect(reduceConnectionState(named, { type: RENAME_CONNECTION, value: 'Production' }, logger)).toBe(named);
        expect(reduceConnectionState(named, { type: RENAME_CONNECTION, value: '   ' }, logger).name).toBeUndefined();
        expect(reduceConnectionState(unnamed, { type: RENAME_CONNECTION, value: '' }, logger)).toBe(unnamed);
    });

    it.each([
        [ConnectorType.HYPER, false],
        [ConnectorType.TRINO, true],
        [ConnectorType.SALESFORCE_DATA_CLOUD, true],
    ])('caches query results of %s connections by default: %s', (type, caching) => {
        const connection = createConnectionState(dql, CONNECTOR_INFOS[type], createConnectionStateDetails(type));
        expect(connection.cacheQueryResults).toBeUndefined();
        expect(connectionCachesQueryResults(connection)).toBe(caching);
    });

    it('keeps the choice whether a connection caches query results', () => {
        const logger = new TestLogger();
        const defaults = state();
        const off = reduceConnectionState(defaults, { type: SET_CONNECTION_QUERY_RESULT_CACHING, value: false }, logger);
        // The choice is kept also when it matches the default of the connector
        expect(off.cacheQueryResults).toBe(false);
        expect(reduceConnectionState(off, { type: SET_CONNECTION_QUERY_RESULT_CACHING, value: false }, logger)).toBe(off);
        const on = reduceConnectionState(off, { type: SET_CONNECTION_QUERY_RESULT_CACHING, value: true }, logger);
        expect(connectionCachesQueryResults(on)).toBe(true);
    });
});

describe('connector type switches', () => {
    it('switch an unconfigured connection to another connector', () => {
        const logger = new TestLogger();
        const hyper = state();
        expect(reduceConnectionState(hyper, { type: SWITCH_CONNECTOR_TYPE, value: ConnectorType.HYPER }, logger)).toBe(hyper);
        const trino = reduceConnectionState(hyper, { type: SWITCH_CONNECTOR_TYPE, value: ConnectorType.TRINO }, logger);
        expect(trino.connectorInfo).toBe(CONNECTOR_INFOS[ConnectorType.TRINO]);
        expect(trino.details.type).toBe(TRINO_CONNECTOR);
        expect(trino.params).toBeDefined();
    });

    it('keep the connector of a started connection', () => {
        const started = { ...state(), connectionStatus: ConnectionStatus.CHANNEL_READY };
        expect(reduceConnectionState(started, { type: SWITCH_CONNECTOR_TYPE, value: ConnectorType.TRINO }, new TestLogger())).toBe(started);
    });
});

