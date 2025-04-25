import * as arrow from 'apache-arrow';
import * as proto from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

import {
    HealthCheckResult,
    HyperDatabaseChannel,
    HyperDatabaseClient,
    HyperDatabaseConnectionContext,
    HyperQueryResultStream,
} from '../connection/hyper/hyperdb_client.js';
import {
    NativeGrpcChannel,
    NativeGrpcClient,
    NativeGrpcProxyConfig,
    NativeGrpcServerStream,
    NativeGrpcServerStreamMessageIterator,
} from './native_grpc_client.js';
import {
    createQueryResponseStreamMetrics,
    QueryExecutionProgress,
    QueryExecutionResponseStream, QueryExecutionMetrics,
    QueryExecutionStatus,
} from '../connection/query_execution_state.js';
import { ChannelArgs } from './channel_common.js';
import { Logger } from './logger.js';
import { AsyncConsumerLambdas, AsyncConsumer } from '../utils/async_consumer.js';
import { AsyncValue } from '../utils/async_value.js';

const LOG_CTX = "native_hyperdb_client";

export class QueryResultReader implements AsyncIterator<Uint8Array>, AsyncIterable<Uint8Array> {
    /// The gRPC stream
    grpcStream: NativeGrpcServerStream;
    /// The logger
    logger: Logger;
    /// The message iterator
    messageIterator: NativeGrpcServerStreamMessageIterator;
    /// The current status
    currentStatus: QueryExecutionStatus;
    /// The metrics
    metrics: QueryExecutionMetrics;

    constructor(stream: NativeGrpcServerStream, logger: Logger) {
        this.grpcStream = stream;
        this.logger = logger;
        this.messageIterator = new NativeGrpcServerStreamMessageIterator(this.grpcStream, logger);
        this.currentStatus = QueryExecutionStatus.RUNNING;
        this.metrics = createQueryResponseStreamMetrics();
    }

    /// Get the result metadata (if any)
    get metadata() { return this.messageIterator.metadata; }
    /// Get the next binary result chunk
    async next(): Promise<IteratorResult<Uint8Array>> {
        while (true) {
            const next = await this.messageIterator.next();
            if (next.value == null) {
                return { done: true, value: null };
            }
            const resultMessage = buf.fromBinary(proto.salesforce_hyperdb_grpc_v1.pb.QueryResultSchema$, next.value);
            switch (resultMessage.result.case) {
                // We skip any dedicated header prefix
                case "header":
                    continue;
                // Skip qsv1 chunks
                case "qsv1Chunk":
                    throw new Error("invalid result data message. expected arrowChunk, received qsv1Chunk");
                // Unpack an arrow chunk
                case "arrowChunk": {
                    const buffer = resultMessage.result.value.data;
                    this.metrics.totalDataBytesReceived += buffer.byteLength;
                    return { done: false, value: buffer };
                }
            }
        }
    }

    /// Get the async iterator
    [Symbol.asyncIterator]() {
        return this;
    }
}

/// A native Hyper query result stream
export class NativeHyperQueryResultStream implements QueryExecutionResponseStream {
    /// The query result iterator
    resultReader: QueryResultReader;
    /// The schema Promise
    resultSchema: AsyncValue<arrow.Schema<any>, Error>;

    constructor(stream: NativeGrpcServerStream, _connection: HyperDatabaseConnectionContext, logger: Logger) {
        this.resultReader = new QueryResultReader(stream, logger);
        this.resultSchema = new AsyncValue();
    }

    /// Get the metadata
    getMetadata(): Map<string, string> {
        return this.resultReader.metadata;
    }
    /// Get the metrics
    getMetrics(): QueryExecutionMetrics {
        return this.resultReader.metrics;
    }
    /// Get the current query status
    getStatus(): QueryExecutionStatus {
        return this.resultReader.currentStatus;
    }
    /// Await the Arrow schema
    getSchema(): Promise<arrow.Schema> {
        return this.resultSchema.getValue();
    }
    /// Produce the result batches
    async produce(batches: AsyncConsumer<QueryExecutionResponseStream, arrow.RecordBatch>, _progress: AsyncConsumer<QueryExecutionResponseStream, QueryExecutionProgress>, abort?: AbortSignal): Promise<void> {
        const arrowReader = await arrow.AsyncRecordBatchStreamReader.from(this.resultReader);
        abort?.throwIfAborted();

        await arrowReader.open();
        abort?.throwIfAborted();
        this.resultSchema.resolve(arrowReader.schema);

        while (true) {
            const iter = await arrowReader!.next();
            abort?.throwIfAborted();
            if (iter.done) {
                if (iter.value !== undefined) {
                    batches.resolve(this, iter.value);
                }
            } else {
                batches.resolve(this, iter.value);
            }
        }
    }
}

