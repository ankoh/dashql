import { DashQL, DashQLCatalog, Ptr } from './api.js';
import type * as glue from './wasm/dashql_core.js';

/// A connection with the history of its queries in the Rust runtime (`packages/dashql-core-runtime`, see
/// docs/wip/core_runtime.md). An action changes the connection and returns the effects that the host applies, e.g.
/// closing a channel or releasing a result table. Channels and result tables stay with the host, the connection knows
/// them by their ids. The state is read as snapshots, the connection and every query change their revision with every
/// change.

const CONNECTION_TYPE = Symbol('CONNECTION_TYPE');
const CONNECTION_CATALOG_TYPE = Symbol('CONNECTION_CATALOG_TYPE');

/// The connectors, in the order of `ConnectorType` of the runtime
export enum DashQLConnectorType {
    HYPER = 0,
    SALESFORCE_DATA_CLOUD = 1,
    TRINO = 2,
    DBCOM = 3,
}

/// The params of a connection: one field named after the connector, e.g. `{ trino: {...} }`
export type DashQLConnectionParams = Record<string, unknown>;
/// The params of a connector without the field around them
export type DashQLConnectorParams = Record<string, unknown>;

/// An error with a message and optional details
export interface DashQLConnectionError {
    message: string;
    data?: Record<string, string>;
}

/// A relation that a statement touched or that a catalog update answers, empty names for none
export interface DashQLRelationName {
    databaseName: string;
    schemaName: string;
    tableName: string;
}

/// A table name of the analyzer, null for a name that a statement left out
export interface DashQLTableName {
    databaseName: string | null;
    schemaName: string | null;
    tableName: string | null;
}

/// The metrics of the response stream of a query
export interface DashQLStreamMetrics {
    totalDataBytesReceived: number;
    totalBatchesReceived: number;
    totalRowsReceived: number;
    totalQueryRequestsStarted: number;
    totalQueryRequestsSucceeded: number;
    totalQueryRequestsFailed: number;
    totalQueryRequestDurationMs: number;
    durationUntilFirstBatchMs: number | null;
}

/// The plain fields of a progress update of a query
export interface DashQLQueryProgress {
    isQueued: boolean | null;
    progressPercent: number | null;
    resultRows: number | null;
    rowsProcessed: number | null;
    executionTimeMs: number | null;
    metrics: DashQLStreamMetrics;
    phase?: string | null;
}

/// What a query is and who issued it, as the runtime keeps it
export interface DashQLQueryMetadata {
    queryType: number;
    title: string | null;
    description: string | null;
    issuer: string | null;
    userProvided: boolean;
    workbookId?: string;
    resultOwner?: string;
}

/// What the host does after an action, in this order
export type DashQLConnectionEffect =
    /// Cancel the setup of the connection that is running, e.g. an OAuth flow
    | { type: 'cancelSetup' }
    /// Let the pending publications of catalog batches into the catalog fail
    | { type: 'invalidateCatalogBatch' }
    /// Abort running catalog updates
    | { type: 'abortCatalogUpdates'; taskIds: number[] }
    /// Stop the queries that were active at the backend, the connection dropped its queries and metrics
    | { type: 'stopQueries'; queryIds: number[] }
    /// Close a channel
    | { type: 'closeChannel'; channel: number }
    /// Let go of a channel that the connection no longer uses, without closing it
    | { type: 'releaseChannel'; channel: number }
    /// Nothing shows the result table of a query anymore
    | { type: 'releaseResultTable'; queryId: number; tableId: number };

/// What an action did
export interface DashQLConnectionOutcome {
    /// Did the action change the connection or its queries?
    changed: boolean;
    /// The effects for the host, in order
    effects: DashQLConnectionEffect[];
}

/// A catalog update
export interface DashQLCatalogUpdateTask {
    taskId: number;
    /// 0 for a full refresh, 1 for a lookup of relations
    variant: number;
    /// 0 started, 1 succeeded, 2 failed, 3 cancelled, 4 partially succeeded
    status: number;
    queries: number[];
    error: DashQLConnectionError | null;
    startedAt: number | null;
    finishedAt: number | null;
    touchedRelations: DashQLRelationName[];
}

