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
        // return new arrow.Int64();
        return new arrow.Float64();
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

// Shared TextEncoder for string encoding
const textEncoder = new TextEncoder();

/// Create a validity bitmap from an array indicating which values are null
/// Returns [bitmap, nullCount]
function createValidityBitmap(n: number, isNull: boolean[]): [Uint8Array, number] {
    const validityBytes = Math.max(1, ((n + 63) & ~63) >> 3);
    const bitmap = new Uint8Array(validityBytes).fill(255); // all valid initially
    let nullCount = 0;

    for (let i = 0; i < n; i++) {
        if (isNull[i]) {
            const byte = i >> 3;
            const bit = i & 7;
            bitmap[byte] &= ~(1 << bit); // clear bit = null
            nullCount++;
        }
    }
    return [bitmap, nullCount];
}

/// Create Arrow Data for boolean column
function createBoolData(type: arrow.DataType, values: any[]): arrow.Data {
    const n = values.length;
    const isNull = new Array<boolean>(n).fill(false);
    const byteLen = Math.max(1, (n + 7) >> 3);
    const buffer = new Uint8Array(byteLen);

    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v == null) {
            isNull[i] = true;
        } else if (Boolean(v)) {
            buffer[i >> 3] |= (1 << (i & 7));
        }
    }

    const [validityBitmap, nullCount] = createValidityBitmap(n, isNull);
    return new arrow.Data(type, 0, n, nullCount, [undefined, buffer, validityBitmap]);
}

/// Create Arrow Data for fixed-width numeric types (Int8, Int16, Int32, Float32, Float64)
function createNumericData(type: arrow.DataType, values: any[]): arrow.Data {
    const n = values.length;
    const isNull = new Array<boolean>(n).fill(false);
    const buffer = new (type.ArrayType as any)(n);

    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v == null || v === '') {
            isNull[i] = true;
        } else {
            const num = Number(v);
            if (Number.isNaN(num)) {
                isNull[i] = true;
            } else {
                buffer[i] = num;
            }
        }
    }

    const [validityBitmap, nullCount] = createValidityBitmap(n, isNull);
    return new arrow.Data(type, 0, n, nullCount, [undefined, buffer, validityBitmap]);
}

/// Create Arrow Data for Int64/BigInt types
function createBigIntData(type: arrow.DataType, values: any[]): arrow.Data {
    const n = values.length;
    const isNull = new Array<boolean>(n).fill(false);
    const buffer = new BigInt64Array(n);

    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v == null || v === '') {
            isNull[i] = true;
        } else {
            try {
                buffer[i] = BigInt(v);
            } catch {
                isNull[i] = true;
            }
        }
    }

    const [validityBitmap, nullCount] = createValidityBitmap(n, isNull);
    return new arrow.Data(type, 0, n, nullCount, [undefined, buffer, validityBitmap]);
}

/// Create Arrow Data for DateDay (days since epoch as Int32)
function createDateDayData(type: arrow.DataType, values: any[]): arrow.Data {
    const n = values.length;
    const isNull = new Array<boolean>(n).fill(false);
    const buffer = new Int32Array(n);

    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v == null || v === '') {
            isNull[i] = true;
        } else {
            const date = new Date(v);
            const ms = date.getTime();
            if (Number.isNaN(ms)) {
                isNull[i] = true;
            } else {
                buffer[i] = Math.floor(ms / (24 * 60 * 60 * 1000));
            }
        }
    }

    const [validityBitmap, nullCount] = createValidityBitmap(n, isNull);
    return new arrow.Data(type, 0, n, nullCount, [undefined, buffer, validityBitmap]);
}

/// Create Arrow Data for DateMillisecond (ms since epoch as BigInt64)
function createDateMillisecondData(type: arrow.DataType, values: any[]): arrow.Data {
    const n = values.length;
    const isNull = new Array<boolean>(n).fill(false);
    const buffer = new BigInt64Array(n);

    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v == null || v === '') {
            isNull[i] = true;
        } else {
            const date = new Date(v);
            const ms = date.getTime();
            if (Number.isNaN(ms)) {
                isNull[i] = true;
            } else {
                buffer[i] = BigInt(ms);
            }
        }
    }

    const [validityBitmap, nullCount] = createValidityBitmap(n, isNull);
    return new arrow.Data(type, 0, n, nullCount, [undefined, buffer, validityBitmap]);
}

/// Create Arrow Data for TimeMillisecond (ms since midnight as Int32)
function createTimeMillisecondData(type: arrow.DataType, values: any[]): arrow.Data {
    const n = values.length;
    const isNull = new Array<boolean>(n).fill(false);
    const buffer = new Int32Array(n);

    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v == null) {
            isNull[i] = true;
        } else {
            // Parse time string "HH:MM:SS.sss"
            const parts = String(v).split(':');
            const hours = parseInt(parts[0], 10) || 0;
            const minutes = parseInt(parts[1], 10) || 0;
            const secondsParts = (parts[2] || '0').split('.');
            const seconds = parseInt(secondsParts[0], 10) || 0;
            const millis = parseInt((secondsParts[1] || '0').padEnd(3, '0').slice(0, 3), 10);
            buffer[i] = ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
        }
    }

    const [validityBitmap, nullCount] = createValidityBitmap(n, isNull);
    return new arrow.Data(type, 0, n, nullCount, [undefined, buffer, validityBitmap]);
}

