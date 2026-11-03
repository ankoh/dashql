import * as arrow from 'apache-arrow';
import * as proto from "../../proto.js";

import { Logger } from '../../platform/logger/logger.js';
import { createQueryResponseStreamMetrics, QueryExecutionProgress, QueryExecutionResponseStream, QueryExecutionMetrics, QueryExecutionStatus } from "../../query/query_execution_state.js";
import { yieldToBrowser } from '../../utils/yield_to_browser.js';
import { TrinoApiClientInterface, TrinoApiEndpoint, TrinoQueryData, TrinoQueryResult, TrinoQueryStatistics } from "./trino_api_client.js";
import { ChannelError, RawProxyError } from '../../platform/channel_common.js';
import { AsyncValue } from '../../utils/async_value.js';
import { AsyncConsumer } from '../../utils/async_consumer.js';
import { translateAnyRowsToArrowBatch } from './arrow_conversion.js';

const LOG_CTX = 'trino_channel';
/// Sample the statistics of the stages this often, Trino refreshes them about every 3 seconds
const QUERY_INFO_SAMPLE_INTERVAL_MS = 3000;
/// Wait this long for the last sample of the statistics of a finished query
const QUERY_INFO_FINAL_SAMPLE_TIMEOUT_MS = 3000;

export interface TrinoQueryExecutionProgress extends QueryExecutionProgress { }

export class TrinoQueryResultStream implements QueryExecutionResponseStream {
    /// The logger
    logger: Logger;
    /// The api client
    apiClient: TrinoApiClientInterface;
    /// The current execution status
    currentStatus: QueryExecutionStatus;
    /// The response metadata
    responseMetadata: Map<string, string>;
    /// The schema
    resultSchema: AsyncValue<arrow.Schema, Error>;
    /// The current result
    latestQueryResult: TrinoQueryResult | null;
    /// The latest statistics
    latestQueryStats: TrinoQueryStatistics | null;
    /// The latest query state
    latestQueryState: string | null;
    /// When the latest result arrived, in milliseconds since epoch
    latestQueryReceivedAt: number;
    /// Was the QueryInfo with the plans of the stages requested?
    queryInfoRequested: boolean = false;
    /// The request of the QueryInfo with the plans
    queryInfoPlan: Promise<void> | null = null;
    /// The pending sample of the pruned QueryInfo
    queryInfoSample: Promise<void> | null = null;
    /// The timer of the samples
    queryInfoTimer: ReturnType<typeof setInterval> | null = null;
    /// Is the profile shown?
    profileDetail: boolean = false;
    /// The consumer of the progress while the stream produces
    progressConsumer: AsyncConsumer<QueryExecutionResponseStream, QueryExecutionProgress> | null = null;
    /// The abort signal of the stream while it produces
    produceAbort: AbortSignal | null = null;
    /// The progress updates
    latestQueryProgress: QueryExecutionProgress | null;
    /// The metrics
    queryMetrics: QueryExecutionMetrics;
    endpoint: TrinoApiEndpoint;

    /// The constructor
    constructor(logger: Logger, apiClient: TrinoApiClientInterface, endpoint: TrinoApiEndpoint, result: TrinoQueryResult, metrics: QueryExecutionMetrics) {
        this.logger = logger;
        this.apiClient = apiClient;
        this.currentStatus = QueryExecutionStatus.RUNNING;
        this.responseMetadata = new Map();
        this.resultSchema = new AsyncValue();
        this.latestQueryResult = result;
        this.latestQueryStats = result.stats ?? null;
        this.latestQueryState = result.stats?.state ?? null;
        this.latestQueryReceivedAt = Date.now();
        this.latestQueryProgress = null;
        this.queryMetrics = metrics;
        this.endpoint = endpoint;
        if (result.columns) {
            this.resultSchema.resolve(translateTrinoSchema(result, this.logger));
        }
    }

    /// Cancel the query, a query without a next URI is done already
    async cancel(): Promise<void> {
        const nextUri = this.latestQueryResult?.nextUri;
        if (nextUri != null) await this.apiClient.cancelQuery(this.endpoint, nextUri);
    }

    /// Is the profile of the query shown? The plan and the samples of its statistics are fetched only then.
    setProfileDetail(wanted: boolean): void {
        this.profileDetail = wanted;
        if (!wanted && this.queryInfoTimer != null) {
            clearInterval(this.queryInfoTimer);
            this.queryInfoTimer = null;
        }
        this.requestProfile();
    }