/// The details of the setup of a connection, timestamps in milliseconds since epoch. Access tokens are opaque JSON.
export interface DashQLConnectionDetails {
    setupTimings: Record<string, number>;
    setupParams: DashQLConnectorParams | null;
    channelError: DashQLConnectionError | null;
    healthCheckError: DashQLConnectionError | null;
    channel: number | null;
    /// Trino
    schemaResolutionError?: DashQLConnectionError | null;
    /// Salesforce
    setupError?: DashQLConnectionError | null;
    /// Trino and Salesforce, the steps of the flow that didn't happen yet are null
    oauthState?: Record<string, any> | null;
}

/// The plain fields of a connection
export interface DashQLConnectionSnapshot {
    revision: number;
    active: boolean;
    /// The `ConnectionStatus` of the runtime
    status: number;
    /// The `ConnectionHealth` of the runtime
    health: number;
    connectorType: DashQLConnectorType;
    name: string | null;
    cacheQueryResults: boolean | null;
    details: DashQLConnectionDetails;
    params: DashQLConnectionParams;
    paramsDraft: DashQLConnectionParams | null;
    setupAttemptParams: DashQLConnectionParams | null;
    setupAttemptDraft: DashQLConnectionParams | null;
    catalogUpdates: {
        tasksRunning: DashQLCatalogUpdateTask[];
        tasksFinished: DashQLCatalogUpdateTask[];
        described: boolean;
        currentFullRefresh: number | null;
        touchedRelations: DashQLRelationName[];
        touchedFailures: number;
    };
    relationEntryId: number;
    functionScriptEntryId: number | null;
}

/// The metrics of the finished queries of one outcome
export interface DashQLConnectionQueryMetrics {
    totalQueries: number;
    totalBatchesReceived: number;
    totalRowsReceived: number;
    accumulatedTimeUntilFirstBatch: number;
    accumulatedQueryDuration: number;
}

/// The queries of a connection
export interface DashQLConnectionQueries {
    revision: number;
    /// The active queries in the order they started, each with its revision
    active: [number, number][];
    /// The finished queries in the order they finished, each with its revision
    finished: [number, number][];
    /// Changes whenever a query starts or finishes
    snapshot: number;
    metrics: {
        successfulQueries: DashQLConnectionQueryMetrics;
        canceledQueries: DashQLConnectionQueryMetrics;
        failedQueries: DashQLConnectionQueryMetrics;
    };
}

/// The plain fields of a query, timestamps in milliseconds since epoch
export interface DashQLQuerySnapshot {
    queryId: number;
    /// The `QueryExecutionStatus` of the runtime
    status: number;
    metrics: {
        queryRequestedAt: number | null;
        querySendingStartedAt: number | null;
        queryQueuedStartedAt: number | null;
        queryRunningStartedAt: number | null;
        receivedFirstBatchAt: number | null;
        receivedLastBatchAt: number | null;
        receivedAllBatchesAt: number | null;
        processingResultsStartedAt: number | null;
        processedResultsAt: number | null;
        querySucceededAt: number | null;
        queryFailedAt: number | null;
        queryCancelledAt: number | null;
        lastUpdatedAt: number | null;
        progressUpdatesReceived: number;
        queryDurationMs: number | null;
        textLength: number | null;
        streamMetrics: DashQLStreamMetrics;
    };
    error: { message: string; details: string | null } | null;
    resultTable: { id: number; rows: number } | null;
    cacheKey: string | null;
    servedFromCache: boolean;
    cacheDeleted: boolean;
    cachedAt: number | null;
    revision: number;
}

/// The options of a new connection
export interface DashQLConnectionOptions {
    /// The params of the connector that the details of the setup start with, none without
    setupParams?: DashQLConnectorParams | null;
    /// Does the connection belong to a committed workbook or was it connected once?
    active?: boolean;
    /// The params, the setup params by default
    params?: DashQLConnectionParams | null;
    /// The draft of the params
    paramsDraft?: DashQLConnectionParams | null;
}

type NativeConnection = glue.Connection;

const json = (value: unknown): string => JSON.stringify(value);
const optionalJson = (value: unknown): string | undefined => value == null ? undefined : JSON.stringify(value);

export class DashQLConnection {
    public readonly ptr: Ptr<typeof CONNECTION_TYPE, NativeConnection>;
    /// The catalog handle, one per connection
    private catalogHandle: DashQLCatalog | null = null;