/// A native Hyper database connection
class NativeHyperDatabaseChannel implements HyperDatabaseChannel {
    /// A gRPC channel
    grpcChannel: NativeGrpcChannel;
    /// The connection context
    connection: HyperDatabaseConnectionContext;
    /// A logger
    logger: Logger;

    constructor(channel: NativeGrpcChannel, connection: HyperDatabaseConnectionContext, logger: Logger) {
        this.grpcChannel = channel;
        this.connection = connection;
        this.logger = logger;
    }

    /// Check if Hyper is reachable
    public async checkHealth(): Promise<HealthCheckResult> {
        try {
            const result = await this.executeQuery(buf.create(proto.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, {
                query: "select 1 as healthy"
            }));
            const schema = await result.getSchema();
            if (schema == null) {
                return { ok: false, error: { message: "query result did not include a schema" } };
            }
            if (schema.fields.length != 1) {
                return { ok: false, error: { message: `unexpected number of fields in the query result schema: expected 1, received ${schema.fields.length}` } };
            }
            const field = schema.fields[0];
            if (field.name != "healthy") {
                return { ok: false, error: { message: `unexpected field name in the query result schema: expected 'healthy', received '${field.name}'` } };
            }
            let batches: arrow.RecordBatch<any>[] = [];
            const collectBatches = new AsyncConsumerLambdas(
                (_: QueryExecutionResponseStream, batch: arrow.RecordBatch<any>) => {
                    batches.push(batch);
                }
            );
            const ignoreProgressUpdates = new AsyncConsumerLambdas();
            await result.produce(collectBatches, ignoreProgressUpdates);
            if (batches.length == 0) {
                return { ok: false, error: { message: "query result did not include a record batch" } };
            }
            const healthyColumn = batches[0].getChildAt(0)!;
            if (healthyColumn == null) {
                return { ok: false, error: { message: "query result batch did not include any data" } };
            }
            if (healthyColumn.length != 1) {
                return { ok: false, error: { message: `query result batch contains an unexpected number of rows: expected 1, received ${healthyColumn.length}` } };
            }
            const healthyRow = healthyColumn.get(0);
            if (healthyRow !== 1) {
                return { ok: false, error: { message: `health check query returned an unexpected result` } };
            }
            return { ok: true, error: null };
        } catch (e: any) {
            this.logger.warn("health check failed", { "message": e.message, "details": e.details }, LOG_CTX);
            if (e.message) {
                return { ok: false, error: { message: e.message, details: e.details ?? {} } };
            } else {
                return { ok: false, error: { message: e.toString() } };
            }
        }
    }

    /// Execute a query against Hyper
    public async executeQuery(params: proto.salesforce_hyperdb_grpc_v1.pb.QueryParam): Promise<HyperQueryResultStream> {
        params.outputFormat = proto.salesforce_hyperdb_grpc_v1.pb.QueryParam_OutputFormat.ARROW_STREAM;
        for (const db of this.connection.getAttachedDatabases()) {
            params.database.push(buf.create(proto.salesforce_hyperdb_grpc_v1.pb.AttachedDatabaseSchema, db));
        }
        const stream = await this.grpcChannel.startServerStream({
            path: "/salesforce.hyperdb.grpc.v1.HyperService/ExecuteQuery",
            body: buf.toBinary(proto.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, params),
        });
        return new NativeHyperQueryResultStream(stream, this.connection, this.logger);
    }

    /// Close the connection
    public async close(): Promise<void> {
        await this.grpcChannel.close();
    }
}

/// A native Hyper database client
export class NativeHyperDatabaseClient implements HyperDatabaseClient {
    /// A logger
    logger: Logger;
    /// A native Hyper gRPC client
    client: NativeGrpcClient;

    constructor(config: NativeGrpcProxyConfig, logger: Logger) {
        this.logger = logger;
        this.client = new NativeGrpcClient(config, logger);
    }

    /// Create a database connection
    public async connect(args: ChannelArgs, connection: HyperDatabaseConnectionContext): Promise<NativeHyperDatabaseChannel> {
        const channel = await this.client.connect(args, connection);
        return new NativeHyperDatabaseChannel(channel, connection, this.logger);
    }
}