    /// Request the QueryInfo with the plans of the stages once the stages exist and the profile is shown, then
    /// sample the statistics of the stages while the query runs. The plan arrives as progress, the requests do not
    /// hold up the query, a failed request leaves the stages without plan.
    requestProfile(): void {
        const progress = this.progressConsumer;
        const abort = this.produceAbort ?? undefined;
        const queryId = this.latestQueryResult?.id;
        if (!this.profileDetail || progress == null || this.latestQueryStats?.rootStage == null || !queryId) return;
        if (!this.queryInfoRequested) {
            this.queryInfoRequested = true;
            this.queryInfoPlan = this.apiClient.getQueryInfo(this.endpoint, queryId, abort).then(
                info => {
                    progress.resolve(this, {
                        ...deriveProgress(this.latestQueryStats, this.queryMetrics, this.latestQueryReceivedAt),
                        engineProgress: { kind: 'trino_query_info', info, receivedAt: Date.now() },
                    });
                },
                (e: unknown) => this.logger.warn("Failed to fetch the query plan", { "error": String(e) }, LOG_CTX),
            );
        }
        this.queryInfoTimer ??= setInterval(() => void this.sampleQueryInfo(), QUERY_INFO_SAMPLE_INTERVAL_MS);
    }

    /// Sample the pruned QueryInfo: the operator summaries of the stages, without plans. One sample at a time.
    sampleQueryInfo(): Promise<void> {
        const progress = this.progressConsumer;
        const queryId = this.latestQueryResult?.id;
        if (progress == null || !queryId) return Promise.resolve();
        this.queryInfoSample ??= this.apiClient.getQueryInfo(this.endpoint, queryId, this.produceAbort ?? undefined, true).then(
            info => {
                progress.resolve(this, {
                    ...deriveProgress(this.latestQueryStats, this.queryMetrics, this.latestQueryReceivedAt),
                    engineProgress: { kind: 'trino_query_info_stats', info, receivedAt: Date.now() },
                });
            },
            (e: unknown) => this.logger.debug("Failed to sample the query statistics", { "error": String(e) }, LOG_CTX),
        ).finally(() => {
            this.queryInfoSample = null;
        });
        return this.queryInfoSample;
    }

    /// Stop sampling. After a query that finished, take a last sample: the operator summaries are complete now.
    /// The query waits for it, but not longer than a bound.
    async finishQueryInfo(finished: boolean): Promise<void> {
        if (this.queryInfoTimer != null) clearInterval(this.queryInfoTimer);
        this.queryInfoTimer = null;
        if (finished && this.profileDetail && this.queryInfoRequested) {
            const pending = this.queryInfoPlan ?? Promise.resolve();
            const last = pending.then(() => this.sampleQueryInfo());
            let timer: ReturnType<typeof setTimeout> | null = null;
            const bound = new Promise<void>(resolve => { timer = setTimeout(resolve, QUERY_INFO_FINAL_SAMPLE_TIMEOUT_MS); });
            await Promise.race([last, bound]);
            if (timer != null) clearTimeout(timer);
        }
        // Progress after the end of the stream is dropped
        this.progressConsumer = null;
        this.produceAbort = null;
    }

    /// Fetch the next query result
    async fetchNextQueryResult(abort?: AbortSignal): Promise<TrinoQueryResult | null> {
        // Do we have a next URI?
        const nextUri = this.latestQueryResult?.nextUri;
        if (!nextUri) {
            return null;
        }
        this.logger.debug("Fetching next query results", { "nextUri": nextUri }, LOG_CTX);

        // Get the next query result
        this.queryMetrics.totalQueryRequestsStarted += 1;
        const timeBefore = (new Date()).getTime();
        const queryResult = await this.apiClient.getQueryResult(this.endpoint, nextUri, abort);
        const timeAfter = (new Date()).getTime();
        this.latestQueryResult = queryResult;
        this.latestQueryStats = queryResult.stats ?? null;
        this.latestQueryState = this.latestQueryStats?.state ?? null;
        this.latestQueryReceivedAt = Date.now();

        // Did the query fail?
        if (queryResult.error) {
            const errorCode = queryResult.error.errorCode;
            const errorName = queryResult.error.errorName;
            const errorType = queryResult.error.errorType;
            const errorMessage = queryResult.error.message;

            const rawError: RawProxyError = {
                message: "Query returned an error",
                data: {
                    "errorCode": errorCode.toString(),
                    "errorName": errorName,
                    "errorType": errorType,
                    "errorMessage": errorMessage,
                },
            };
            const error = new ChannelError(rawError, errorCode, undefined, LOG_CTX);
            if (!this.resultSchema.isResolved()) {
                this.resultSchema.reject(error);
            }
            this.queryMetrics.totalQueryRequestsFailed += 1;
            throw error;
        } else {
            this.queryMetrics.totalQueryRequestsSucceeded += 1;
        }
        this.queryMetrics.totalQueryRequestDurationMs += timeAfter - timeBefore;

        // Do we already have a schema?
        if (!this.resultSchema.isResolved() && queryResult.columns) {
            // Attempt to translate the schema
            const translated = translateTrinoSchema(queryResult, this.logger);
            this.resultSchema.resolve(translated);
        }
        return queryResult;
    }

