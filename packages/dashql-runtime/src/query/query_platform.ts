import * as arrow from 'apache-arrow';
import type * as core from '@ankoh/dashql-core';

import type { ConnectionState } from '../connections/connection_state.js';
import { CONNECTOR_INFOS, ConnectorType } from '../connections/connector_info.js';
import { CONNECTOR_DESCRIPTORS, connectionParamsOf } from '../connections/connector_descriptor.js';
import { createConnectionParamsSignature } from '../connections/connection_params.js';
import type { CancelQuery, QueryExecutionArgs, QueryExecutor } from '../connections/query_execution_args.js';
import { TrinoChannel } from '../connections/trino/trino_channel.js';
import type { HyperDatabaseChannel } from '../connections/hyper/hyperdb_grpc_client.js';
import type { SalesforceDatabaseChannel } from '../connections/salesforce/salesforce_api_client.js';
import { queryParam, requireChannel } from '../connections/query_channel.js';
import type { HandleTable } from '../store/handles.js';
import type { PlatformTables } from '../store/runtime_tables.js';
import { computeQueryResultCacheKey } from './query_result_cache_key.js';
import { QueryCacheMissError, type QueryResultCache } from './query_result_cache.js';
import type { QueryExecutionProgress, QueryExecutionResponseStream, QueryMetadata } from './query_execution_state.js';
import { createTrace } from '../platform/logger/trace_context.js';
import { LoggableException, stringifyError, type Logger } from '../platform/logger/logger.js';
import type { LogRecord } from '../platform/logger/log_buffer.js';
import type { EmbeddedComputeDatabase } from '../platform/database/embedded_database.js';
import { supportsParquet, type ParquetDatabase } from '../platform/hyperdb/hyperdb_parquet_export.js';

const LOG_CTX = 'query_executor';

/// Show the profile of a running query, returns the function that stops showing it
export type WatchQueryProfile = (queryId: number) => () => void;

/// A message of a channel of the host, what the stream produced. The batches stay in the table of the query.
type ChannelMessage = core.RuntimeChannelMessage | { type: 'error'; error: unknown };

/// What the host keeps of a query of the runtime: the arguments, the channel of the host and its stream
interface QueryRecord {
    args: QueryExecutionArgs;
    /// The channel of a query that the host runs, the one of the connection
    channel: unknown;
    /// The name of the connector, e.g. for the error of a channel that is not set up
    connector: string;
    /// Aborted by the caller and by a cancel, it stops the stream of a channel of the host
    cancellation: AbortController;
    /// The Trino channel that the executor speaks, it keeps a refreshed access token
    trino: TrinoChannel | null;
    /// The stream of a channel of the host and its messages
    stream: QueryExecutionResponseStream | null;
    /// The cancellation of the stream at the backend, every cancel waits for the same one
    streamCancel: Promise<void> | null;
    producing: boolean;
    /// The table that the batches of the stream go into
    table: number | null;
    messages: ChannelMessage[];
    wakeMessages: (() => void) | null;
}

/// The cache key of a query on a connection, null when the connection has no params that identify it yet (e.g. before
/// its setup). Never throws, a key that can't be derived is a miss.
export async function computeQueryCacheKeyForConnection(connection: Pick<ConnectionState, 'connectorType' | 'details'>, cacheSignature: string): Promise<string | null> {
    try {
        const setupParams = connection.details.setupParams;
        if (setupParams == null) return null;
        const params = connectionParamsOf(CONNECTOR_DESCRIPTORS[connection.connectorType as ConnectorType], setupParams as never);
        const signature = createConnectionParamsSignature(params);
        if (signature == null) return null;
        return await computeQueryResultCacheKey(signature, cacheSignature);
    } catch {
        return null;
    }
}

/// The cancellation of a query as an error
function abortError(): DOMException {
    return new DOMException('Query was cancelled', 'AbortError');
}

