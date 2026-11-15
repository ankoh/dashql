import type * as arrow from 'apache-arrow';
import type * as core from '@ankoh/dashql-core';

import type { LoggableException } from '../platform/logger/logger.js';
import type { QueryExecutionProgress, QueryExecutionState } from '../query/query_execution_state.js';
import { QueryProjection, queryRecord, updateQueryRecordProgress, type NativeQueryObjects, type QueryRecord } from '../query/query_history_native.js';
import { share } from '../store/projection.js';
import type { CatalogUpdateTaskState } from './catalog/catalog_update_state.js';
import type { RelationName } from './catalog/catalog_sql_generator.js';
import type { ConnectionParams } from './connection_params.js';
import type { ConnectionStateDetailsVariant } from './connection_state_details.js';
import type { CatalogUpdates, ConnectionState } from './connection_state.js';
import { CONNECTOR_INFOS, ConnectorType, DBCOM_CONNECTOR, HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, TRINO_CONNECTOR } from './connector_info.js';

/// A channel of a connection, the connection knows it by its id
export interface ConnectionChannel {
    close?(): unknown;
}

/// The script with the functions of a connection. The Rust connection owns it, the catalog loader replaces its text
/// and publishes its descriptor.
export interface ConnectionFunctionScript {
    readonly catalog_entry_id: number;
    getCatalogEntryId(): number;
    toString(): string;
    replaceText(text: string): void;
    /// The connection owns the script, a deleted connection drops it
    destroy(): void;
}

/// What the adapter keeps of a catalog update
interface TaskRecord {
    cancellation: AbortController;
    error: Error | null;
}

/// The fields of a state that the queries decide
type QueryFields = Pick<ConnectionState,
    | 'metrics' | 'queriesActive' | 'queriesActiveOrdered' | 'queriesFinished' | 'queriesFinishedOrdered' | 'snapshotQueriesActiveFinished'>;

/// The ids of the channels and result tables of all connections
let nextChannelId = 1;
let nextTableId = 1;

const DETAILS_TYPES = {
    [ConnectorType.HYPER]: HYPER_CONNECTOR,
    [ConnectorType.SALESFORCE_DATA_CLOUD]: SALESFORCE_DATA_CLOUD_CONNECTOR,
    [ConnectorType.TRINO]: TRINO_CONNECTOR,
    [ConnectorType.DBCOM]: DBCOM_CONNECTOR,
};

const toDate = (ms: number | null): Date | null => ms == null ? null : new Date(ms);

/// The setup timings of the details as ISO strings
function setupTimings(timings: Record<string, number>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, ms] of Object.entries(timings)) out[key] = new Date(ms).toISOString();
    return out;
}

/// An opaque JSON token of the runtime, an empty object for none like the TypeScript reducers had it
function token(text: string | null): any {
    return text == null ? {} : JSON.parse(text);
}

/// The protobuf of the details of a connection in the shape of the JSON schema of its connector
function detailsProto(details: core.ConnectionDetailsView): any {
    const proto: any = { setupTimings: setupTimings(details.setupTimings) };
    if (details.setupParams != null) proto.setupParams = details.setupParams;
    if (details.channelError != null) proto.channelError = details.channelError;
    if (details.healthCheckError != null) proto.healthCheckError = details.healthCheckError;
    const connector = details.connector;
    switch (connector.kind) {
        case 'trino': {
            if (connector.schemaResolutionError != null) proto.schemaResolutionError = connector.schemaResolutionError;
            // The steps of the flow that didn't happen yet are placeholders, like the TypeScript reducer had them
            const oauth = connector.oauthState;
            if (oauth != null) {
                proto.oauthState = {
                    oauthPkce: oauth.oauthPkce ?? { value: '', verifier: '' },
                    authCode: oauth.authCode ?? { token: '', createdAt: '' },
                    accessToken: token(oauth.accessToken),
                };
            }
            break;
        }
        case 'salesforce': {
            if (connector.setupError != null) proto.setupError = connector.setupError;
            const oauth = connector.oauthState;
            if (oauth != null) {
                proto.oauthState = {
                    oauthParams: oauth.oauthParams ?? { instanceUrl: '', appConsumerKey: '', requestedAt: 0, expiresAt: 0 },
                    oauthPkce: oauth.oauthPkce ?? { value: '', verifier: '' },
                    coreAuthCode: oauth.coreAuthCode ?? { token: '', createdAt: '' },
                    coreAccessToken: token(oauth.coreAccessToken),
                    dataCloudAccessToken: token(oauth.dataCloudAccessToken),
                };
            }
            break;
        }
    }
    return proto;
}