    /// Get the result metadata (after completion)
    getMetadata(): Map<string, string> {
        return new Map();
    }
    /// Get the stream metrics
    getMetrics(): QueryExecutionMetrics {
        return this.queryMetrics;
    }
    /// Get the current query status
    getStatus(): QueryExecutionStatus {
        return this.currentStatus;
    }
    /// Await the schema message
    async getSchema(): Promise<arrow.Schema | null> {
        return this.resultSchema.getValue();
    }
    /// Await the next record batch.
    /// The stream follows the next URIs until Trino stops sending one, the query state does not end the stream:
    /// Trino reports states like PLANNING before the rows and FINISHED while the coordinator still buffers rows.
    async produce(batches: AsyncConsumer<QueryExecutionResponseStream, arrow.RecordBatch | null>, progress: AsyncConsumer<QueryExecutionResponseStream, QueryExecutionProgress>, abort?: AbortSignal): Promise<void> {
        this.progressConsumer = progress;
        this.produceAbort = abort ?? null;
        // The response to the query request carries the first progress (QUEUED)
        if (this.latestQueryStats != null) {
            this.latestQueryProgress = deriveProgress(this.latestQueryStats, this.queryMetrics, this.latestQueryReceivedAt);
            progress.resolve(this, this.latestQueryProgress);
            this.requestProfile();
        }
        let pending = this.fetchNextQueryResult(abort);
        try {
            while (true) {
                const result = await pending;
                abort?.throwIfAborted();
                if (result == null) {
                    break;
                }
                // Request the next page before translating this one, Trino fills the page while we translate
                pending = this.fetchNextQueryResult(abort);

                // Has a data attribute?
                if (Array.isArray(result.data)) {
                    // Have result data but not schema yet?
                    // This is unexpected.
                    if (!this.resultSchema.isResolved()) {
                        throw new Error("Result schema is missing");
                    }
                    // Translate the trino batch
                    const schema = this.resultSchema.getResolvedValue();
                    const resultBatch = translateAnyRowsToArrowBatch(schema!, result.data, this.logger);
                    this.queryMetrics.totalBatchesReceived += 1;
                    this.queryMetrics.totalRowsReceived += resultBatch.numRows;

                    // Publish a new progress update
                    this.latestQueryProgress = deriveProgress(result.stats ?? null, this.queryMetrics, this.latestQueryReceivedAt);
                    progress.resolve(this, this.latestQueryProgress);
                    this.requestProfile();

                    // Produce a batch
                    batches.resolve(this, resultBatch);
                    abort?.throwIfAborted();
                    await yieldToBrowser();
                } else {
                    // Publish the progress update
                    this.latestQueryProgress = deriveProgress(result.stats ?? null, this.queryMetrics, this.latestQueryReceivedAt);
                    progress.resolve(this, this.latestQueryProgress);
                    this.requestProfile();
                }
            }
            this.logger.debug("Reached end of query result stream", { "queryState": this.latestQueryState }, LOG_CTX);
            await this.finishQueryInfo(true);
        } catch (e: any) {
            // Don't leave the request of the next page as unhandled rejection
            pending.catch(() => { });
            await this.finishQueryInfo(false);
            throw e;
        }
    }
}

export interface TrinoChannelInterface {
    /// Execute Query
    executeQuery(param: proto.salesforce_hyperdb_grpc_v1.pb.QueryParam, abort?: AbortSignal): Promise<TrinoQueryResultStream>;
    /// Destroy the connection
    close(): Promise<void>;
}

export class TrinoChannel implements TrinoChannelInterface {
    /// The logger
    logger: Logger;
    /// The client
    apiClient: TrinoApiClientInterface;
    /// The trino api endpoint
    endpoint: TrinoApiEndpoint;

    /// Constructor
    constructor(logger: Logger, client: TrinoApiClientInterface, endpoint: TrinoApiEndpoint) {
        this.logger = logger;
        this.apiClient = client;
        this.endpoint = endpoint;
    }