/// What the queries need of the platform. The host can replace them while queries run, e.g. once the compute database is
/// ready.
export interface QueryPlatformDependencies {
    logger: Logger;
    handles: HandleTable;
    tables: PlatformTables;
    /// The database of the computations, null until it is ready
    computeDatabase: () => EmbeddedComputeDatabase | null;
    /// The cache of query results, null without one
    resultCache: () => QueryResultCache | null;
    /// A connection as the runtime holds it now, the key of a result derives from its params
    connection: (connectionId: string) => ConnectionState | null;
}

/// The host side of the queries of the runtime (docs/wip/runtime_api.md): the query executor of the runtime runs a
/// query and reports into the history of its connection, the host describes where the query runs (the channel of the
/// connection, the cache key), runs the queries of the channels that the module doesn't speak (the gRPC channel of
/// Hyper, the embedded Hyper, the channels of tests) and keeps the query result cache. The caller gets the result table
/// and the error of a failed query as before. The runtime runs queries of its own as well, the metadata queries of the
/// catalog loader and the probes of the health checks: the host describes them in the same way.
export class QueryPlatform {
    private readonly records = new Map<number, QueryRecord>();
    /// The files of the cache that the runs keep, by id
    private readonly retained = new Map<number, () => Promise<void>>();
    private nextRetained = 0;

    constructor(private readonly deps: QueryPlatformDependencies) { }

    /// The channels of the host by query
    readonly channels: Pick<core.RuntimeChannels, 'open' | 'next' | 'cancel' | 'profileDetail'> = {
        open: async (queryId, table) => {
            const record = this.recordOf(queryId);
            const channel = requireChannel(record.channel as HyperDatabaseChannel | null, record.connector);
            const stream = await channel.executeQuery(queryParam(record.args), record.cancellation.signal, { readTimeoutMs: record.args.readTimeoutMs });
            if (stream == null) return false;
            record.stream = stream as QueryExecutionResponseStream;
            // The stream produces with the first message, a query that was cancelled meanwhile never consumes it
            record.table = table;
            return true;
        },
        next: queryId => this.nextMessage(this.recordOf(queryId)),
        cancel: async queryId => {
            const record = this.records.get(queryId);
            if (record == null) return;
            record.cancellation.abort(abortError());
            // A stream is cancelled once at the backend, every cancel waits for it
            if (record.stream != null) {
                record.streamCancel ??= Promise.resolve(record.stream.cancel?.());
                await record.streamCancel;
            }
        },
        profileDetail: (queryId, shown) => {
            this.records.get(queryId)?.stream?.setProfileDetail?.(shown);
        },
    };

    /// The query result cache of the platform, Parquet files that the compute database reads and writes
    resultCache(): core.RuntimeResultCache | null {
        const cache = this.deps.resultCache();
        if (cache == null) return null;
        const database = () => {
            const database = this.deps.computeDatabase();
            if (!supportsParquet(database)) throw new Error('The compute database reads no Parquet files');
            return database as ParquetDatabase;
        };
        return {
            lookup: async key => {
                const entry = await cache.lookup(key);
                return entry == null ? null : { name: entry.name, cachedAt: entry.cachedAtMs, size: entry.size };
            },
            read: async name => {
                const table = await cache.readTable(database(), name);
                return { table: this.deps.handles.register(table), rows: table.numRows, columns: table.numCols };
            },
            touch: name => cache.touch(name),
            key: (connectionId, signature) => {
                const connection = this.deps.connection(connectionId);
                return connection == null ? Promise.resolve(null) : computeQueryCacheKeyForConnection(connection, signature);
            },
            retain: async key => {
                const file = await cache.retain(key);
                if (file == null) return null;
                const id = ++this.nextRetained;
                this.retained.set(id, file.release);
                return { id, name: file.entry.name };
            },
            release: async id => {
                const release = this.retained.get(id);
                this.retained.delete(id);
                await release?.().catch(() => { });
            },
            file: name => cache.readFile(name),
            import: async (key, handle, crc32) => {
                const file = this.deps.handles.get<Blob | Uint8Array>(handle);
                if (file == null) throw new Error(`The result of ${key} has no file`);
                // The bytes are streamed into the file, a slice of a dropped archive never sits in memory
                const blob = file instanceof Blob ? file : new Blob([file as Uint8Array<ArrayBuffer>]);
                return await cache.importFile(key, blob, { crc32: crc32 ?? undefined });
            },
            capacity: () => cache.capacity,
            write: (key, handle) => {
                // The table is taken when the runtime calls, its handle may go before the write ends
                const table = this.deps.handles.get<arrow.Table>(handle);
                return (async () => {
                    if (table == null) throw new Error('The query has no result');
                    // Hyper writes the file into the mounted cache, the new file stays pinned until it is complete
                    const name = cache.newFileName(key);
                    const release = await cache.pin(name);
                    try {
                        await cache.writeTable(database(), table, name);
                    } finally {
                        await release();
                    }
                })();
            },
        };
    }

