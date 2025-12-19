import * as arrow from 'apache-arrow';
import * as proto from "@ankoh/dashql-protobuf";

import { Logger } from '../../platform/logger.js';
import { createQueryResponseStreamMetrics, QueryExecutionProgress, QueryExecutionResponseStream, QueryExecutionMetrics, QueryExecutionStatus } from "../../connection/query_execution_state.js";
import { TRINO_STATUS_HTTP_ERROR, TRINO_STATUS_OK, TRINO_STATUS_OTHER_ERROR, TrinoApiClientInterface, TrinoApiEndpoint, TrinoQueryData, TrinoQueryResult, TrinoQueryStatistics } from "./trino_api_client.js";
import { ChannelError, RawProxyError } from '../../platform/channel_common.js';
import { AsyncValue } from '../../utils/async_value.js';
import { AsyncConsumer } from '../../utils/async_consumer.js';

const LOG_CTX = 'trino_channel';

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
    /// The progress updates
    latestQueryProgress: QueryExecutionProgress | null;
    /// The metrics
    queryMetrics: QueryExecutionMetrics;

    /// The constructor
    constructor(logger: Logger, apiClient: TrinoApiClientInterface, result: TrinoQueryResult, metrics: QueryExecutionMetrics) {
        this.logger = logger;
        this.apiClient = apiClient;
        this.currentStatus = QueryExecutionStatus.RUNNING;
        this.responseMetadata = new Map();
        this.resultSchema = new AsyncValue();
        this.latestQueryResult = result;
        this.latestQueryStats = result.stats ?? null;
        this.latestQueryState = result.stats?.state ?? null;
        this.latestQueryProgress = null;
        this.queryMetrics = metrics;
    }

    /// Fetch the next query result
    async fetchNextQueryResult(): Promise<TrinoQueryResult | null> {
        // Do we have a next URI?
        const nextUri = this.latestQueryResult?.nextUri;
        if (!nextUri) {
            return null;
        }
        this.logger.debug("fetching next query results", { "nextUri": nextUri }, LOG_CTX);

        // Get the next query result
        this.queryMetrics.totalQueryRequestsStarted += 1;
        const timeBefore = (new Date()).getTime();
        const queryResult = await this.apiClient.getQueryResult(nextUri);
        const timeAfter = (new Date()).getTime();
        this.latestQueryResult = queryResult;
        this.latestQueryStats = queryResult.stats ?? null;
        this.latestQueryState = this.latestQueryStats?.state ?? null;

        // Did the query fail?
        if (queryResult.error) {
            const errorCode = queryResult.error.errorCode;
            const errorName = queryResult.error.errorName;
            const errorType = queryResult.error.errorType;
            const errorMessage = queryResult.error.message;

            const rawError: RawProxyError = {
                message: "query returned an error",
                details: {
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
    /// Await the next record batch
    async produce(batches: AsyncConsumer<QueryExecutionResponseStream, arrow.RecordBatch | null>, progress: AsyncConsumer<QueryExecutionResponseStream, QueryExecutionProgress>, abort?: AbortSignal): Promise<void> {
        try {
            // While still running
            while (this.latestQueryState == "QUEUED" || this.latestQueryState == "RUNNING" || this.latestQueryState == "FINISHING") {
                // Fetch the next query result
                const result = await this.fetchNextQueryResult();
                abort?.throwIfAborted();

                // Has a data attribute?
                if (Array.isArray(result?.data)) {
                    // Have result data but not schema yet?
                    // This is unexpected.
                    if (!this.resultSchema.isResolved()) {
                        throw new Error("result schema is mssing");
                    }
                    // Translate the trino batch
                    const schema = this.resultSchema.getResolvedValue();
                    const resultBatch = translateTrinoBatch(schema!, result.data, this.logger);
                    this.queryMetrics.totalBatchesReceived += 1;
                    this.queryMetrics.totalRowsReceived += resultBatch.numRows;

                    // Publish a new progress update
                    this.latestQueryProgress = deriveProgress(this.latestQueryStats, this.queryMetrics);
                    progress.resolve(this, this.latestQueryProgress);

                    // Produce a batch
                    batches.resolve(this, resultBatch);
                    abort?.throwIfAborted();
                } else {
                    // Publish the progress update
                    this.latestQueryProgress = deriveProgress(this.latestQueryStats, this.queryMetrics);
                    progress.resolve(this, this.latestQueryProgress);
                }
            }
            this.logger.debug("reached end of query result stream", { "queryState": this.latestQueryState });
        } catch (e: any) {
            throw e;
        }
    }
}

export interface TrinoHealthCheckResult {
    /// Did the health check succeed?
    ok: boolean;
    /// The http status (if any)
    httpStatus: number | null;
    /// The error (if any)
    error: any | null;
}

export interface TrinoChannelInterface {
    /// Perform a health check
    checkHealth(): Promise<TrinoHealthCheckResult>;
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
    /// The catalog name
    catalogName: string;

    /// Constructor
    constructor(logger: Logger, client: TrinoApiClientInterface, endpoint: TrinoApiEndpoint, catalogName: string) {
        this.logger = logger;
        this.apiClient = client;
        this.endpoint = endpoint;
        this.catalogName = catalogName;
    }

    /// Perform a health check
    async checkHealth(): Promise<TrinoHealthCheckResult> {
        const status = await this.apiClient.checkHealth(this.endpoint);
        switch (status.type) {
            case TRINO_STATUS_OK:
                return { ok: true, httpStatus: null, error: null };
            case TRINO_STATUS_HTTP_ERROR:
                return { ok: false, httpStatus: status.value.status, error: null };
            case TRINO_STATUS_OTHER_ERROR:
                return { ok: false, httpStatus: null, error: status.value };
        }
    }

    /// Execute Query
    async executeQuery(param: proto.salesforce_hyperdb_grpc_v1.pb.QueryParam): Promise<TrinoQueryResultStream> {
        const metrics = createQueryResponseStreamMetrics();
        const timeBefore = (new Date()).getTime();

        try {
            this.logger.debug("executing query", {}, LOG_CTX);
            metrics.totalQueryRequestsStarted += 1;

            const result = await this.apiClient.runQuery(this.endpoint, this.catalogName, param.query);
            const timeAfter = (new Date()).getTime();

            metrics.totalQueryRequestsSucceeded += 1;
            metrics.totalQueryRequestDurationMs += timeAfter - timeBefore;

            this.logger.debug("opened query result stream", {}, LOG_CTX);
            const stream = new TrinoQueryResultStream(this.logger, this.apiClient, result, metrics);
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
        // return new arrow.Utf8();
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
        // Use 128-bit decimal for high precision, 64-bit otherwise
        if (precision > 18) {
            return new arrow.Decimal(scale, precision, 256);
        }
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

/// Create a row writer function for a given Arrow type
function createRowWriter(field: arrow.Field): (builder: arrow.Builder, v: any) => void {
    const typeId = field.typeId;

    switch (typeId) {
        // Boolean
        case arrow.Type.Bool:
            return (b, v) => b.append(v == null ? null : Boolean(v));

        // Integer types - Trino returns these as numbers or strings for bigint
        case arrow.Type.Int8:
        case arrow.Type.Int16:
        case arrow.Type.Int32:
            return (b, v) => {
                if (v == null || v === '') {
                    b.append(null);
                } else {
                    const num = Number(v);
                    b.append(Number.isNaN(num) ? null : num);
                }
            };
        case arrow.Type.Int64:
            return (b, v) => {
                if (v == null || v === '') {
                    b.append(null);
                } else {
                    try {
                        b.append(BigInt(v));
                    } catch {
                        // If conversion fails, treat as null
                        b.append(null);
                    }
                }
            };

        // Floating-point types
        case arrow.Type.Float32:
        case arrow.Type.Float:
        case arrow.Type.Float64:
            return (b, v) => {
                if (v == null || v === '') {
                    b.append(null);
                } else {
                    const num = Number(v);
                    b.append(Number.isNaN(num) ? null : num);
                }
            };

        // Decimal - Trino returns as string
        case arrow.Type.Decimal:
            return (b, v) => b.append(v == null ? null : String(v));

        // String types
        case arrow.Type.Utf8:
            return (b, v) => b.append(v == null ? null : String(v));

        // Binary
        case arrow.Type.Binary:
            return (b, v) => {
                if (v == null) {
                    b.append(null);
                } else if (v instanceof Uint8Array) {
                    b.append(v);
                } else if (typeof v === 'string') {
                    // Trino returns varbinary as base64 or hex string
                    const bytes = Uint8Array.from(atob(v), c => c.charCodeAt(0));
                    b.append(bytes);
                } else {
                    b.append(null);
                }
            };

        // Date - Trino returns as "YYYY-MM-DD" string
        case arrow.Type.DateDay:
            return (b, v) => {
                if (v == null || v === '') {
                    b.append(null);
                } else {
                    // Convert date string to days since epoch
                    const date = new Date(v);
                    const ms = date.getTime();
                    if (Number.isNaN(ms)) {
                        b.append(null);
                    } else {
                        const days = Math.floor(ms / (24 * 60 * 60 * 1000));
                        b.append(days);
                    }
                }
            };

        case arrow.Type.DateMillisecond:
            return (b, v) => {
                if (v == null || v === '') {
                    b.append(null);
                } else {
                    const date = new Date(v);
                    const ms = date.getTime();
                    if (Number.isNaN(ms)) {
                        b.append(null);
                    } else {
                        b.append(ms);
                    }
                }
            };

        // Time - Trino returns as "HH:MM:SS.sss" string
        case arrow.Type.TimeMillisecond:
            return (b, v) => {
                if (v == null) {
                    b.append(null);
                } else {
                    // Parse time string to milliseconds since midnight
                    const parts = String(v).split(':');
                    const hours = parseInt(parts[0], 10) || 0;
                    const minutes = parseInt(parts[1], 10) || 0;
                    const secondsParts = (parts[2] || '0').split('.');
                    const seconds = parseInt(secondsParts[0], 10) || 0;
                    const millis = parseInt((secondsParts[1] || '0').padEnd(3, '0').slice(0, 3), 10);
                    const totalMs = ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
                    b.append(totalMs);
                }
            };

        // Timestamp - Trino returns as ISO string or "YYYY-MM-DD HH:MM:SS.sss" format
        case arrow.Type.TimestampMillisecond:
        case arrow.Type.Timestamp:
            return (b, v) => {
                if (v == null || v === '') {
                    b.append(null);
                } else {
                    // Parse timestamp string to milliseconds since epoch
                    const date = new Date(String(v).replace(' ', 'T'));
                    const ms = date.getTime();
                    if (Number.isNaN(ms)) {
                        b.append(null);
                    } else {
                        b.append(BigInt(ms));
                    }
                }
            };

        // Default - treat as string (includes complex types like arrays, maps, rows as JSON)
        default:
            return (b, v) => {
                if (v == null) {
                    b.append(null);
                } else if (typeof v === 'object') {
                    // Complex types (arrays, maps, rows) are JSON stringified
                    b.append(JSON.stringify(v));
                } else {
                    b.append(String(v));
                }
            };
    }
}

/// Create builder for a given Arrow field
function createBuilder(field: arrow.Field): arrow.Builder {
    const typeId = field.typeId;

    switch (typeId) {
        case arrow.Type.Bool:
            return new arrow.BoolBuilder({ type: field.type });
        case arrow.Type.Int8:
            return new arrow.Int8Builder({ type: field.type });
        case arrow.Type.Int16:
            return new arrow.Int16Builder({ type: field.type });
        case arrow.Type.Int32:
            return new arrow.Int32Builder({ type: field.type });
        case arrow.Type.Int64:
            return new arrow.Int64Builder({ type: field.type });
        case arrow.Type.Float32:
        case arrow.Type.Float:
            return new arrow.Float32Builder({ type: field.type });
        case arrow.Type.Float64:
            return new arrow.Float64Builder({ type: field.type });
        case arrow.Type.Decimal:
            return new arrow.DecimalBuilder({ type: field.type as arrow.Decimal });
        case arrow.Type.Utf8:
            return new arrow.Utf8Builder({ type: field.type });
        case arrow.Type.Binary:
            return new arrow.BinaryBuilder({ type: field.type });
        case arrow.Type.DateDay:
            return new arrow.DateDayBuilder({ type: field.type });
        case arrow.Type.DateMillisecond:
            return new arrow.DateMillisecondBuilder({ type: field.type });
        case arrow.Type.TimeMillisecond:
            return new arrow.TimeMillisecondBuilder({ type: field.type });
        case arrow.Type.TimestampMillisecond:
        case arrow.Type.Timestamp:
            return new arrow.TimestampMillisecondBuilder({ type: field.type as arrow.TimestampMillisecond });
        default:
            // Default to Utf8 for unknown types (including complex types serialized as JSON)
            return new arrow.Utf8Builder({ type: new arrow.Utf8() });
    }
}

/// Translate the Trino batch
function translateTrinoBatch(schema: arrow.Schema, rows: TrinoQueryData, _logger: Logger): arrow.RecordBatch {
    // Create column builders and row writers
    const columnBuilders: arrow.Builder[] = [];
    const rowWriters: ((builder: arrow.Builder, v: any) => void)[] = [];

    for (let i = 0; i < schema.fields.length; ++i) {
        const field = schema.fields[i];
        columnBuilders.push(createBuilder(field));
        rowWriters.push(createRowWriter(field));
    }

    // Translate all rows - ensure every column gets a value for every row
    const numColumns = schema.fields.length;
    for (let i = 0; i < rows.length; ++i) {
        const row = rows[i];
        for (let j = 0; j < numColumns; ++j) {
            // Get value from row, or null if row is missing/short
            const value = (row != null && j < row.length) ? row[j] : null;
            rowWriters[j](columnBuilders[j], value);
        }
    }

    // Flush all columns
    const columnData: arrow.Data[] = columnBuilders.map(col => {
        col.finish();
        return col.flush();
    });
    const structData = arrow.makeData({
        nullCount: 0,
        type: new arrow.Struct(schema.fields),
        children: columnData,
        length: rows.length
    });

    // Construct the record batch
    return new arrow.RecordBatch(schema, structData);
}

/// Derive the execution progress
function deriveProgress(stats: TrinoQueryStatistics | null, metrics: QueryExecutionMetrics): QueryExecutionProgress {
    return {
        isQueued: stats?.queued ?? null,
        metrics: { ...metrics }
    };
}