    public constructor(ptr: Ptr<typeof CONNECTION_TYPE, NativeConnection>) {
        this.ptr = ptr;
    }

    /// A connection of a connector with an empty catalog
    public static create(api: DashQL, connectionId: string, connector: DashQLConnectorType, options: DashQLConnectionOptions = {}, now = Date.now()): DashQLConnection {
        const native = new api.bindings.Connection(
            connectionId,
            connector,
            optionalJson(options.setupParams),
            options.active ?? false,
            optionalJson(options.params),
            optionalJson(options.paramsDraft),
            now,
        );
        return new DashQLConnection(new Ptr(CONNECTION_TYPE, api, native));
    }

    /// Destroy the connection and its catalog handle. Other holders of the catalog keep it.
    public destroy(): void {
        this.catalogHandle?.destroy();
        this.catalogHandle = null;
        this.ptr.destroy();
    }

    private native(): NativeConnection {
        return this.ptr.assertNotNull();
    }

    private outcome(outcome: glue.ConnectionOutcome): DashQLConnectionOutcome {
        try {
            return { changed: outcome.changed, effects: JSON.parse(outcome.effects) as DashQLConnectionEffect[] };
        } finally {
            outcome.free();
        }
    }

    // The connection

    public setDraft(draft: DashQLConnectionParams, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().setDraft(json(draft), now));
    }
    public discardDraft(now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().discardDraft(now));
    }
    public commitParams(params: DashQLConnectionParams, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().commitParams(json(params), now));
    }
    public rename(name: string, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().rename(name, now));
    }
    public setQueryResultCaching(caching: boolean, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().setQueryResultCaching(caching, now));
    }
    /// Stop the connection and drop its catalog and queries
    public delete(now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().delete(now));
    }
    /// Stop the connection and clear its catalog and queries
    public reset(now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().reset(now));
    }
    public switchConnectorType(connector: DashQLConnectorType, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().switchConnectorType(connector, now));
    }

    // The health check

    public healthCheckStarted(now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().healthCheckStarted(now));
    }
    public healthCheckCancelled(now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().healthCheckCancelled(now));
    }
    public healthCheckFailed(error: DashQLConnectionError, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().healthCheckFailed(json(error), now));
    }
    public healthCheckSucceeded(now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().healthCheckSucceeded(now));
    }

    // The catalog updates

    public relationsTouched(names: readonly DashQLTableName[], now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().relationsTouched(json(names), now));
    }
    /// A catalog update started, `variant` 0 is a full refresh and 1 a lookup of relations
    public updateCatalog(taskId: number, variant: number, startedAt: number | null, touchedRelations: readonly DashQLRelationName[], now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().updateCatalog(taskId, variant, startedAt ?? undefined, json(touchedRelations), now));
    }
    public catalogUpdateRegisterQuery(taskId: number, queryId: number, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().catalogUpdateRegisterQuery(taskId, queryId, now));
    }
    /// A catalog update finished with a status: 1 succeeded, 2 failed, 3 cancelled, 4 partially succeeded
    public catalogUpdateFinished(taskId: number, status: number, error: DashQLConnectionError | null, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().catalogUpdateFinished(taskId, status, optionalJson(error), now));
    }
    /// Restore the state of the catalog updates from the files of the catalog, null keeps a field
    public restoreCatalogUpdates(described: boolean | null, touchedRelations: readonly DashQLRelationName[] | null): void {
        this.native().restoreCatalogUpdates(described ?? undefined, optionalJson(touchedRelations));
    }

    // The setup of Hyper

    public hyperChannelSetupStarted(params: DashQLConnectorParams, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().hyperChannelSetupStarted(json(params), now));
    }
    public hyperChannelSetupCancelled(error: DashQLConnectionError, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().hyperChannelSetupCancelled(json(error), now));
    }
    public hyperChannelSetupFailed(error: DashQLConnectionError, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().hyperChannelSetupFailed(json(error), now));
    }
    public hyperChannelReady(channel: number, params: DashQLConnectorParams, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().hyperChannelReady(channel, json(params), now));
    }

    // The setup of Trino

    public trinoOAuthStarted(params: DashQLConnectorParams, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().trinoOAuthStarted(json(params), now));
    }
    public trinoOAuthCancelled(error: DashQLConnectionError, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().trinoOAuthCancelled(json(error), now));
    }
    public trinoOAuthFailed(error: DashQLConnectionError, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().trinoOAuthFailed(json(error), now));
    }
    public trinoGeneratingPkceChallenge(now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().trinoGeneratingPkceChallenge(now));
    }
    public trinoGeneratedPkceChallenge(value: string, verifier: string, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().trinoGeneratedPkceChallenge(value, verifier, now));
    }
    public trinoOAuthBrowserOpened(now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().trinoOAuthBrowserOpened(now));
    }
    public trinoReceivedOAuthCode(token: string, createdAt: string, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().trinoReceivedOAuthCode(token, createdAt, now));
    }
    public trinoRequestingAccessToken(now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().trinoRequestingAccessToken(now));
    }
    /// The access token arrived, it stays opaque JSON
    public trinoReceivedAccessToken(token: unknown, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().trinoReceivedAccessToken(json(token), now));
    }
    public trinoChannelSetupStarted(params: DashQLConnectorParams, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().trinoChannelSetupStarted(json(params), now));
    }
    public trinoChannelSetupCancelled(error: DashQLConnectionError, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().trinoChannelSetupCancelled(json(error), now));
    }
    public trinoChannelSetupFailed(error: DashQLConnectionError, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().trinoChannelSetupFailed(json(error), now));
    }
    public trinoChannelReady(channel: number, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().trinoChannelReady(channel, now));
    }

    // The setup of Salesforce and Database.com

    public salesforceSetupStarted(params: DashQLConnectorParams, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().salesforceSetupStarted(json(params), now));
    }
    public salesforceSetupCancelled(error: DashQLConnectionError, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().salesforceSetupCancelled(json(error), now));
    }
    public salesforceSetupFailed(error: DashQLConnectionError, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().salesforceSetupFailed(json(error), now));
    }
    public salesforceGeneratingPkceChallenge(now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().salesforceGeneratingPkceChallenge(now));
    }
    public salesforceGeneratedPkceChallenge(value: string, verifier: string, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().salesforceGeneratedPkceChallenge(value, verifier, now));
    }
    public salesforceOAuthNativeLinkOpened(now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().salesforceOAuthNativeLinkOpened(now));
    }
    public salesforceOAuthWebWindowOpened(now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().salesforceOAuthWebWindowOpened(now));
    }
    public salesforceOAuthWebWindowClosed(now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().salesforceOAuthWebWindowClosed(now));
    }
    public salesforceReceivedCoreAuthCode(token: string, createdAt: string, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().salesforceReceivedCoreAuthCode(token, createdAt, now));
    }
    public salesforceRequestingCoreAuthToken(now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().salesforceRequestingCoreAuthToken(now));
    }
    /// The core access token arrived, it stays opaque JSON
    public salesforceReceivedCoreAuthToken(token: unknown, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().salesforceReceivedCoreAuthToken(json(token), now));
    }
    public salesforceReceivedCoreUserInfo(preferredUsername: string | null, email: string | null, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().salesforceReceivedCoreUserInfo(preferredUsername ?? undefined, email ?? undefined, now));
    }
    public salesforceRequestingDataCloudAccessToken(now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().salesforceRequestingDataCloudAccessToken(now));
    }
    /// The Data Cloud access token arrived, it stays opaque JSON
    public salesforceReceivedDataCloudAccessToken(token: unknown, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().salesforceReceivedDataCloudAccessToken(json(token), now));
    }
    public salesforceChannelSetupStarted(now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().salesforceChannelSetupStarted(now));
    }
    public salesforceChannelSetupCancelled(error: DashQLConnectionError, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().salesforceChannelSetupCancelled(json(error), now));
    }
    public salesforceChannelSetupFailed(error: DashQLConnectionError, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().salesforceChannelSetupFailed(json(error), now));
    }
    public salesforceChannelReady(channel: number, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().salesforceChannelReady(channel, now));
    }

    // The queries

    public executeQuery(queryId: number, traceId: number, text: string, metadata: DashQLQueryMetadata, requestedAt = Date.now()): DashQLConnectionOutcome {
        const plain: DashQLQueryMetadata = {
            queryType: metadata.queryType,
            title: metadata.title,
            description: metadata.description,
            issuer: metadata.issuer,
            userProvided: metadata.userProvided,
            workbookId: metadata.workbookId,
            resultOwner: metadata.resultOwner,
        };
        return this.outcome(this.native().executeQuery(queryId, traceId, text, json(plain), requestedAt));
    }
    public querySending(queryId: number, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().querySending(queryId, now));
    }
    public queryRunning(queryId: number, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().queryRunning(queryId, now));
    }
    /// The backend reported progress, only the plain fields cross
    public queryProgressUpdated(queryId: number, progress: DashQLQueryProgress, now = Date.now()): DashQLConnectionOutcome {
        const plain: DashQLQueryProgress = {
            isQueued: progress.isQueued,
            progressPercent: progress.progressPercent,
            resultRows: progress.resultRows,
            rowsProcessed: progress.rowsProcessed,
            executionTimeMs: progress.executionTimeMs,
            metrics: progress.metrics,
            phase: progress.phase ?? null,
        };
        return this.outcome(this.native().queryProgressUpdated(queryId, json(plain), now));
    }
    public queryReceivedBatch(queryId: number, metrics: DashQLStreamMetrics, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().queryReceivedBatch(queryId, json(metrics), now));
    }
    /// All batches arrived, the host keeps the table under its id
    public queryReceivedAllBatches(queryId: number, tableId: number, rows: number, metrics: DashQLStreamMetrics, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().queryReceivedAllBatches(queryId, tableId, rows, json(metrics), now));
    }
    public queryProcessingResults(queryId: number, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().queryProcessingResults(queryId, now));
    }
    public queryProcessedResults(queryId: number, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().queryProcessedResults(queryId, now));
    }
    public querySucceeded(queryId: number, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().querySucceeded(queryId, now));
    }
    public queryFailed(queryId: number, message: string, details: string | null, metrics: DashQLStreamMetrics | null, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().queryFailed(queryId, message, details ?? undefined, optionalJson(metrics), now));
    }
    public queryCancelled(queryId: number, message: string, details: string | null, metrics: DashQLStreamMetrics | null, now = Date.now()): DashQLConnectionOutcome {
        return this.outcome(this.native().queryCancelled(queryId, message, details ?? undefined, optionalJson(metrics), now));
    }
    public queryCacheRecorded(queryId: number, cacheKey: string, servedFromCache: boolean, cachedAt: number | null): DashQLConnectionOutcome {
        return this.outcome(this.native().queryCacheRecorded(queryId, cacheKey, servedFromCache, cachedAt ?? undefined));
    }
    public queryCacheDeleted(queryId: number): DashQLConnectionOutcome {
        return this.outcome(this.native().queryCacheDeleted(queryId));
    }

    // Reading the state

    /// The revision of the connection, it changes with every change of the connection, not of its queries
    public revision(): number {
        return this.native().revision();
    }
    /// The revision of the queries, it changes with every change of a query
    public queriesRevision(): number {
        return this.native().queriesRevision();
    }
    /// The catalog of the connection. Every call returns the same handle, it shares the catalog with the connection
    /// and with the scripts that analyze with it.
    public get catalog(): DashQLCatalog {
        if (this.catalogHandle == null) {
            const native = this.native().catalog();
            // A catalog like the ones of `DashQL.createCatalog`, the symbol of their pointers is private to api.ts
            const ptr = new Ptr(CONNECTION_CATALOG_TYPE, this.ptr.api, native) as unknown as ConstructorParameters<typeof DashQLCatalog>[0];
            this.catalogHandle = new DashQLCatalog(ptr);
        }
        return this.catalogHandle;
    }
    /// The text of the script with the functions of the connection, null once it is deleted
    public functionScriptText(): string | null {
        return this.native().functionScriptText() ?? null;
    }
    public replaceFunctionScriptText(text: string): void {
        this.native().replaceFunctionScriptText(text);
    }
    public snapshot(): DashQLConnectionSnapshot {
        return JSON.parse(this.native().snapshot()) as DashQLConnectionSnapshot;
    }
    public queries(): DashQLConnectionQueries {
        return JSON.parse(this.native().queries()) as DashQLConnectionQueries;
    }
    public query(queryId: number): DashQLQuerySnapshot | null {
        const text = this.native().query(queryId);
        return text == null ? null : JSON.parse(text) as DashQLQuerySnapshot;
    }
}