    /// Run a query on a connection of the runtime: the runtime registers it in the history of the connection right
    /// away and runs it once the host described it. Returns the id and the result table, null for a query without one.
    execute(runtime: core.Runtime, readConnection: (connectionId: string) => ConnectionState | null, connectionId: string, args: QueryExecutionArgs): [number, Promise<arrow.Table | null>] {
        const { logger } = this.deps;
        const trace = createTrace();
        const record: QueryRecord = {
            args,
            channel: null,
            connector: '',
            cancellation: new AbortController(),
            trino: null,
            stream: null,
            streamCancel: null,
            producing: false,
            table: null,
            messages: [],
            wakeMessages: null,
        };
        const request = this.describe(record, readConnection(connectionId), connectionId);
        // A failed description fails the query, the promise of the caller rejects with its error
        request.catch(() => { });
        const ticket = runtime.executeQuery(
            connectionId,
            { text: args.query, metadata: args.metadata as core.QueryMetadataView, traceId: trace.traceId, spanId: trace.spanId },
            request,
            args.failure,
            event => {
                try {
                    switch (event.type) {
                        case 'timing':
                            args.onTiming?.(event.label, event.elapsedMs);
                            break;
                        case 'resultsReady':
                            args.onResultsReady?.();
                            break;
                        case 'trinoTokenRefreshed': {
                            // The channel keeps the refreshed token for the next queries
                            const oauth = record.trino?.endpoint.oauthState;
                            if (oauth != null) oauth.accessToken = event.token as typeof oauth.accessToken;
                            break;
                        }
                    }
                } catch {
                    // An observer must not interrupt the query
                }
            },
        );
        const queryId = ticket.queryId;
        this.records.set(queryId, record);
        // Every abort of the caller stops the query in the runtime, it cancels the query at the backend
        const cancelFromCaller = () => {
            record.cancellation.abort(args.abortSignal?.reason ?? abortError());
            void runtime.cancelQuery(queryId).catch(() => { });
        };
        if (args.abortSignal?.aborted) {
            cancelFromCaller();
        } else {
            args.abortSignal?.addEventListener('abort', cancelFromCaller, { once: true });
        }
        const logObserver = args.onLog == null ? null : (entry: LogRecord) => {
            try {
                args.onLog?.(entry.message);
            } catch {
                // A progress surface must never interrupt query execution or logger delivery
            }
        };
        if (logObserver != null) logger.buffer.subscribeTrace(trace.traceId, logObserver);
        const execution = ticket.done.then(outcome => {
            if (outcome.status === 'resolved') return outcome.hasResult ? outcome.table as arrow.Table : null;
            throw this.errorOf(record, outcome.failure, outcome.value);
        }).finally(() => {
            args.abortSignal?.removeEventListener('abort', cancelFromCaller);
            if (logObserver != null) logger.buffer.unsubscribeTrace(trace.traceId, logObserver);
            this.records.delete(queryId);
        });
        return [queryId, execution];
    }

