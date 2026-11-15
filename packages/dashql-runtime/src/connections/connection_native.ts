import type * as arrow from 'apache-arrow';
import type * as core from '@ankoh/dashql-core';
import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

import type { LoggableException } from '../platform/logger/logger.js';
import type { QueryExecutionProgress, QueryExecutionState } from '../query/query_execution_state.js';
import { projectQuery, queryRecord, updateQueryRecordProgress, type NativeQueryObjects, type QueryRecord } from '../query/query_history_native.js';
import type { CatalogUpdateTaskState } from './catalog/catalog_update_state.js';
import type { RelationName } from './catalog/catalog_sql_generator.js';
import type { ConnectionParams } from './connection_params.js';
import type { ConnectionStateDetailsVariant } from './connection_state_details.js';
import type { CatalogUpdates, ConnectionHealth, ConnectionState, ConnectionStatus } from './connection_state.js';
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

/// The fields of a state that the connection decides, not its queries
type ConnectionFields = Pick<ConnectionState,
    | 'active' | 'connectionStatus' | 'connectionHealth' | 'connectorInfo' | 'name' | 'cacheQueryResults' | 'details' | 'params'
    | 'paramsDraft' | 'setupAttemptParams' | 'setupAttemptDraft' | 'catalogUpdates' | 'catalogRelationEntryId'>;

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
function detailsProto(details: core.DashQLConnectionDetails, connector: ConnectorType): any {
    const proto: any = { setupTimings: setupTimings(details.setupTimings) };
    if (details.setupParams != null) proto.setupParams = details.setupParams;
    if (details.channelError != null) proto.channelError = details.channelError;
    if (details.healthCheckError != null) proto.healthCheckError = details.healthCheckError;
    const oauth = details.oauthState;
    switch (connector) {
        case ConnectorType.TRINO:
            if (details.schemaResolutionError != null) proto.schemaResolutionError = details.schemaResolutionError;
            // The steps of the flow that didn't happen yet are placeholders, like the TypeScript reducer had them
            if (oauth != null) {
                proto.oauthState = {
                    oauthPkce: oauth.oauthPkce ?? { value: '', verifier: '' },
                    authCode: oauth.authCode ?? { token: '', createdAt: '' },
                    accessToken: token(oauth.accessToken),
                };
            }
            break;
        case ConnectorType.SALESFORCE_DATA_CLOUD:
        case ConnectorType.DBCOM:
            if (details.setupError != null) proto.setupError = details.setupError;
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
    return proto;
}

/// A part of a projection, kept while its JSON doesn't change
class Part<T> {
    private text: string | null = null;
    private value: T | null = null;

    get(source: unknown, build: () => T): T {
        const text = JSON.stringify(source);
        if (this.value == null || text !== this.text) {
            this.value = build();
            this.text = text;
        }
        return this.value;
    }

    invalidate(): void {
        this.text = null;
    }
}

/// The Rust connection of a connection state and the JavaScript objects it knows by id: the channels, the
/// cancellations and errors of catalog updates and queries, the progress updates and the result tables.
///
/// `project` builds the `ConnectionState` of the app from the connection. A part that didn't change keeps its object,
/// a query keeps its state while its revision doesn't move. The maps of the queries change in place, like the reducer
/// in TypeScript changed them.
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
    private revision: number | null = null;
    private queriesRevision: number | null = null;
    private readonly detailsPart = new Part<ConnectionStateDetailsVariant>();
    private readonly paramsPart = new Part<ConnectionParams>();
    private readonly draftPart = new Part<ConnectionParams | undefined>();
    private readonly attemptParamsPart = new Part<ConnectionParams | undefined>();
    private readonly attemptDraftPart = new Part<ConnectionParams | undefined>();
    private readonly catalogUpdatesPart = new Part<CatalogUpdates>();
    private readonly metricsPart = new Part<connection.ConnectionMetrics>();
    private projectedQueries = new Map<number, { revision: number; state: QueryExecutionState }>();
    private queriesActive = new Map<number, QueryExecutionState>();
    private queriesActiveOrdered: number[] = [];
    private queriesFinished = new Map<number, QueryExecutionState>();
    private queriesFinishedOrdered: number[] = [];
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
    applyEffects(connectionState: ConnectionState, effects: core.DashQLConnectionEffect[], reason: string, hooks: {
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
                    // The queries are gone, the next states get new maps
                    this.queriesActive = new Map();
                    this.queriesActiveOrdered = [];
                    this.queriesFinished = new Map();
                    this.queriesFinishedOrdered = [];
                    this.projectedQueries = new Map();
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
    private catalogUpdates(updates: core.DashQLConnectionSnapshot['catalogUpdates']): CatalogUpdates {
        const task = (t: core.DashQLCatalogUpdateTask): CatalogUpdateTaskState => {
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
                touchedRelations: t.touchedRelations as RelationName[],
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
            touchedRelations: updates.touchedRelations as RelationName[],
            touchedFailures: updates.touchedFailures,
        };
    }

    /// The state of a query of the app
    private queryState(queryId: number, revision: number): QueryExecutionState | null {
        const cached = this.projectedQueries.get(queryId);
        if (cached != null && cached.revision === revision) return cached.state;
        const record = this.queryRecords.get(queryId);
        const snapshot = this.connection.query(queryId);
        if (record == null || snapshot == null) return null;
        const resultTable = snapshot.resultTable == null ? null : (this.tables.get(snapshot.resultTable.id) ?? null);
        const state = projectQuery(snapshot, record, resultTable, 'connection_state');
        this.projectedQueries.set(queryId, { revision, state });
        return state;
    }

    /// Bring the maps of the queries up to date, in place
    private projectQueries(queries: core.DashQLConnectionQueries): void {
        const fill = (list: [number, number][], map: Map<number, QueryExecutionState>, ordered: number[]) => {
            const ids = new Set<number>();
            ordered.length = 0;
            for (const [queryId, revision] of list) {
                const state = this.queryState(queryId, revision);
                if (state == null) continue;
                ids.add(queryId);
                ordered.push(queryId);
                if (map.get(queryId) !== state) map.set(queryId, state);
            }
            for (const queryId of [...map.keys()]) {
                if (!ids.has(queryId)) map.delete(queryId);
            }
            return ids;
        };
        const active = fill(queries.active, this.queriesActive, this.queriesActiveOrdered);
        const finished = fill(queries.finished, this.queriesFinished, this.queriesFinishedOrdered);
        // Forget the queries that left the history
        for (const queryId of [...this.queryRecords.keys()]) {
            if (!active.has(queryId) && !finished.has(queryId)) {
                this.queryRecords.delete(queryId);
                this.projectedQueries.delete(queryId);
            }
        }
    }

    /// The state of the app, the previous state if nothing changed
    project(connectionId: string): ConnectionState {
        const revision = this.connection.revision();
        const queriesRevision = this.connection.queriesRevision();
        const previous = this.projected;
        if (previous != null && previous.connectionId === connectionId && revision === this.revision && queriesRevision === this.queriesRevision) {
            return previous;
        }
        // The fields of the connection, kept while only the queries change
        let fields: ConnectionFields;
        if (previous != null && revision === this.revision) {
            fields = previous;
        } else {
            const snapshot = this.connection.snapshot();
            const connectorType = snapshot.connectorType as unknown as ConnectorType;
            const optional = (part: Part<ConnectionParams | undefined>, value: core.DashQLConnectionParams | null) =>
                part.get(value, () => (value ?? undefined) as ConnectionParams | undefined);
            fields = {
                active: snapshot.active,
                connectionStatus: snapshot.status as ConnectionStatus,
                connectionHealth: snapshot.health as ConnectionHealth,
                connectorInfo: CONNECTOR_INFOS[connectorType],
                name: snapshot.name ?? undefined,
                cacheQueryResults: snapshot.cacheQueryResults ?? undefined,
                details: this.detailsPart.get([snapshot.connectorType, snapshot.details], () => ({
                    type: DETAILS_TYPES[connectorType],
                    value: {
                        proto: detailsProto(snapshot.details, connectorType),
                        channel: snapshot.details.channel == null ? null : (this.channels.get(snapshot.details.channel) ?? null),
                    },
                }) as ConnectionStateDetailsVariant),
                params: this.paramsPart.get(snapshot.params, () => snapshot.params as ConnectionParams),
                paramsDraft: optional(this.draftPart, snapshot.paramsDraft),
                setupAttemptParams: optional(this.attemptParamsPart, snapshot.setupAttemptParams),
                setupAttemptDraft: optional(this.attemptDraftPart, snapshot.setupAttemptDraft),
                catalogUpdates: this.catalogUpdatesPart.get(snapshot.catalogUpdates, () => this.catalogUpdates(snapshot.catalogUpdates)),
                catalogRelationEntryId: snapshot.relationEntryId,
            };
        }

        // The queries, kept while only the connection changes
        let metrics = previous?.metrics;
        let snapshotQueriesActiveFinished = previous?.snapshotQueriesActiveFinished;
        if (previous == null || metrics == null || snapshotQueriesActiveFinished == null || queriesRevision !== this.queriesRevision) {
            const queries = this.connection.queries();
            this.projectQueries(queries);
            metrics = this.metricsPart.get(queries.metrics, () => queries.metrics as connection.ConnectionMetrics);
            snapshotQueriesActiveFinished = queries.snapshot;
        }

        const state: ConnectionState = {
            connectionId,
            instance: this.instance,
            native: this,
            active: fields.active,
            connectionStatus: fields.connectionStatus,
            connectionHealth: fields.connectionHealth,
            connectorInfo: fields.connectorInfo,
            name: fields.name,
            cacheQueryResults: fields.cacheQueryResults,
            details: fields.details,
            params: fields.params,
            paramsDraft: fields.paramsDraft,
            setupAttemptParams: fields.setupAttemptParams,
            setupAttemptDraft: fields.setupAttemptDraft,
            metrics,
            catalog: this.connection.catalog,
            catalogUpdates: fields.catalogUpdates,
            catalogRelationEntryId: fields.catalogRelationEntryId,
            catalogFunctionScript: this.functionScript,
            queriesActive: this.queriesActive,
            queriesActiveOrdered: this.queriesActiveOrdered,
            queriesFinished: this.queriesFinished,
            queriesFinishedOrdered: this.queriesFinishedOrdered,
            snapshotQueriesActiveFinished,
        };
        this.revision = revision;
        this.queriesRevision = queriesRevision;
        this.projected = state;
        return state;
    }

    /// Restore the state of the catalog updates from the files of the catalog. The state that the caller holds shows
    /// it right away.
    restoreCatalogUpdates(state: ConnectionState, described: boolean | null, touchedRelations: RelationName[] | null): void {
        this.connection.restoreCatalogUpdates(described, touchedRelations);
        if (described != null) state.catalogUpdates.described = described;
        if (touchedRelations != null) state.catalogUpdates.touchedRelations = touchedRelations;
        this.catalogUpdatesPart.invalidate();
    }
}