/// The Rust connection of a connection state and the JavaScript objects it knows by id: the channels, the
/// cancellations and errors of catalog updates and queries, the progress updates and the result tables.
///
/// `project` builds the `ConnectionState` of the app from the views of the connection (store/projection.ts). The view of
/// a changed connection shares the parts of the previous view that are the same, and the objects built from them stay.
/// A query keeps its state while its revision doesn't move, the maps and lists of the queries keep their objects while
/// they hold the same states. A projected state never changes afterwards, a change projects a new one.
export class NativeConnection implements NativeQueryObjects {
    readonly instance: core.DashQL;
    readonly connection: core.DashQLConnection;
    /// The script with the functions of the connection
    readonly functionScript: ConnectionFunctionScript;

    readonly channels = new Map<number, ConnectionChannel>();
    private readonly channelIds = new Map<ConnectionChannel, number>();
    private readonly tasks = new Map<number, TaskRecord>();
    private readonly queryRecords = new Map<number, QueryRecord>();
    private readonly tables = new Map<number, arrow.Table>();

    // The projection
    /// The view of the connection, its revision is the one of the connection
    private view: core.ConnectionView | null = null;
    /// The objects of the app built from the parts of the view
    private details: { view: core.ConnectionDetailsView; channel: ConnectionChannel | null; value: ConnectionStateDetailsVariant } | null = null;
    private catalogUpdatesOf: { view: core.ConnectionCatalogUpdates; value: CatalogUpdates } | null = null;
    /// The view of the queries, its revision is the one of the queries
    private queriesView: core.QueriesView | null = null;
    private queryFields: QueryFields | null = null;
    private readonly queryProjection = new QueryProjection('connection_state');
    private projected: ConnectionState | null = null;

    constructor(instance: core.DashQL, connection: core.DashQLConnection) {
        this.instance = instance;
        this.connection = connection;
        const entryId = connection.snapshot().functionScriptEntryId ?? 0;
        this.functionScript = {
            catalog_entry_id: entryId,
            getCatalogEntryId: () => entryId,
            toString: () => connection.functionScriptText() ?? '',
            replaceText: (text: string) => connection.replaceFunctionScriptText(text),
            destroy: () => { },
        };
    }

    /// Destroy the connection and its catalog handle, other holders of the catalog keep it
    destroy(): void {
        this.connection.destroy();
        this.channels.clear();
        this.channelIds.clear();
        this.tables.clear();
    }

    // The JavaScript objects of the actions

    /// The id of a channel, a new one for a channel that the connection doesn't know
    registerChannel(channel: ConnectionChannel): number {
        let id = this.channelIds.get(channel);
        if (id == null) {
            id = nextChannelId++;
            this.channels.set(id, channel);
            this.channelIds.set(channel, id);
        }
        return id;
    }

    /// Is a channel known to the connection?
    hasChannel(channel: ConnectionChannel): boolean {
        return this.channelIds.has(channel);
    }

    /// Forget a channel, e.g. one of an action that failed
    dropChannel(id: number): void {
        const channel = this.channels.get(id);
        this.channels.delete(id);
        if (channel != null) this.channelIds.delete(channel);
    }

    registerTask(taskId: number, cancellation: AbortController): void {
        this.tasks.set(taskId, { cancellation, error: null });
    }

    setTaskError(taskId: number, error: Error | null): void {
        const task = this.tasks.get(taskId);
        if (task != null) task.error = error;
    }

    /// Keep the JavaScript objects of a new query, the Rust connection refuses a query id that it knows
    registerQuery(state: QueryExecutionState): void {
        if (this.queryRecords.has(state.queryId)) return;
        this.queryRecords.set(state.queryId, queryRecord(state));
    }

    /// Keep the latest progress of a query, an update without structured progress keeps the one of the previous update
    setQueryProgress(queryId: number, progress: QueryExecutionProgress): void {
        const record = this.queryRecords.get(queryId);
        if (record != null) updateQueryRecordProgress(record, progress);
    }