/// Create Arrow Data for TimestampMillisecond (ms since epoch as BigInt64)
function createTimestampData(type: arrow.DataType, values: any[]): arrow.Data {
    const n = values.length;
    const isNull = new Array<boolean>(n).fill(false);
    const buffer = new BigInt64Array(n);

    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v == null || v === '') {
            isNull[i] = true;
        } else {
            const date = new Date(String(v).replace(' ', 'T'));
            const ms = date.getTime();
            if (Number.isNaN(ms)) {
                isNull[i] = true;
            } else {
                buffer[i] = BigInt(ms);
            }
        }
    }

    const [validityBitmap, nullCount] = createValidityBitmap(n, isNull);
    return new arrow.Data(type, 0, n, nullCount, [undefined, buffer, validityBitmap]);
}

/// Create Arrow Data for Utf8 strings
function createUtf8Data(type: arrow.DataType, values: any[]): arrow.Data {
    const n = values.length;
    const isNull = new Array<boolean>(n).fill(false);
    const encodedValues = new Array<Uint8Array | null>(n);
    let totalBytes = 0;

    // First pass: encode strings and track nulls
    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v == null) {
            isNull[i] = true;
            encodedValues[i] = null;
        } else {
            const str = typeof v === 'object' ? JSON.stringify(v) : String(v);
            const encoded = textEncoder.encode(str);
            encodedValues[i] = encoded;
            totalBytes += encoded.length;
        }
    }

    // Second pass: build offsets and data buffer
    const offsets = new Int32Array(n + 1);
    const dataBuffer = new Uint8Array(totalBytes);
    let offset = 0;

    for (let i = 0; i < n; i++) {
        offsets[i] = offset;
        const encoded = encodedValues[i];
        if (encoded != null) {
            dataBuffer.set(encoded, offset);
            offset += encoded.length;
        }
    }
    offsets[n] = offset;

    const [validityBitmap, nullCount] = createValidityBitmap(n, isNull);
    return new arrow.Data(type, 0, n, nullCount, [offsets, dataBuffer, validityBitmap]);
}

/// Create Arrow Data for Binary
function createBinaryData(type: arrow.DataType, values: any[]): arrow.Data {
    const n = values.length;
    const isNull = new Array<boolean>(n).fill(false);
    const binaryValues = new Array<Uint8Array | null>(n);
    let totalBytes = 0;

    // First pass: decode binary values and track nulls
    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v == null) {
            isNull[i] = true;
            binaryValues[i] = null;
        } else if (v instanceof Uint8Array) {
            binaryValues[i] = v;
            totalBytes += v.length;
        } else if (typeof v === 'string') {
            // Trino returns varbinary as base64
            const bytes = Uint8Array.from(atob(v), c => c.charCodeAt(0));
            binaryValues[i] = bytes;
            totalBytes += bytes.length;
        } else {
            isNull[i] = true;
            binaryValues[i] = null;
        }
    }

    // Second pass: build offsets and data buffer
    const offsets = new Int32Array(n + 1);
    const dataBuffer = new Uint8Array(totalBytes);
    let offset = 0;

    for (let i = 0; i < n; i++) {
        offsets[i] = offset;
        const bytes = binaryValues[i];
        if (bytes != null) {
            dataBuffer.set(bytes, offset);
            offset += bytes.length;
        }
    }
    offsets[n] = offset;

    const [validityBitmap, nullCount] = createValidityBitmap(n, isNull);
    return new arrow.Data(type, 0, n, nullCount, [offsets, dataBuffer, validityBitmap]);
}

/// Create Arrow Data for a column based on its type
function createColumnData(field: arrow.Field, values: any[]): arrow.Data {
    const type = field.type;
    const typeId = type.typeId;

    switch (typeId) {
        case arrow.Type.Bool:
            return createBoolData(type, values);

        case arrow.Type.Int8:
        case arrow.Type.Int16:
        case arrow.Type.Int32:
        case arrow.Type.Float32:
        case arrow.Type.Float:
        case arrow.Type.Float64:
            return createNumericData(type, values);

        case arrow.Type.Int64:
            return createBigIntData(type, values);

        case arrow.Type.DateDay:
            return createDateDayData(type, values);

        case arrow.Type.DateMillisecond:
            return createDateMillisecondData(type, values);

        case arrow.Type.TimeMillisecond:
            return createTimeMillisecondData(type, values);

        case arrow.Type.TimestampMillisecond:
        case arrow.Type.Timestamp:
            return createTimestampData(type, values);

        case arrow.Type.Binary:
            return createBinaryData(type, values);

        case arrow.Type.Utf8:
        default:
            // Utf8 and all other types (including complex types as JSON)
            return createUtf8Data(new arrow.Utf8(), values);
    }
}

/// Translate the Trino batch - direct Data construction (no builders)
function translateTrinoBatch(schema: arrow.Schema, rows: TrinoQueryData, _logger: Logger): arrow.RecordBatch {
    const numRows = rows.length;
    const numCols = schema.fields.length;

    // Build column data directly
    const columnData: arrow.Data[] = [];

    for (let col = 0; col < numCols; col++) {
        const field = schema.fields[col];

        // Extract column values from rows
        const values: any[] = [];
        for (let row = 0; row < numRows; row++) {
            const rowData = rows[row];
            values.push((rowData != null && col < rowData.length) ? rowData[col] : null);
        }

        // Create Data for this column
        const data = createColumnData(field, values);
        columnData.push(data);
    }

    // Create struct and batch
    const structData = arrow.makeData({
        type: new arrow.Struct(schema.fields),
        children: columnData,
        nullCount: 0
    });

    return new arrow.RecordBatch(schema, structData);
}

/// Derive the execution progress
function deriveProgress(stats: TrinoQueryStatistics | null, metrics: QueryExecutionMetrics): QueryExecutionProgress {
    return {
        isQueued: stats?.queued ?? null,
        metrics: { ...metrics }
    };
}