    /// Execute Query
    async executeQuery(param: proto.salesforce_hyperdb_grpc_v1.pb.QueryParam, abort?: AbortSignal): Promise<TrinoQueryResultStream> {
        const metrics = createQueryResponseStreamMetrics();
        const timeBefore = (new Date()).getTime();

        try {
            this.logger.debug("Executing query", {}, LOG_CTX);
            metrics.totalQueryRequestsStarted += 1;

            const result = await this.apiClient.runQuery(this.endpoint, param.query, abort);
            const timeAfter = (new Date()).getTime();

            metrics.totalQueryRequestsSucceeded += 1;
            metrics.totalQueryRequestDurationMs += timeAfter - timeBefore;

            this.logger.debug("Opened query result stream", {}, LOG_CTX);
            const stream = new TrinoQueryResultStream(this.logger, this.apiClient, this.endpoint, result, metrics);
            return stream;
        } catch (e: any) {
            const timeAfter = (new Date()).getTime();
            metrics.totalQueryRequestsFailed += 1;
            metrics.totalQueryRequestDurationMs += timeAfter - timeBefore;
            throw e;
        }
    }

    /// Destroy the connection
    async close(): Promise<void> {
        return;
    }
}

/// Parse a Trino type string and return the corresponding Arrow DataType
function parseTrinoType(typeStr: string): arrow.DataType {
    const type = typeStr.toLowerCase().trim();

    // Boolean
    if (type === "boolean") {
        return new arrow.Bool();
    }
    // Integer types
    if (type === "tinyint") {
        return new arrow.Int8();
    }
    if (type === "smallint") {
        return new arrow.Int16();
    }
    if (type === "integer" || type === "int") {
        return new arrow.Int32();
    }
    if (type === "bigint") {
        return new arrow.Int64();
    }
    // Floating-point types
    if (type === "real") {
        return new arrow.Float32();
    }
    if (type === "double") {
        return new arrow.Float64();
    }

    // Decimal types: decimal(precision, scale)
    const decimalMatch = type.match(/^decimal\((\d+),\s*(\d+)\)$/);
    if (decimalMatch) {
        const precision = parseInt(decimalMatch[1], 10);
        const scale = parseInt(decimalMatch[2], 10);
        return new arrow.Decimal(scale, precision, 128);
    }
    if (type === "decimal") {
        // Default decimal without precision/scale
        return new arrow.Decimal(0, 38, 128);
    }

    // String types
    if (type === "varchar" || type.startsWith("varchar(") || type === "char" || type.startsWith("char(")) {
        return new arrow.Utf8();
    }
    if (type === "varbinary") {
        return new arrow.Binary();
    }
    if (type === "json") {
        return new arrow.Utf8(); // JSON is represented as string
    }
    // Date/Time types
    if (type === "date") {
        return new arrow.DateDay();
    }
    if (type === "time" || type.startsWith("time(")) {
        return new arrow.TimeMillisecond();
    }
    if (type === "time with time zone" || type.startsWith("time(") && type.includes("with time zone")) {
        return new arrow.TimeMillisecond();
    }
    if (type === "timestamp" || type.startsWith("timestamp(")) {
        if (type.includes("with time zone")) {
            return new arrow.TimestampMillisecond("UTC");
        }
        return new arrow.TimestampMillisecond();
    }
    // Interval types - represent as strings since Arrow has limited interval support
    if (type.startsWith("interval")) {
        return new arrow.Utf8();
    }
    // UUID - represent as string
    if (type === "uuid") {
        return new arrow.Utf8();
    }
    // IP address - represent as string
    if (type === "ipaddress") {
        return new arrow.Utf8();
    }
    // Complex types (array, map, row) - represent as JSON strings for simplicity
    // The Arrow JS API for complex types is cumbersome; JSON serialization is practical
    if (type.startsWith("array(") || type.startsWith("map(") || type.startsWith("row(")) {
        return new arrow.Utf8();
    }

    // Unknown type - fall back to string representation
    return new arrow.Utf8();
}

/// Translate the Trino schema
function translateTrinoSchema(result: TrinoQueryResult, logger: Logger): arrow.Schema {
    let fields: arrow.Field[] = [];
    for (const column of result.columns!) {
        const arrowType = parseTrinoType(column.type);
        fields.push(new arrow.Field(column.name, arrowType, true));
    }
    return new arrow.Schema(fields);
}

/// Derive the execution progress of the statistics of a response that arrived at a time (milliseconds since epoch)
export function deriveProgress(stats: TrinoQueryStatistics | null, metrics: QueryExecutionMetrics, receivedAt: number): QueryExecutionProgress {
    return {
        isQueued: stats?.queued ?? null,
        progressPercent: stats?.progressPercentage ?? null,
        resultRows: null,
        rowsProcessed: stats?.processedRows ?? null,
        executionTimeMs: stats?.elapsedTimeMillis ?? null,
        metrics: { ...metrics },
        phase: stats?.state ?? null,
        engineProgress: stats == null ? null : { kind: 'trino_statement_stats', stats, receivedAt },
    };
}