    /// Describe a query that the runtime runs itself, e.g. a metadata query of the catalog loader or a statement of a run
    /// of a workbook. The host keeps its record until the runtime forgets it.
    describeQuery(queryId: number, connection: ConnectionState | null, connectionId: string, query: core.RuntimeQueryDescription): Promise<unknown> {
        const cache = query.cache ?? null;
        const record: QueryRecord = {
            args: {
                query: query.text,
                metadata: query.metadata as QueryMetadata,
                readTimeoutMs: query.readTimeoutMs ?? undefined,
                throwOnError: true,
                analyzeResults: query.analyzeResults ?? false,
                publishResults: query.publishResults ?? true,
                clientFunctionCall: (query.clientFunctionCall ?? undefined) as QueryExecutionArgs['clientFunctionCall'],
                ...(cache == null ? {} : { cacheable: true, cacheSignature: cache.signature, refreshCache: cache.refresh, cacheOnly: cache.only }),
            },
            channel: null,
            connector: '',
            cancellation: new AbortController(),
            trino: null,
            stream: null,
            streamCancel: null,
            producing: false,
            table: null,
            messages: [],
            wakeMessages: null,
        };
        this.records.set(queryId, record);
        return this.describe(record, connection, connectionId);
    }

    /// A query that the runtime ran itself ended
    forget(queryId: number): void {
        this.records.delete(queryId);
    }

    /// Cancel a query of the runtime, resolves once the query ended
    cancel(runtime: core.Runtime): CancelQuery {
        return async (_connectionId, queryId) => {
            this.records.get(queryId)?.cancellation.abort(abortError());
            await runtime.cancelQuery(queryId);
        };
    }

    /// The error of a failure. What the host failed with stays, the cancellation of the caller is its reason.
    private errorOf(record: QueryRecord, failure: core.QueryRunFailure, value: unknown): unknown {
        if (failure.hostValue) {
            if (failure.kind === 'processing') {
                return value instanceof LoggableException
                    ? value
                    : new LoggableException('Query result processing failed', { error: stringifyError(value) }, LOG_CTX);
            }
            return value;
        }
        switch (failure.kind) {
            case 'cacheMiss':
                return new QueryCacheMissError();
            case 'cancelled':
                return record.args.abortSignal?.reason ?? (record.cancellation.signal.aborted ? record.cancellation.signal.reason : null) ?? abortError();
            default:
                return new LoggableException(failure.message, failure.details, failure.target);
        }
    }

    /// Where a query runs and what the executor does around it, the request of the runtime as JSON
    private async describe(record: QueryRecord, connection: ConnectionState | null, connectionId: string): Promise<unknown> {
        const { args } = record;
        if (connection == null) throw new Error(`Couldn't find a connection with id ${connectionId}`);
        const resultCache = this.deps.resultCache();
        // The cache of the app holds Parquet files that the compute database writes and reads
        let cacheKey: string | null = null;
        if (args.cacheable && args.cacheSignature && resultCache != null && supportsParquet(this.deps.computeDatabase())) {
            cacheKey = await computeQueryCacheKeyForConnection(connection, args.cacheSignature);
        }
        const logDetails: Record<string, string> = {};
        // Where a statement of a plan of workbook scripts comes from, e.g. `bar.sql 2/3 · inlines foo.sql`
        if (args.metadata.planned != null) {
            logDetails.planned = args.metadata.title ?? '';
            logDetails.node = args.metadata.planned.node.toString();
        }
        return {
            connectionId,
            text: args.query,
            target: await this.describeTarget(record, connection),
            publishResults: args.publishResults !== false,
            analyzeResults: args.analyzeResults === true,
            cache: cacheKey == null ? null : { key: cacheKey, refresh: args.refreshCache === true },
            cacheOnly: args.cacheOnly === true,
            // Nothing that runs on Salesforce changes its relations
            touchesRelations: args.metadata.userProvided && connection.connectorType !== ConnectorType.SALESFORCE_DATA_CLOUD,
            throwOnError: args.throwOnError === true,
            failure: args.failure == null ? null : { message: args.failure.message },
            logDetails,
        };
    }