    setQueryError(queryId: number, error: LoggableException): void {
        const record = this.queryRecords.get(queryId);
        if (record != null) record.error = error;
    }

    /// Keep a result table, returns its id
    registerTable(table: arrow.Table): number {
        const id = nextTableId++;
        this.tables.set(id, table);
        return id;
    }

    releaseTable(id: number): void {
        this.tables.delete(id);
    }

    // The effects

    /// Apply the effects of an action. A connection that is stopped aborts its catalog updates and its queries.
    applyEffects(connectionState: ConnectionState, effects: core.ConnectionEffect[], reason: string, hooks: {
        cancelSetup(connectionId: string): void;
    }): void {
        for (const effect of effects) {
            switch (effect.type) {
                case 'cancelSetup':
                    hooks.cancelSetup(connectionState.connectionId);
                    break;
                case 'invalidateCatalogBatch':
                    // The catalog loader of the Rust runtime publishes only for a connection that runs its update, the
                    // updates are aborted next
                    break;
                case 'abortCatalogUpdates':
                    for (const taskId of effect.taskIds) {
                        this.tasks.get(taskId)?.cancellation.abort(new DOMException(`Connection was ${reason}`, 'AbortError'));
                    }
                    break;
                case 'stopQueries':
                    // The queries run on the channel of the stopped connection, the executor stops them at the backend
                    for (const queryId of effect.queryIds) {
                        this.queryRecords.get(queryId)?.cancellation.abort(new DOMException(`Connection was ${reason}`, 'AbortError'));
                    }
                    // The queries are gone, the next projection forgets them
                    this.queryProjection.clear();
                    break;
                case 'closeChannel': {
                    const channel = this.channels.get(effect.channel);
                    this.dropChannel(effect.channel);
                    channel?.close?.();
                    break;
                }
                case 'releaseChannel':
                    this.dropChannel(effect.channel);
                    break;
                case 'releaseResultTable':
                    this.releaseTable(effect.tableId);
                    break;
            }
        }
    }

    // The projection

    /// The catalog updates of the app
    private catalogUpdates(updates: core.ConnectionCatalogUpdates): CatalogUpdates {
        const task = (t: core.ConnectionCatalogUpdateTask): CatalogUpdateTaskState => {
            const record = this.tasks.get(t.taskId);
            return {
                taskId: t.taskId,
                taskVariant: t.variant,
                status: t.status,
                cancellation: record?.cancellation ?? new AbortController(),
                queries: t.queries,
                error: t.error == null ? null : (record?.error ?? new Error(t.error.message)),
                startedAt: toDate(t.startedAt),
                finishedAt: toDate(t.finishedAt),
                touchedRelations: t.touchedRelations,
            };
        };
        // Forget the updates that the connection forgot, e.g. after a reset
        const known = new Set([...updates.tasksRunning, ...updates.tasksFinished].map(t => t.taskId));
        for (const taskId of this.tasks.keys()) {
            if (!known.has(taskId)) this.tasks.delete(taskId);
        }
        return {
            tasksRunning: new Map(updates.tasksRunning.map(t => [t.taskId, task(t)])),
            tasksFinished: new Map(updates.tasksFinished.map(t => [t.taskId, task(t)])),
            described: updates.described,
            currentFullRefresh: updates.currentFullRefresh,
            touchedRelations: updates.touchedRelations,
            touchedFailures: updates.touchedFailures,
        };
    }

    /// The details of the app, kept while their view and the channel stay
    private detailsOf(view: core.ConnectionDetailsView, connector: ConnectorType): ConnectionStateDetailsVariant {
        const channel = view.channel == null ? null : (this.channels.get(view.channel) ?? null);
        if (this.details == null || this.details.view !== view || this.details.channel !== channel) {
            const value = { type: DETAILS_TYPES[connector], value: { proto: detailsProto(view), channel } } as ConnectionStateDetailsVariant;
            this.details = { view, channel, value };
        }
        return this.details.value;
    }

    /// The queries of a list by id and their ids in order, the previous map and list while they hold the same states
    private queryList(list: [number, number][], prevMap?: Map<number, QueryExecutionState>, prevOrdered?: number[]): [Map<number, QueryExecutionState>, number[]] {
        const map = new Map<number, QueryExecutionState>();
        const ordered: number[] = [];
        for (const [queryId, revision] of list) {
            const state = this.queryProjection.state(this.connection, queryId, revision, this.queryRecords.get(queryId), this.tables);
            if (state == null) continue;
            map.set(queryId, state);
            ordered.push(queryId);
        }
        if (prevMap != null && prevOrdered != null && prevOrdered.length === ordered.length
            && ordered.every((queryId, i) => prevOrdered[i] === queryId && prevMap.get(queryId) === map.get(queryId))) {
            return [prevMap, prevOrdered];
        }
        return [map, ordered];
    }

    /// The fields of the queries, the previous ones while the revision of the queries doesn't move
    private projectQueries(): QueryFields {
        const prev = this.queryFields;
        if (prev != null && this.queriesView?.revision === this.connection.queriesRevision()) return prev;
        const queries = share(this.queriesView, this.connection.queries());
        const [queriesActive, queriesActiveOrdered] = this.queryList(queries.active, prev?.queriesActive, prev?.queriesActiveOrdered);
        const [queriesFinished, queriesFinishedOrdered] = this.queryList(queries.finished, prev?.queriesFinished, prev?.queriesFinishedOrdered);
        // Forget the queries that left the history
        const ids = [...queriesActiveOrdered, ...queriesFinishedOrdered];
        this.queryProjection.retain(ids);
        const known = new Set(ids);
        for (const queryId of [...this.queryRecords.keys()]) {
            if (!known.has(queryId)) this.queryRecords.delete(queryId);
        }
        this.queriesView = queries;
        this.queryFields = {
            metrics: queries.metrics,
            queriesActive,
            queriesActiveOrdered,
            queriesFinished,
            queriesFinishedOrdered,
            snapshotQueriesActiveFinished: queries.snapshot,
        };
        return this.queryFields;
    }

    /// The state of the app, the previous state if nothing changed
    project(connectionId: string): ConnectionState {
        const revision = this.connection.revision();
        const queries = this.projectQueries();
        const previous = this.projected;
        if (previous != null && previous.connectionId === connectionId && this.view?.revision === revision && previous.metrics === queries.metrics
            && previous.queriesActive === queries.queriesActive && previous.queriesFinished === queries.queriesFinished
            && previous.snapshotQueriesActiveFinished === queries.snapshotQueriesActiveFinished) {
            return previous;
        }
        // The view of the connection is read again when its revision moved
        const view = this.view?.revision === revision ? this.view : share(this.view, this.connection.snapshot());
        this.view = view;
        if (this.catalogUpdatesOf?.view !== view.catalogUpdates) {
            this.catalogUpdatesOf = { view: view.catalogUpdates, value: this.catalogUpdates(view.catalogUpdates) };
        }
        const params = (value: core.JsonParams | null) => (value ?? undefined) as ConnectionParams | undefined;
        const state: ConnectionState = {
            connectionId,
            instance: this.instance,
            native: this,
            active: view.active,
            connectionStatus: view.status,
            connectionHealth: view.health,
            connectorInfo: CONNECTOR_INFOS[view.connectorType],
            name: view.name ?? undefined,
            cacheQueryResults: view.cacheQueryResults ?? undefined,
            details: this.detailsOf(view.details, view.connectorType),
            params: view.params as ConnectionParams,
            paramsDraft: params(view.paramsDraft),
            setupAttemptParams: params(view.setupAttemptParams),
            setupAttemptDraft: params(view.setupAttemptDraft),
            metrics: queries.metrics,
            catalog: this.connection.catalog,
            catalogUpdates: this.catalogUpdatesOf.value,
            catalogRelationEntryId: view.relationEntryId,
            catalogFunctionScript: this.functionScript,
            queriesActive: queries.queriesActive,
            queriesActiveOrdered: queries.queriesActiveOrdered,
            queriesFinished: queries.queriesFinished,
            queriesFinishedOrdered: queries.queriesFinishedOrdered,
            snapshotQueriesActiveFinished: queries.snapshotQueriesActiveFinished,
        };
        this.projected = state;
        return state;
    }

    /// Restore the state of the catalog updates from the files of the catalog, null keeps a field. Returns the next
    /// state, the connection changes its revision and the state that the caller holds stays as it was.
    restoreCatalogUpdates(state: ConnectionState, described: boolean | null, touchedRelations: RelationName[] | null): ConnectionState {
        this.connection.restoreCatalogUpdates(described, touchedRelations);
        return this.project(state.connectionId);
    }
}