    /// The target of a query: a channel that the executor speaks itself, or a channel of the host
    private async describeTarget(record: QueryRecord, connection: ConnectionState): Promise<unknown> {
        const { args } = record;
        const channel: unknown = record.channel ?? this.deps.handles.get(connection.details.channel) ?? null;
        record.channel = channel;
        record.connector = CONNECTOR_INFOS[connection.connectorType as ConnectorType].names.displayLong;
        // The runtime loads the spec of the connector through the extensions of the platform
        if (args.clientFunctionCall != null) {
            const salesforce = channel as SalesforceDatabaseChannel | null;
            const tokens = salesforce?.coreToken != null && salesforce.dataCloudToken != null
                ? { core: salesforce.coreToken, dataCloud: salesforce.dataCloudToken }
                : null;
            return { type: 'clientFunction', connector: connection.connectorType, spec: null, description: args.clientFunctionCall, tokens };
        }
        // A Trino channel whose requests go over the HTTP client of the platform
        if (channel instanceof TrinoChannel) {
            const endpoint = channel.endpoint;
            record.trino = channel;
            return {
                type: 'trino',
                endpoint: endpoint.endpoint,
                auth: endpoint.authParams,
                accessToken: endpoint.oauthState?.accessToken ?? null,
                catalog: channel.defaults.catalog,
                schema: channel.defaults.schema,
            };
        }
        // A Hyper channel over the HTTP API, also the one of a Salesforce connection
        const hyper = channel as HyperDatabaseChannel | null;
        if (hyper?.describeHttp != null) {
            const described = await hyper.describeHttp();
            if (described != null) {
                return {
                    type: 'hyperHttp',
                    params: described.params,
                    clientContext: described.clientContext,
                    auth: described.auth,
                    parallelChunks: described.parallelChunks,
                };
            }
        }
        return { type: 'host' };
    }

    /// A query of a record
    private recordOf(queryId: number): QueryRecord {
        const record = this.records.get(queryId);
        if (record == null) throw new Error(`Unknown query ${queryId}`);
        return record;
    }

    /// Queue a message of a channel
    private pushMessage(record: QueryRecord, message: ChannelMessage): void {
        record.messages.push(message);
        const wake = record.wakeMessages;
        record.wakeMessages = null;
        wake?.();
    }

    /// Start producing the result of a channel into the table of the query
    private produce(record: QueryRecord, stream: QueryExecutionResponseStream, table: number): void {
        const publish = record.args.publishResults !== false;
        const result = this.deps.tables.stream(table);
        let batches = 0;
        const batchConsumer = {
            resolve: (_stream: QueryExecutionResponseStream, batch: arrow.RecordBatch) => {
                if (!publish) return;
                ++batches;
                // The batch stays here, the executor follows the metrics
                result?.pushBatch(batch);
                this.pushMessage(record, { type: 'batch', metrics: stream.getMetrics() });
            },
            reject: () => { },
        };
        const progressConsumer = {
            resolve: (_stream: QueryExecutionResponseStream, progress: QueryExecutionProgress) => {
                this.pushMessage(record, { type: 'progress', progress: progress as core.QueryProgressView });
            },
            reject: () => { },
        };
        record.producing = true;
        Promise.resolve().then(() => stream.produce(batchConsumer, progressConsumer, record.cancellation.signal)).then(
            async () => {
                if (publish && batches === 0) {
                    result?.setSchema(await stream.getSchema() ?? new arrow.Schema());
                }
                this.pushMessage(record, { type: 'end', metrics: stream.getMetrics() });
            },
        ).catch((error: unknown) => this.pushMessage(record, { type: 'error', error }));
    }

    /// The next message of a channel
    private async nextMessage(record: QueryRecord): Promise<core.RuntimeChannelMessage> {
        if (record.stream == null) throw new Error('The query has no stream');
        if (!record.producing && record.table != null) this.produce(record, record.stream, record.table);
        while (record.messages.length === 0) {
            await new Promise<void>(resolve => { record.wakeMessages = resolve; });
        }
        const message = record.messages.shift()!;
        if (message.type === 'error') throw message.error;
        return message;
    }
}

/// The executor of the queries of a runtime as a function
export type { QueryExecutor };
